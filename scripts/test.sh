#!/usr/bin/env bash

set -e
set -o pipefail

which exiftool

test_file() {
	local f="$1"
	echo "Considering file ${f}"

	set +e
	local pre_exif_out=$(exiftool "${f}" 2>&1)
	local pre_rc=$?
	set -e

	if [ $pre_rc -ne 0 ]; then
		echo "Skipping $f, exiftool couldn't read it"
		return
	fi
	if [ $(echo "$pre_exif_out" | grep -c -i 'warning') -ne 0 ]; then
		echo "Skipping $f due to warning"
		return
	fi

	# Use the same extension as input so exiftool can identify the format
	local basename="${f##*/}"
	local ext=""
	if [[ "$basename" == *.* ]]; then
		ext="${basename##*.}"
	fi
	local outfile="scrubbed-out"
	if [ -n "$ext" ]; then
		outfile="scrubbed-out.${ext}"
	fi

	./cli.js "$f" "$outfile"

	set +e
	local post_exif_out=$(exiftool "$outfile" 2>&1)
	local post_rc=$?
	set -e

	if [ $post_rc -ne 0 ]; then
		echo "After scrubbing $f, couldn't run exiftool"
		echo ""
		echo "pre exiftool output was:"
		echo "$pre_exif_out"
		echo ""
		echo "post exiftool output was:"
		echo "$post_exif_out"
		exit 1
	fi

	# --- Common metadata checks (all formats) ---

	# ./metadata-extractor-images/jpg/Nikon E995 (iptc).jpg has '(GPS)' in it
	if [ $(echo "$post_exif_out" | grep -i gps | grep -i -v version | grep -c -i -v '(gps)') -ne 0 ]; then
		echo "After scrubbing $f, still found 'gps' present"
		echo "$post_exif_out"
		exit 1
	fi

	if [ $(echo "$post_exif_out" | grep -c -i coordinates) -ne 0 ]; then
		echo "After scrubbing $f, still found 'coordinates' present"
		echo "$post_exif_out"
		exit 1
	fi

	if [ $(echo "$post_exif_out" | grep -c -i 'digital signature') -ne 0 ]; then
		echo "After scrubbing $f, still found 'digital signature' present"
		echo "$post_exif_out"
		exit 1
	fi

	# --- TIFF / HEIC / AVIF specific checks ---

	local ext_lower=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
	case "$ext_lower" in
		tif|tiff|heic|heif|avif|jxl)
			# EXIF sub-IFD tags should be stripped
			if echo "$post_exif_out" | grep -qi '^Exif Version'; then
				echo "After scrubbing $f, still found 'Exif Version'"
				echo "$post_exif_out"
				exit 1
			fi

			# XMP should be stripped
			if echo "$post_exif_out" | grep -qi '^XMP Toolkit'; then
				echo "After scrubbing $f, still found 'XMP Toolkit'"
				echo "$post_exif_out"
				exit 1
			fi

			# IPTC content fields should be stripped (tag 0x83BB)
			# Note: IPTC Digest (an MD5 hash in Photoshop resources) may remain as all-zeros; that's fine
			if echo "$post_exif_out" | grep -qi '^By-line\s*:\|^Caption-Abstract\s*:\|^Keywords\s*:'; then
				echo "After scrubbing $f, still found IPTC content fields"
				echo "$post_exif_out"
				exit 1
			fi

			# Artist / Copyright / ImageDescription should be stripped
			if echo "$post_exif_out" | grep -qi '^Artist\s*:'; then
				echo "After scrubbing $f, still found 'Artist'"
				echo "$post_exif_out"
				exit 1
			fi

			if echo "$post_exif_out" | grep -qi '^Copyright\s*:'; then
				echo "After scrubbing $f, still found 'Copyright'"
				echo "$post_exif_out"
				exit 1
			fi

			if echo "$post_exif_out" | grep -qi '^Image Description\s*:'; then
				echo "After scrubbing $f, still found 'Image Description'"
				echo "$post_exif_out"
				exit 1
			fi
			;;
		pdf)
			# PDF Info dictionary fields should be scrubbed
			# Use \S to ensure there's actual non-whitespace content (exiftool pads with spaces)
			if echo "$post_exif_out" | grep -qi '^Author\s*:\s*\S'; then
				echo "After scrubbing $f, still found 'Author'"
				echo "$post_exif_out"
				exit 1
			fi

			if echo "$post_exif_out" | grep -qi '^Title\s*:\s*\S'; then
				echo "After scrubbing $f, still found 'Title'"
				echo "$post_exif_out"
				exit 1
			fi
			;;
	esac

	rm -f "$outfile"
}

clone_or_update() {
	local dir="$1"
	local url="$2"
	if [ ! -d "$dir" ]; then
		echo "Cloning $dir"
		git clone "$url" "$dir"
	else
		echo "Updating $dir"
		cd "$dir"; git pull; cd ..
	fi
}

# --- Sample repos ---

# Existing repos
clone_or_update exif-samples https://github.com/ianare/exif-samples.git
clone_or_update metadata-extractor-images https://github.com/drewnoakes/metadata-extractor-images.git

# exifr test fixtures: HEIC (7), AVIF (2), TIFF (6), JPEG (43), PNG (6)
clone_or_update exifr-fixtures https://github.com/MikeKovarik/exifr.git

# bep/imagemeta: HEIC (1), HEIF (1), AVIF (2), TIFF (1), WebP (3), PNG (2), JPEG (many)
clone_or_update imagemeta-fixtures https://github.com/bep/imagemeta.git

# py-pdf sample-files: 32 PDFs with various metadata (author, title, XMP, etc.)
clone_or_update pypdf-samples https://github.com/py-pdf/sample-files.git

# exiftool test images: JXL (2), HEIC (1), TIFF (2), WebP (1), PDF (2), JPEG (many), PNG (1)
clone_or_update exiftool-fixtures https://github.com/exiftool/exiftool.git

# Only test supported image/PDF formats (allowlist approach)
find \
	samples \
	exif-samples \
	metadata-extractor-images \
	exifr-fixtures/test/fixtures \
	imagemeta-fixtures/testdata/images \
	pypdf-samples \
	exiftool-fixtures/t/images \
	-type f \
	-not -path '*/\.git/*' \
	-not -path '*/corrupt/*' \
	\( \
		-iname '*.jpg' -o \
		-iname '*.jpeg' -o \
		-iname '*.png' -o \
		-iname '*.webp' -o \
		-iname '*.tif' -o \
		-iname '*.tiff' -o \
		-iname '*.heic' -o \
		-iname '*.heif' -o \
		-iname '*.avif' -o \
		-iname '*.jxl' -o \
		-iname '*.pdf' \
	\) \
	| while read f
do
	test_file "$f"
done
