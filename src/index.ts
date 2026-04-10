import type { TransformCallback } from "stream";
import { inflateSync, deflateSync } from "fflate";
import Hex from 'hex-encoding';

const textEncoder = new TextEncoder();
function newUint8Array(input: string | Uint8Array, encoding?: 'utf-8' | "hex" | 'ascii' | 'binary' | 'latin1'): Uint8Array {
    if (typeof input === "string") {
        if (encoding === "hex") {
			return Hex.decode(input);
		}
		if (encoding === "utf-8" || encoding === undefined) {
			return textEncoder.encode(input);
		}
		if (encoding === "ascii") {
			const arr = new Uint8Array(input.length);
			for (let i = 0; i < input.length; i++) {
				arr[i] = input.charCodeAt(i) & 0x7f;
			}
			return arr;
		}
		if (encoding === "binary" || encoding === "latin1") {
			const arr = new Uint8Array(input.length);
			for (let i = 0; i < input.length; i++) {
				arr[i] = input.charCodeAt(i);
			}
			return arr;
		}
		throw new Error(`unsupported encoding: ${encoding}`);
    }
    return input;
}

const pdfMarker = newUint8Array("%PDF-", "utf-8");
const pdfInfoKeys = [
	"/Title",
	"/Author",
	"/Subject",
	"/Keywords",
	"/Creator",
	"/Producer",
	"/CreationDate",
	"/ModDate",
];
const exifMarker = newUint8Array("457869660000", "hex"); // Exif\0\0
const pngMarker = newUint8Array("89504e470d0a1a0a", "hex"); // 211   P   N   G  \r  \n \032 \n
const webp1Marker = newUint8Array("52494646", "hex"); // RIFF
const webp2Marker = newUint8Array("57454250", "hex"); // WEBP
const xmpMarker = newUint8Array("http://ns.adobe.com/xap", "utf-8");
const flirMarker = newUint8Array("FLIR", "utf-8");

const iccProfileMarker = newUint8Array("ICC_PROFILE", "utf-8");
const maxMarkerLength = Math.max(
	exifMarker.length,
	xmpMarker.length,
	flirMarker.length,
);

// JPEG markers to always strip (APP13/IPTC, APP12/Ducky, COM/comments)
const jpegAlwaysStripMarkers = new Set([0xed, 0xec, 0xfe]);

// TIFF
const tiffLE = newUint8Array("49492a00", "hex"); // II*\0
const tiffBE = newUint8Array("4d4d002a", "hex"); // MM\0*

// ISOBMFF brands (HEIC + AVIF)
const ftypMarker = newUint8Array("ftyp", "utf-8");
const isobmffBrands = [
	"heic",
	"heix",
	"mif1",
	"msf1",
	"hevx",
	"hevc",
	"avif",
	"avis",
];

// JPEG XL ISOBMFF container signature (12 bytes)
const jxlContainerSig = newUint8Array("0000000c4a584c200d0a870a", "hex");

// GIF
const gif87aMarker = newUint8Array("GIF87a", "ascii");
const gif89aMarker = newUint8Array("GIF89a", "ascii");
const xmpDataXMP = "XMP DataXMP";

// TIFF metadata tags to strip
const tiffStripTags = new Set([
	0x010e, 0x013b, 0x02bc, 0x8298, 0x83bb, 0x8568, 0x8649, 0x8769, 0x8825,
	0xa005, 0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f,
]);
const tiffPointerTags = new Set([0x8769, 0x8825, 0xa005]);
const tiffTypeSizes: Record<number, number> = {
	1: 1,
	2: 1,
	3: 2,
	4: 4,
	5: 8,
	6: 1,
	7: 1,
	8: 2,
	9: 4,
	10: 8,
	11: 4,
	12: 8,
};

type PdfStreamType = "metadata" | "image" | "embedded" | "xref" | "check" | "pass";

function arraysEqual(a: Uint8Array, b: Uint8Array) {
	if (typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.cmp === "function") {
		return indexedDB.cmp(a, b) === 0;
	}

	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function concat(arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}
	return result;
}

function readUInt16BE(buf: Uint8Array, offset: number): number {
	return (buf[offset] << 8) | buf[offset + 1];
}

function readUInt32BE(buf: Uint8Array, offset: number): number {
	return (((buf[offset] << 24) + ((buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3])) >>> 0);
}

function readUInt16LE(buf: Uint8Array, offset: number): number {
	return buf[offset] | (buf[offset + 1] << 8);
}

function readUInt32LE(buf: Uint8Array, offset: number): number {
	return ((buf[offset] + (buf[offset + 1] << 8) + (buf[offset + 2] << 16) + (buf[offset + 3] << 24)) >>> 0);
}

function writeUInt16BE(buf: Uint8Array, value: number, offset: number) {
	buf[offset] = (value >> 8) & 0xff;
	buf[offset + 1] = value & 0xff;
}

function writeUInt16LE(buf: Uint8Array, value: number, offset: number) {
	buf[offset] = value & 0xff;
	buf[offset + 1] = (value >> 8) & 0xff;
}

function writeUInt32BE(buf: Uint8Array, value: number, offset: number) {
	buf[offset] = (value >> 24) & 0xff;
	buf[offset + 1] = (value >> 16) & 0xff;
	buf[offset + 2] = (value >> 8) & 0xff;
	buf[offset + 3] = value & 0xff;
}

function writeUInt32LE(buf: Uint8Array, value: number, offset: number) {
	buf[offset] = value & 0xff;
	buf[offset + 1] = (value >> 8) & 0xff;
	buf[offset + 2] = (value >> 16) & 0xff;
	buf[offset + 3] = (value >> 24) & 0xff;
}

function copy(src: Uint8Array, dest: Uint8Array, destOffset: number) {
	dest.set(src, destOffset);
}

function compare(a: Uint8Array, b: Uint8Array, bStart = 0, bEnd = b.length, aStart = 0, aEnd = a.length): number {
	if (typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.cmp === "function") {
		return indexedDB.cmp(a.subarray(aStart, aEnd), b.subarray(bStart, bEnd));
	}

	// Compares a with b and returns a number indicating whether a comes before, after, or is the same as b in sort order. Comparison is based on the actual sequence of bytes in each Buffer.
	const aLen = aEnd - aStart;
	const bLen = bEnd - bStart;
	const minLen = Math.min(aLen, bLen);
	for (let i = 0; i < minLen; i++) {
		const aByte = a[aStart + i];
		const bByte = b[bStart + i];
		if (aByte !== bByte) {
			return aByte < bByte ? -1 : 1;
		}
	}
	if (aLen === bLen) return 0;
	return aLen < bLen ? -1 : 1;
}

function toLatin1(buf: Uint8Array): string {
	let result = "";
	for (let i = 0; i < buf.length; i++) {
		result += String.fromCharCode(buf[i]);
	}
	return result;
}

function toAscii(buf: Uint8Array): string {
	let result = "";
	for (let i = 0; i < buf.length; i++) {
		result += String.fromCharCode(buf[i] & 0x7f);
	}
	return result;
}

const textDecoder = new TextDecoder("utf-8", { fatal: false });
function toUtf8(buf: Uint8Array): string {
	return textDecoder.decode(buf);
}

function indexOf(buf: Uint8Array, sub: string, fromIndex = 0, encoding: "utf-8" | "latin1" = "utf-8"): number {
	const subBuf = encoding === "utf-8" ? newUint8Array(sub, "utf-8") : newUint8Array(sub, "latin1");
	for (let i = fromIndex; i <= buf.length - subBuf.length; i++) {
		let found = true;
		for (let j = 0; j < subBuf.length; j++) {
			if (buf[i + j] !== subBuf[j]) {
				found = false;
				break;
			}
		}
		if (found) return i;
	}
	return -1;
}

// node.js polyfill
abstract class Transform {
	public onchunk?: (chunk: Uint8Array) => void;
	abstract _transform(chunk: Uint8Array, encoding: BufferEncoding, callback: TransformCallback): void;
	_final(callback: TransformCallback): void {
		callback();
	}
	push(chunk: Uint8Array) {
		this.onchunk?.(chunk);
	}
}

class ExifTransformer extends Transform {
	remainingScrubBytes: number | undefined;
	remainingGoodBytes: number | undefined;
	pending: Array<Uint8Array>;
	mode:
		| "png"
		| "webp"
		| "pdf"
		| "tiff"
		| "isobmff"
		| "gif"
		| "other"
		| undefined;

	// PDF state
	pdfState: "scanning" | "in_dict" | "in_stream";
	pdfDictBuffer: Uint8Array;
	pdfDictNesting: number;
	pdfStringNesting: number;
	pdfInEscape: boolean;
	pdfStreamLength: number;
	pdfStreamType: PdfStreamType;
	pdfStreamBytesRead: number;
	pdfStreamData: Uint8Array[];
	pdfInputOffset: number;
	pdfOutputOffset: number;
	pdfOffsetMap: Array<[number, number]>;
	pdfInXref: boolean;
	pdfXrefBuffer: Uint8Array;
	pdfPending: Uint8Array;
	pdfDictStart: number;

	constructor() {
		super();
		this.remainingScrubBytes = undefined;
		this.pending = [];
		this.pdfState = "scanning";
		this.pdfDictBuffer = new Uint8Array();
		this.pdfDictNesting = 0;
		this.pdfStringNesting = 0;
		this.pdfInEscape = false;
		this.pdfStreamLength = -1;
		this.pdfStreamType = "pass";
		this.pdfStreamBytesRead = 0;
		this.pdfStreamData = [];
		this.pdfInputOffset = 0;
		this.pdfOutputOffset = 0;
		this.pdfOffsetMap = [[0, 0]];
		this.pdfInXref = false;
		this.pdfXrefBuffer = new Uint8Array();
		this.pdfPending = new Uint8Array();
		this.pdfDictStart = 0;
	}

	override _transform(
		chunk: Uint8Array,
		_: BufferEncoding,
		callback: TransformCallback,
	) {
		if (this.mode === undefined) {
			if (arraysEqual(pngMarker, chunk.subarray(0, 8))) {
				this.mode = "png";
				this.push(chunk.subarray(0, 8));
				chunk = newUint8Array(chunk.subarray(8));
			} else if (
				arraysEqual(webp1Marker, chunk.subarray(0, 4)) &&
				arraysEqual(webp2Marker, chunk.subarray(8, 12))
			) {
				this.mode = "webp";
				this.push(chunk.subarray(0, 12));
				chunk = newUint8Array(chunk.subarray(12));
			} else if (
				chunk.length >= 5 &&
				arraysEqual(pdfMarker, chunk.subarray(0, 5))
			) {
				this.mode = "pdf";
			} else if (
				chunk.length >= 4 &&
				(arraysEqual(tiffLE, chunk.subarray(0, 4)) ||
					arraysEqual(tiffBE, chunk.subarray(0, 4)))
			) {
				this.mode = "tiff";
			} else if (
				chunk.length >= 12 &&
				arraysEqual(ftypMarker, chunk.subarray(4, 8))
			) {
				const brand = toUtf8(chunk.subarray(8, 12));
				if (isobmffBrands.includes(brand)) {
					this.mode = "isobmff";
				} else {
					this.mode = "other";
				}
			} else if (
				chunk.length >= 12 &&
				arraysEqual(jxlContainerSig, chunk.subarray(0, 12))
			) {
				this.mode = "isobmff";
			} else if (
				chunk.length >= 6 &&
				(arraysEqual(gif87aMarker, chunk.subarray(0, 6)) ||
					arraysEqual(gif89aMarker, chunk.subarray(0, 6)))
			) {
				this.mode = "gif";
			} else {
				this.mode = "other";
			}
		}
		if (this.mode === "pdf") {
			this._scrubPDF(false, chunk);
			callback();
			return;
		}
		if (
			this.mode === "tiff" ||
			this.mode === "isobmff" ||
			this.mode === "gif"
		) {
			this.pending.push(chunk);
			callback();
			return;
		}
		this._scrub(false, chunk);
		callback();
	}

	override _final(callback: TransformCallback) {
		if (this.mode === "pdf") {
			if (this.pdfPending.length > 0) {
				this._scrubPDF(true);
			}
			callback();
			return;
		}
		if (this.mode === "tiff") {
			this.push(this._scrubTIFF(concat(this.pending)));
			this.pending.length = 0;
			callback();
			return;
		}
		if (this.mode === "isobmff") {
			this.push(this._scrubISOBMFF(concat(this.pending)));
			this.pending.length = 0;
			callback();
			return;
		}
		if (this.mode === "gif") {
			this.push(this._scrubGIF(concat(this.pending)));
			this.pending.length = 0;
			callback();
			return;
		}
		while (this.pending.length !== 0) {
			this._scrub(true);
		}
		callback();
	}

	_scrub(atEnd: boolean, chunk?: Uint8Array) {
		switch (this.mode) {
			case "other":
				return this._scrubOther(atEnd, chunk);
			case "png":
				return this._scrubPNG(atEnd, chunk);
			case "webp":
				return this._scrubWEBP(atEnd, chunk);
			default:
				throw new Error("unknown mode");
		}
	}

	_findJpegMetadataMarker(buf: Uint8Array, startFrom = 0): number {
		for (let i = startFrom; i < buf.length - 1; i++) {
			if (buf[i] === 0xff) {
				const next = buf[i + 1];
				// Strip APP1-APP13 (0xE1-0xED), APP15 (0xEF), COM (0xFE)
				// Keep APP0 (0xE0, JFIF) and APP14 (0xEE, Adobe color)
				if (
					(next >= 0xe1 && next <= 0xed) ||
					next === 0xef ||
					next === 0xfe
				) {
					return i;
				}
			}
		}
		return -1;
	}

	_scrubOther(atEnd: boolean, chunk?: Uint8Array) {
		let pendingChunk = chunk
			? concat([...this.pending, chunk])
			: concat(this.pending);
		// currently haven't detected a metadata marker
		if (this.remainingScrubBytes === undefined) {
			let searchFrom = 0;
			let markerStart = -1;
			let foundStrippable = false;

			while (true) {
				markerStart = this._findJpegMetadataMarker(pendingChunk, searchFrom);
				if (markerStart === -1) break;

				const markerByte = pendingChunk[markerStart + 1];

				// Need at least 4 bytes from marker start to read the length
				if (markerStart + 4 > pendingChunk.length) {
					if (atEnd) {
						this.push(pendingChunk);
						this.pending.length = 0;
					} else if (chunk) {
						this.pending.push(chunk);
					}
					return;
				}

				// APP2 — strip unless ICC_PROFILE
				if (markerByte === 0xe2) {
					if (markerStart + 4 + iccProfileMarker.length > pendingChunk.length) {
						if (atEnd) {
							this.push(pendingChunk);
							this.pending.length = 0;
						} else if (chunk) {
							this.pending.push(chunk);
						}
						return;
					}
					const app2Payload = pendingChunk.subarray(
						markerStart + 4,
						markerStart + 4 + iccProfileMarker.length,
					);
					if (
						compare(
							iccProfileMarker,
							app2Payload,
							0,
							iccProfileMarker.length,
						) !== 0
					) {
						this.remainingScrubBytes =
							readUInt16BE(pendingChunk, markerStart + 2) + 2;
						this.push(
							pendingChunk.subarray(0, markerStart),
						);
						pendingChunk = newUint8Array(
							pendingChunk.subarray(markerStart),
						);
						foundStrippable = true;
						break;
					}
					// ICC_PROFILE — skip past this APP2 segment
					const segEnd =
						markerStart + 2 + readUInt16BE(pendingChunk, markerStart + 2);
					searchFrom =
						segEnd < pendingChunk.length ? segEnd : pendingChunk.length;
				// All other metadata markers — always strip
				} else {
					this.remainingScrubBytes =
						readUInt16BE(pendingChunk, markerStart + 2) + 2;
					this.push(
						pendingChunk.subarray(0, markerStart),
					);
					pendingChunk = newUint8Array(
						pendingChunk.subarray(markerStart),
					);
					foundStrippable = true;
					break;
				}
			}

			// no strippable marker found
			if (!foundStrippable && markerStart === -1) {
				// if last byte is ff, wait for more
				if (
					!atEnd &&
					pendingChunk.length > 0 &&
					pendingChunk[pendingChunk.length - 1] === 0xff
				) {
					if (chunk) this.pending.push(chunk);
					return;
				}
			}
		}

		// we have successfully found a metadata marker, so we can remove data
		if (
			this.remainingScrubBytes !== undefined &&
			this.remainingScrubBytes !== 0
		) {
			// there is more data than we want to remove, so we only remove up to remainingScrubBytes
			if (pendingChunk.length >= this.remainingScrubBytes) {
				const remainingBuffer = newUint8Array(
					pendingChunk.subarray(this.remainingScrubBytes),
				);
				this.pending = remainingBuffer.length !== 0 ? [remainingBuffer] : [];
				this.remainingScrubBytes = undefined;
				// this chunk is too large, remove everything
			} else {
				this.remainingScrubBytes -= pendingChunk.length;
				this.pending.length = 0;
			}
		} else {
			// push this chunk
			this.push(pendingChunk);
			this.remainingScrubBytes = undefined;
			this.pending.length = 0;
		}
	}

	_scrubPNG(atEnd: Boolean, chunk?: Uint8Array) {
		let pendingChunk = chunk
			? concat([...this.pending, chunk])
			: concat(this.pending);

		while (pendingChunk.length !== 0) {
			pendingChunk = this._processPNGGood(pendingChunk);
			if (this.remainingScrubBytes !== undefined) {
				if (pendingChunk.length >= this.remainingScrubBytes) {
					const remainingBuffer = newUint8Array(
						pendingChunk.subarray(
							this.remainingScrubBytes,
						),
					);
					this.pending = remainingBuffer.length !== 0 ? [remainingBuffer] : [];
					this.remainingScrubBytes = undefined;
					// this chunk is too large, remove everything
				} else {
					this.remainingScrubBytes -= pendingChunk.length;
					this.pending.length = 0;
				}
				return;
			}

			if (pendingChunk.length === 0) return;
			if (pendingChunk.length < 8) {
				if (atEnd) {
					this.push(pendingChunk);
					this.pending.length = 0;
				} else {
					this.pending = [pendingChunk];
				}
				return;
			}

			const size = readUInt32BE(pendingChunk, 0);
			const chunkTotal = size + 12;
			// Chunk size exceeds available data — buffer for more unless at end
			if (chunkTotal > pendingChunk.length) {
				if (atEnd) {
					this.push(pendingChunk);
					this.pending.length = 0;
				} else {
					this.pending = [pendingChunk];
				}
				return;
			}
			const chunkType = toUtf8(pendingChunk.subarray(4, 8));
			switch (chunkType) {
				case "tIME":
				case "iTXt":
				case "tEXt":
				case "zTXt":
				case "eXIf":
				case "dSIG":
					this.remainingScrubBytes = chunkTotal;
					continue;
				default:
					this.remainingGoodBytes = chunkTotal;
					continue;
			}
		}
	}

	_processPNGGood(chunk: Uint8Array): Uint8Array {
		if (this.remainingGoodBytes === undefined) {
			return chunk;
		}
		this.pending.length = 0;
		// we need all these bytes
		if (this.remainingGoodBytes >= chunk.length) {
			this.remainingGoodBytes -= chunk.length;
			this.push(chunk);
			return new Uint8Array();
		} else {
			this.push(
				chunk.subarray(0, this.remainingGoodBytes),
			);
			const remaining = newUint8Array(
				chunk.subarray(this.remainingGoodBytes),
			);
			this.remainingGoodBytes = undefined;
			return remaining;
		}
	}

	_gifSkipSubBlocks(buf: Uint8Array, pos: number): number {
		while (pos < buf.length && buf[pos] !== 0) {
			pos += buf[pos] + 1;
		}
		return pos < buf.length ? pos + 1 : pos;
	}

	_scrubGIF(buf: Uint8Array): Uint8Array {
		if (buf.length < 13) return buf;

		const parts: Uint8Array[] = [];
		const packed = buf[10];
		const gctFlag = (packed >> 7) & 1;
		const gctSize = gctFlag ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
		const headerEnd = 13 + gctSize;

		if (headerEnd > buf.length) return buf;
		parts.push(buf.subarray(0, headerEnd));

		let pos = headerEnd;
		while (pos < buf.length) {
			const intro = buf[pos];

			if (intro === 0x3b) {
				parts.push(buf.subarray(pos, pos + 1));
				break;
			}

			if (intro === 0x2c) {
				if (pos + 10 > buf.length) break;
				const lctFlag = (buf[pos + 9] >> 7) & 1;
				const lctSize = lctFlag ? 3 * (1 << ((buf[pos + 9] & 0x07) + 1)) : 0;
				let dataStart = pos + 10 + lctSize;
				if (dataStart >= buf.length) break;
				dataStart++;
				const blockEnd = this._gifSkipSubBlocks(buf, dataStart);
				parts.push(buf.subarray(pos, blockEnd));
				pos = blockEnd;
				continue;
			}

			if (intro === 0x21) {
				if (pos + 1 >= buf.length) break;
				const label = buf[pos + 1];

				if (label === 0xfe) {
					const blockEnd = this._gifSkipSubBlocks(buf, pos + 2);
					pos = blockEnd;
					continue;
				}

				if (label === 0xff) {
					if (pos + 2 >= buf.length) break;
					const blockSize = buf[pos + 2];
					if (pos + 3 + blockSize > buf.length) break;
					const appId = toAscii(buf.subarray(pos + 3, pos + 3 + blockSize));
					const blockEnd = this._gifSkipSubBlocks(buf, pos + 3 + blockSize);

					if (appId === xmpDataXMP) {
						pos = blockEnd;
						continue;
					}

					parts.push(buf.subarray(pos, blockEnd));
					pos = blockEnd;
					continue;
				}

				if (label === 0xf9) {
					const blockEnd = pos + 2 + 1 + buf[pos + 2] + 1;
					parts.push(buf.subarray(pos, blockEnd));
					pos = blockEnd;
					continue;
				}

				const blockEnd = this._gifSkipSubBlocks(buf, pos + 2);
				parts.push(buf.subarray(pos, blockEnd));
				pos = blockEnd;
				continue;
			}

			parts.push(buf.subarray(pos));
			break;
		}

		return concat(parts);
	}

	_scrubWEBP(atEnd: Boolean, chunk?: Uint8Array) {
		let pendingChunk = chunk
			? concat([...this.pending, chunk])
			: concat(this.pending);

		while (pendingChunk.length !== 0) {
			pendingChunk = this._processPNGGood(pendingChunk);
			if (this.remainingScrubBytes !== undefined) {
				if (pendingChunk.length >= this.remainingScrubBytes) {
					const remainingBuffer = newUint8Array(pendingChunk.subarray(this.remainingScrubBytes));
					this.pending = remainingBuffer.length !== 0 ? [remainingBuffer] : [];
					this.remainingScrubBytes = undefined;
					// this chunk is too large, remove everything
				} else {
					this.remainingScrubBytes -= pendingChunk.length;
					this.pending.length = 0;
				}
				return;
			}

			if (pendingChunk.length === 0) return;
			if (pendingChunk.length < 8) {
				if (atEnd) {
					this.push(pendingChunk);
					this.pending.length = 0;
				} else {
					this.pending = [pendingChunk];
				}
				return;
			}

			const chunkType = toUtf8(pendingChunk.subarray(0, 4));
			const size = readUInt32LE(pendingChunk, 4);
			const chunkTotal = 8 + size + (size % 2); // header + data + RIFF padding
			// Chunk size exceeds available data — buffer for more unless at end
			if (chunkTotal > pendingChunk.length) {
				if (atEnd) {
					this.push(pendingChunk);
					this.pending.length = 0;
				} else {
					this.pending = [pendingChunk];
				}
				return;
			}
			switch (chunkType) {
				case "EXIF":
				case "XMP ":
					this.remainingScrubBytes = chunkTotal;
					continue;
				default:
					this.remainingGoodBytes = chunkTotal;
					continue;
			}
		}
	}
	// TIFF scrubbing
	_scrubTIFF(buf: Uint8Array): Uint8Array {
		if (buf.length < 8) return buf;
		const out = newUint8Array(buf);
		const le = out[0] === 0x49; // 'I' = little-endian
		const readU16 = le
			? (b: Uint8Array, o: number) => readUInt16LE(b, o)
			: (b: Uint8Array, o: number) => readUInt16BE(b, o);
		const readU32 = le
			? (b: Uint8Array, o: number) => readUInt32LE(b, o)
			: (b: Uint8Array, o: number) => readUInt32BE(b, o);
		const writeU16 = le
			? (b: Uint8Array, v: number, o: number) => writeUInt16LE(b, v, o)
			: (b: Uint8Array, v: number, o: number) => writeUInt16BE(b, v, o);

		let ifdOffset = readU32(out, 4);
		const visited = new Set<number>();

		while (ifdOffset !== 0 && ifdOffset + 2 <= out.length) {
			if (visited.has(ifdOffset)) break;
			visited.add(ifdOffset);

			const entryCount = readU16(out, ifdOffset);
			const entriesStart = ifdOffset + 2;
			const entriesEnd = entriesStart + entryCount * 12;

			if (entriesEnd > out.length) break;

			const kept: Uint8Array[] = [];
			for (let i = 0; i < entryCount; i++) {
				const entryOff = entriesStart + i * 12;
				if (entryOff + 12 > out.length) break;
				const tag = readU16(out, entryOff);

				if (tiffStripTags.has(tag)) {
					const type = readU16(out, entryOff + 2);
					const count = readU32(out, entryOff + 4);
					const typeSize = tiffTypeSizes[type] || 1;
					const totalSize = count * typeSize;

					if (tiffPointerTags.has(tag)) {
						// Zero sub-IFD recursively
						if (totalSize <= 4) {
							const subOffset = le
								? readUInt32LE(out, entryOff + 8)
								: readUInt32BE(out, entryOff + 8);
							this._tiffZeroSubIFD(out, subOffset, readU16, readU32, visited);
						} else {
							const ptrOffset = readU32(out, entryOff + 8);
							if (ptrOffset + 4 <= out.length) {
								const subOffset = readU32(out, ptrOffset);
								this._tiffZeroSubIFD(out, subOffset, readU16, readU32, visited);
							}
						}
					}

					// Zero the entry's data
					if (totalSize > 4) {
						const dataOffset = readU32(out, entryOff + 8);
						if (dataOffset + totalSize <= out.length) {
							out.fill(0, dataOffset, dataOffset + totalSize);
						}
					}
					// Zero inline value
					out.fill(0, entryOff + 8, entryOff + 12);
				} else {
					kept.push(newUint8Array(out.slice(entryOff, entryOff + 12)));
				}
			}

			// Rewrite IFD with only kept entries
			writeU16(out, kept.length, ifdOffset);
			for (let i = 0; i < kept.length; i++) {
				copy(kept[i], out, entriesStart + i * 12);
			}
			// Zero vacated space
			const newEntriesEnd = entriesStart + kept.length * 12;
			if (newEntriesEnd < entriesEnd) {
				out.fill(0, newEntriesEnd, entriesEnd);
			}

			// Read next-IFD pointer and copy to correct position
			let origNextIFD = 0;
			if (entriesEnd + 4 <= out.length) {
				origNextIFD = readU32(out, entriesEnd);
			}
			if (newEntriesEnd + 4 <= out.length) {
				if (le) writeUInt32LE(out, origNextIFD, newEntriesEnd);
				else writeUInt32BE(out, origNextIFD, newEntriesEnd);
			}

			ifdOffset = origNextIFD;
		}

		return out;
	}

	_tiffZeroSubIFD(
		buf: Uint8Array,
		offset: number,
		readU16: (b: Uint8Array, o: number) => number,
		readU32: (b: Uint8Array, o: number) => number,
		visited: Set<number>,
	): void {
		if (offset === 0 || offset + 2 > buf.length) return;
		if (visited.has(offset)) return;
		visited.add(offset);

		const entryCount = readU16(buf, offset);
		const entriesStart = offset + 2;
		const entriesEnd = entriesStart + entryCount * 12;

		if (entriesEnd > buf.length) return;

		for (let i = 0; i < entryCount; i++) {
			const entryOff = entriesStart + i * 12;
			if (entryOff + 12 > buf.length) break;
			const tag = readU16(buf, entryOff);
			const type = readU16(buf, entryOff + 2);
			const count = readU32(buf, entryOff + 4);
			const typeSize = tiffTypeSizes[type] || 1;
			const totalSize = count * typeSize;

			// Recursively zero sub-IFDs pointed to by pointer tags
			if (tiffPointerTags.has(tag) && totalSize <= 4) {
				const subOffset = readU32(buf, entryOff + 8);
				this._tiffZeroSubIFD(buf, subOffset, readU16, readU32, visited);
			}

			// Zero remote data
			if (totalSize > 4) {
				const dataOffset = readU32(buf, entryOff + 8);
				if (dataOffset + totalSize <= buf.length) {
					buf.fill(0, dataOffset, dataOffset + totalSize);
				}
			}
		}

		// Zero the IFD itself
		buf.fill(0, offset, Math.min(entriesEnd, buf.length));
	}

	// ISOBMFF scrubbing (HEIC/AVIF/JXL)
	_scrubISOBMFF(buf: Uint8Array): Uint8Array {
		if (buf.length < 12) return buf;
		const out = newUint8Array(buf);

		const topBoxes = this._isobmffParseBoxes(out, 0, out.length);

		// JXL-style: zero top-level Exif, xml, and brob (Brotli-compressed Exif/xml) boxes
		for (const box of topBoxes) {
			if (box.type === "Exif" || box.type === "xml ") {
				out.fill(0, box.dataOffset, box.offset + box.size);
			} else if (
				box.type === "brob" &&
				box.dataOffset + 4 <= box.offset + box.size
			) {
				const actualType = toUtf8(out
					.slice(box.dataOffset, box.dataOffset + 4));
				if (actualType === "Exif" || actualType === "xml ") {
					out.fill(0, box.dataOffset, box.offset + box.size);
				}
			}
		}

		// HEIC/AVIF-style: find meta box and zero item extents
		let metaBox: {
			type: string;
			offset: number;
			size: number;
			dataOffset: number;
		} | null = null;

		for (const box of topBoxes) {
			if (box.type === "meta") {
				metaBox = box;
				break;
			}
			if (box.type === "moov") {
				const moovEnd = box.offset + box.size;
				const moovChildren = this._isobmffParseBoxes(
					out,
					box.dataOffset,
					moovEnd,
				);
				for (const child of moovChildren) {
					if (child.type === "meta") {
						metaBox = child;
						break;
					}
				}
				if (metaBox) break;
			}
		}

		if (!metaBox) return out;

		// meta is a FullBox: skip 4 bytes (version + flags) after the box header
		const metaDataStart = metaBox.dataOffset + 4;
		const metaEnd = metaBox.offset + metaBox.size;

		if (metaDataStart >= metaEnd) return out;

		const metaChildren = this._isobmffParseBoxes(out, metaDataStart, metaEnd);

		let iinfBox: {
			type: string;
			offset: number;
			size: number;
			dataOffset: number;
		} | null = null;
		let ilocBox: {
			type: string;
			offset: number;
			size: number;
			dataOffset: number;
		} | null = null;

		for (const child of metaChildren) {
			if (child.type === "iinf") iinfBox = child;
			if (child.type === "iloc") ilocBox = child;
		}

		if (!iinfBox || !ilocBox) return out;

		const items = this._isobmffParseIinf(
			out,
			iinfBox.dataOffset,
			iinfBox.offset + iinfBox.size,
		);
		const locations = this._isobmffParseIloc(
			out,
			ilocBox.dataOffset,
			ilocBox.offset + ilocBox.size,
		);

		// Identify metadata item IDs
		const metadataItemIds = new Set<number>();
		for (const item of items) {
			if (item.itemType === "Exif" || item.itemType === "mime") {
				metadataItemIds.add(item.itemId);
			}
		}

		// Zero out metadata item extents
		for (const loc of locations) {
			if (metadataItemIds.has(loc.itemId)) {
				for (const ext of loc.extents) {
					if (ext.offset + ext.length <= out.length) {
						out.fill(0, ext.offset, ext.offset + ext.length);
					}
				}
			}
		}

		return out;
	}

	_isobmffParseBoxes(
		buf: Uint8Array,
		start: number,
		end: number,
	): Array<{ type: string; offset: number; size: number; dataOffset: number }> {
		const boxes: Array<{
			type: string;
			offset: number;
			size: number;
			dataOffset: number;
		}> = [];
		let pos = start;

		while (pos + 8 <= end) {
			let size = readUInt32BE(buf, pos);
			const type = toUtf8(buf.slice(pos + 4, pos + 8));
			let dataOffset = pos + 8;

			if (size === 1) {
				// 64-bit extended size
				if (pos + 16 > end) break;
				const hi = readUInt32BE(buf, pos + 8);
				const lo = readUInt32BE(buf, pos + 12);
				size = hi * 0x100000000 + lo;
				dataOffset = pos + 16;
			} else if (size === 0) {
				// Box extends to end of file
				size = end - pos;
			}

			if (size < 8 || pos + size > end) break;

			boxes.push({ type, offset: pos, size, dataOffset });
			pos += size;
		}

		return boxes;
	}

	_isobmffReadUintBE(buf: Uint8Array, offset: number, byteCount: number): number {
		let val = 0;
		for (let i = 0; i < byteCount; i++) {
			val = val * 256 + buf[offset + i];
		}
		return val;
	}

	_isobmffParseIinf(
		buf: Uint8Array,
		dataOffset: number,
		boxEnd: number,
	): Array<{ itemId: number; itemType: string }> {
		const items: Array<{ itemId: number; itemType: string }> = [];
		if (dataOffset + 4 > boxEnd) return items;

		// iinf is a FullBox: version(1) + flags(3)
		const version = buf[dataOffset];
		let pos = dataOffset + 4;

		// entry count
		let entryCount: number;
		if (version === 0) {
			if (pos + 2 > boxEnd) return items;
			entryCount = readUInt16BE(buf, pos);
			pos += 2;
		} else {
			if (pos + 4 > boxEnd) return items;
			entryCount = readUInt32BE(buf, pos);
			pos += 4;
		}

		// Parse infe boxes
		for (let i = 0; i < entryCount && pos + 8 < boxEnd; i++) {
			const infeBoxes = this._isobmffParseBoxes(buf, pos, boxEnd);
			if (infeBoxes.length === 0) break;
			const infe = infeBoxes[0];
			if (infe.type !== "infe") {
				pos += infe.size;
				continue;
			}

			// infe is a FullBox: version(1) + flags(3)
			const infeVersion = buf[infe.dataOffset];
			let infePos = infe.dataOffset + 4;

			if (infeVersion >= 2) {
				let itemId: number;
				if (infeVersion === 2) {
					if (infePos + 2 > boxEnd) break;
					itemId = readUInt16BE(buf, infePos);
					infePos += 2;
				} else {
					if (infePos + 4 > boxEnd) break;
					itemId = readUInt32BE(buf, infePos);
					infePos += 4;
				}
				infePos += 2; // item_protection_index
				if (infePos + 4 <= boxEnd) {
					const itemType = toUtf8(buf.slice(infePos, infePos + 4));
					items.push({ itemId, itemType });
				}
			}

			pos = infe.offset + infe.size;
		}

		return items;
	}

	_isobmffParseIloc(
		buf: Uint8Array,
		dataOffset: number,
		boxEnd: number,
	): Array<{
		itemId: number;
		extents: Array<{ offset: number; length: number }>;
	}> {
		const items: Array<{
			itemId: number;
			extents: Array<{ offset: number; length: number }>;
		}> = [];
		if (dataOffset + 4 > boxEnd) return items;

		// iloc is a FullBox: version(1) + flags(3)
		const version = buf[dataOffset];
		let pos = dataOffset + 4;

		if (pos + 2 > boxEnd) return items;
		const sizeByte1 = buf[pos];
		const sizeByte2 = buf[pos + 1];
		const offsetSize = (sizeByte1 >> 4) & 0xf;
		const lengthSize = sizeByte1 & 0xf;
		const baseOffsetSize = (sizeByte2 >> 4) & 0xf;
		const indexSize = version >= 1 ? sizeByte2 & 0xf : 0;
		pos += 2;

		let itemCount: number;
		if (version < 2) {
			if (pos + 2 > boxEnd) return items;
			itemCount = readUInt16BE(buf, pos);
			pos += 2;
		} else {
			if (pos + 4 > boxEnd) return items;
			itemCount = readUInt32BE(buf, pos);
			pos += 4;
		}

		for (let i = 0; i < itemCount && pos < boxEnd; i++) {
			let itemId: number;
			if (version < 2) {
				if (pos + 2 > boxEnd) break;
				itemId = readUInt16BE(buf, pos);
				pos += 2;
			} else {
				if (pos + 4 > boxEnd) break;
				itemId = readUInt32BE(buf, pos);
				pos += 4;
			}

			if (version >= 1) {
				if (pos + 2 > boxEnd) break;
				pos += 2; // construction_method
			}

			if (pos + 2 > boxEnd) break;
			pos += 2; // data_reference_index

			const baseOffset =
				baseOffsetSize > 0
					? this._isobmffReadUintBE(buf, pos, baseOffsetSize)
					: 0;
			pos += baseOffsetSize;

			if (pos + 2 > boxEnd) break;
			const extentCount = readUInt16BE(buf, pos);
			pos += 2;

			const extents: Array<{ offset: number; length: number }> = [];
			for (let j = 0; j < extentCount && pos < boxEnd; j++) {
				if (version >= 1 && indexSize > 0) {
					pos += indexSize; // extent_index
				}
				const extOffset =
					offsetSize > 0 ? this._isobmffReadUintBE(buf, pos, offsetSize) : 0;
				pos += offsetSize;
				const extLength =
					lengthSize > 0 ? this._isobmffReadUintBE(buf, pos, lengthSize) : 0;
				pos += lengthSize;
				extents.push({ offset: baseOffset + extOffset, length: extLength });
			}

			items.push({ itemId, extents });
		}

		return items;
	}

	// PDF offset tracking helpers
	_pdfPush(data: Uint8Array): void {
		this.push(data);
		this.pdfInputOffset += data.length;
		this.pdfOutputOffset += data.length;
	}

	_pdfSkip(n: number): void {
		this.pdfInputOffset += n;
		this.pdfOffsetMap.push([this.pdfInputOffset, this.pdfOutputOffset]);
	}

	_pdfPushModified(origLen: number, newData: Uint8Array): void {
		this.push(newData);
		this.pdfInputOffset += origLen;
		this.pdfOutputOffset += newData.length;
		if (origLen !== newData.length) {
			this.pdfOffsetMap.push([this.pdfInputOffset, this.pdfOutputOffset]);
		}
	}

	_pdfComputeOffset(origOffset: number): number {
		let lastInput = 0;
		let lastOutput = 0;
		for (const [inp, out] of this.pdfOffsetMap) {
			if (inp <= origOffset) {
				lastInput = inp;
				lastOutput = out;
			} else {
				break;
			}
		}
		return lastOutput + (origOffset - lastInput);
	}

	// Process embedded image/file through a new ExifTransformer
	_pdfProcessEmbedded(data: Uint8Array): Uint8Array {
		const chunks: Uint8Array[] = [];
		const sub = new class extends ExifTransformer {
			push(chunk: Uint8Array) {
				if (chunk !== null) chunks.push(newUint8Array(chunk));
				return true;
			}
		};
		const noop = (): void => {};
		sub._transform(data, "binary" as BufferEncoding, noop);
		sub._final(noop);
		return concat(chunks);
	}

	// Scrub Info dictionary keys - remove key-value pairs entirely
	_pdfScrubInfoDict(dictText: string): string {
		let result = dictText;
		for (const key of pdfInfoKeys) {
			const keyIdx = result.indexOf(key);
			if (keyIdx === -1) continue;
			const afterKey = keyIdx + key.length;
			// Find the value - skip whitespace
			let i = afterKey;
			while (
				i < result.length &&
				(result[i] === " " || result[i] === "\n" || result[i] === "\r")
			)
				i++;
			if (i >= result.length) {
				// Key at end with no value — remove just the key
				result = result.substring(0, keyIdx) + result.substring(i);
				continue;
			}
			if (result[i] === "(") {
				// Find matching close paren
				let depth = 0;
				let escaped = false;
				for (; i < result.length; i++) {
					if (escaped) {
						escaped = false;
						continue;
					}
					if (result[i] === "\\") {
						escaped = true;
						continue;
					}
					if (result[i] === "(") depth++;
					if (result[i] === ")") {
						depth--;
						if (depth === 0) {
							i++;
							break;
						}
					}
				}
				result = result.substring(0, keyIdx) + result.substring(i);
			} else if (result[i] === "<") {
				// Hex string
				const end = result.indexOf(">", i);
				if (end !== -1) {
					result = result.substring(0, keyIdx) + result.substring(end + 1);
				}
			}
		}
		return result;
	}

	// Update /Length value in dictionary text
	_pdfUpdateLength(dictText: string, newLength: number): string {
		return dictText.replace(/\/Length\s+\d+/, "/Length " + newLength);
	}

	// Main PDF scrubbing state machine
	_scrubPDF(_atEnd: boolean, chunk?: Uint8Array): void {
		if (chunk) {
			this.pdfPending =
				this.pdfPending.length > 0
					? concat([this.pdfPending, chunk])
					: chunk;
		}
		while (this.pdfPending.length > 0) {
			const buf = this.pdfPending;
			this.pdfPending = new Uint8Array();
			let pos = 0;
			let madeProgress = false;

			while (pos < buf.length) {
				if (this.pdfState === "scanning") {
					if (this.pdfInXref) {
						// Accumulate xref table data until we find startxref
						const startxrefKey = "startxref";
						const remaining = buf.slice(pos);
						const combined = concat([this.pdfXrefBuffer, remaining]);
						const combinedStr = toLatin1(combined);
						const sxIdx = combinedStr.indexOf(startxrefKey);
						if (sxIdx === -1) {
							// Need more data
							this.pdfXrefBuffer = combined;
							pos = buf.length;
							continue;
						}
						// Find the offset value after startxref
						const afterSx = sxIdx + startxrefKey.length;
						const eofIdx = combinedStr.indexOf("%%EOF", afterSx);
						if (eofIdx === -1) {
							this.pdfXrefBuffer = combined;
							pos = buf.length;
							continue;
						}
						// We have the full xref + trailer + startxref + %%EOF
						const endPos = eofIdx + 5;
						// Check for trailing newline
						let realEnd = endPos;
						if (realEnd < combinedStr.length && combinedStr[realEnd] === "\n")
							realEnd++;
						else if (
							realEnd + 1 < combinedStr.length &&
							combinedStr[realEnd] === "\r" &&
							combinedStr[realEnd + 1] === "\n"
						)
							realEnd += 2;

						const fullBlock = combined.slice(0, realEnd);
						const consumedFromBuf = realEnd - this.pdfXrefBuffer.length;
						pos += consumedFromBuf;
						this.pdfXrefBuffer = new Uint8Array();
						this.pdfInXref = false;

						// Process the xref block
						const processed = this._pdfProcessXrefBlock(fullBlock);
						this._pdfPushModified(fullBlock.length, processed);
						continue;
					}

					// Look for << (dict start) or xref keyword
					const searchStart = pos;
					let foundAt = -1;
					let foundType: "dict" | "xref" = "dict";

					for (let i = searchStart; i < buf.length; i++) {
						if (buf[i] === 0x3c && i + 1 < buf.length && buf[i + 1] === 0x3c) {
							// <<
							foundAt = i;
							foundType = "dict";
							break;
						}
						if (buf[i] === 0x78) {
							// 'x'
							const candidate = toLatin1(buf.slice(i, i + 4));
							if (
								candidate === "xref" &&
								(i === 0 ||
									buf[i - 1] === 0x0a ||
									buf[i - 1] === 0x0d ||
									buf[i - 1] === 0x20)
							) {
								// Check character after 'xref'
								if (
									i + 4 >= buf.length ||
									buf[i + 4] === 0x0a ||
									buf[i + 4] === 0x0d ||
									buf[i + 4] === 0x20
								) {
									foundAt = i;
									foundType = "xref";
									break;
								}
							}
						}
					}

					if (foundAt === -1) {
						// No dict or xref found - push everything except last byte (could be partial <)
						if (!_atEnd && buf.length - pos > 0) {
							const safe = buf.length - 1;
							if (safe > pos) {
								this._pdfPush(buf.slice(pos, safe));
								this.pdfPending = buf.slice(safe);
							} else {
								this.pdfPending = buf.slice(pos);
							}
						} else {
							this._pdfPush(buf.slice(pos));
						}
						return;
					}

					// Push everything before the found marker
					if (foundAt > pos) {
						this._pdfPush(buf.slice(pos, foundAt));
					}
					pos = foundAt;

					if (foundType === "xref") {
						this.pdfInXref = true;
						this.pdfXrefBuffer = new Uint8Array();
						this.pdfDictStart = this.pdfInputOffset;
						continue;
					}

					// Start of dictionary
					this.pdfState = "in_dict";
					this.pdfDictBuffer = new Uint8Array();
					this.pdfDictNesting = 0;
					this.pdfStringNesting = 0;
					this.pdfInEscape = false;
					this.pdfDictStart = this.pdfInputOffset;
					continue;
				}

				if (this.pdfState === "in_dict") {
					// Accumulate dict bytes, tracking nesting
					const startPos = pos;
					while (pos < buf.length) {
						const b = buf[pos];
						if (this.pdfStringNesting > 0) {
							if (this.pdfInEscape) {
								this.pdfInEscape = false;
								pos++;
								continue;
							}
							if (b === 0x5c) {
								// backslash
								this.pdfInEscape = true;
								pos++;
								continue;
							}
							if (b === 0x28) {
								// (
								this.pdfStringNesting++;
								pos++;
								continue;
							}
							if (b === 0x29) {
								// )
								this.pdfStringNesting--;
								pos++;
								continue;
							}
							pos++;
							continue;
						}
						if (b === 0x28) {
							// (
							this.pdfStringNesting = 1;
							pos++;
							continue;
						}
						if (b === 0x3c && pos + 1 < buf.length && buf[pos + 1] === 0x3c) {
							// <<
							this.pdfDictNesting++;
							pos += 2;
							continue;
						}
						if (b === 0x3e && pos + 1 < buf.length && buf[pos + 1] === 0x3e) {
							// >>
							this.pdfDictNesting--;
							if (this.pdfDictNesting === 0) {
								pos += 2;
								// Finished dictionary
								this.pdfDictBuffer = concat([
									this.pdfDictBuffer,
									buf.slice(startPos, pos),
								]);
								this._pdfHandleDict(buf, pos);
								madeProgress = true;
								break;
							}
							pos += 2;
							continue;
						}
						pos++;
					}
					if (madeProgress) break; // _pdfHandleDict set pdfPending; outer loop will re-consume
					// Need more data
					this.pdfDictBuffer = concat([
						this.pdfDictBuffer,
						buf.slice(startPos),
					]);
					return;
				}

				if (this.pdfState === "in_stream") {
					const result = this._pdfHandleStream(buf, pos, _atEnd);
					if (result === -1) return; // need more data
					pos = result;
					continue;
				}
			} // end inner while
		} // end outer while
	}

	// Handle completed dictionary
	_pdfHandleDict(buf: Uint8Array, pos: number): void {
		const dictText = toLatin1(this.pdfDictBuffer);
		const dictLen = this.pdfDictBuffer.length;

		// Classify the stream type
		let streamType: PdfStreamType = "pass";
		if (
			/\/Type\s*\/Metadata/.test(dictText) &&
			/\/Subtype\s*\/XML/.test(dictText)
		) {
			streamType = "metadata";
		} else if (
			/\/Subtype\s*\/Image/.test(dictText) &&
			/\/Filter\s*\/DCTDecode/.test(dictText)
		) {
			streamType = "image";
		} else if (/\/Type\s*\/EmbeddedFile/.test(dictText)) {
			streamType = "embedded";
		} else if (/\/Type\s*\/XRef/.test(dictText)) {
			streamType = "xref";
		} else if (!/\/Type\b/.test(dictText) && !/\/Subtype\b/.test(dictText)) {
			// Unclassified stream with no Type/Subtype — buffer and check for
			// application-specific data like Photoshop 8BIM resources
			streamType = "check";
		}

		// Extract /Length
		const lengthMatch = dictText.match(/\/Length\s+(\d+)/);
		const streamLength = lengthMatch ? parseInt(lengthMatch[1], 10) : -1;

		// Scrub info dictionary keys
		const scrubbedDictText = this._pdfScrubInfoDict(dictText);

		// Check if stream keyword follows (must be within ~20 bytes of >>)
		const remaining = buf.slice(pos);
		const searchWindow = remaining.slice(0, 20);
		const streamMatch = this._pdfFindStreamKeyword(searchWindow);

		if (streamMatch === -1) {
			// No stream keyword - this is just a dictionary object
			const scrubbedDict = newUint8Array(scrubbedDictText, "binary");
			this._pdfPushModified(dictLen, scrubbedDict);
			this.pdfState = "scanning";
			this.pdfPending = remaining;
			return;
		}

		// There's a stream keyword
		const beforeStream = remaining.slice(0, streamMatch);
		const afterKeyword = this._pdfStreamKeywordEnd(remaining, streamMatch);
		if (afterKeyword === -1) {
			// Need more data for the stream keyword + newline
			const scrubbedDict = newUint8Array(scrubbedDictText, "binary");
			this._pdfPushModified(dictLen, scrubbedDict);
			this._pdfPush(beforeStream);
			this.pdfState = "in_stream";
			this.pdfStreamType = streamType;
			this.pdfStreamLength = streamLength;
			this.pdfStreamBytesRead = 0;
			this.pdfStreamData = [];
			this.pdfPending = remaining.slice(streamMatch);
			return;
		}

		// We have the full stream header
		const streamHeader = remaining.slice(0, afterKeyword);

		if (streamType === "pass") {
			// Push dict + stream header as-is (but with scrubbed info keys)
			const scrubbedDict = newUint8Array(scrubbedDictText, "binary");
			this._pdfPushModified(dictLen, scrubbedDict);
			this._pdfPush(streamHeader);
			this.pdfState = "in_stream";
			this.pdfStreamType = "pass";
			this.pdfStreamLength = streamLength;
			this.pdfStreamBytesRead = 0;
			this.pdfStreamData = [];
			this.pdfPending = remaining.slice(afterKeyword);
			return;
		}

		// For modified streams, we need to buffer everything
		this.pdfState = "in_stream";
		this.pdfStreamType = streamType;
		this.pdfStreamLength = streamLength;
		this.pdfStreamBytesRead = 0;
		this.pdfStreamData = [];
		// Store the scrubbed dict text for later /Length update
		this._pdfStoredDictText = scrubbedDictText;
		this._pdfStoredDictOrigLen = dictLen;
		this._pdfStoredStreamHeader = streamHeader;
		this._pdfStoredStreamHeaderInputLen = streamHeader.length;
		this.pdfPending = remaining.slice(afterKeyword);
	}

	_pdfStoredDictText: string = "";
	_pdfStoredDictOrigLen: number = 0;
	_pdfStoredStreamHeader: Uint8Array = new Uint8Array();
	_pdfStoredStreamHeaderInputLen: number = 0;

	_pdfFindStreamKeyword(buf: Uint8Array): number {
		// Look for 'stream' not preceded by 'end'
		let idx = 0;
		while (idx < buf.length) {
			const si = indexOf(buf, "stream", idx);
			if (si === -1) return -1;
			// Make sure it's not 'endstream'
			if (si >= 3) {
				const before = toUtf8(buf.slice(si - 3, si));
				if (before === "end") {
					idx = si + 6;
					continue;
				}
			}
			// Check that before 'stream' we have whitespace or >>
			if (si > 0) {
				const prevByte = buf[si - 1];
				if (
					prevByte !== 0x0a &&
					prevByte !== 0x0d &&
					prevByte !== 0x20 &&
					prevByte !== 0x3e
				) {
					idx = si + 6;
					continue;
				}
			}
			return si;
		}
		return -1;
	}

	_pdfStreamKeywordEnd(buf: Uint8Array, streamStart: number): number {
		// stream keyword is followed by \r\n or \n
		const afterStream = streamStart + 6; // length of 'stream'
		if (afterStream >= buf.length) return -1;
		if (buf[afterStream] === 0x0a) return afterStream + 1;
		if (buf[afterStream] === 0x0d) {
			if (afterStream + 1 >= buf.length) return -1;
			if (buf[afterStream + 1] === 0x0a) return afterStream + 2;
			return afterStream + 1;
		}
		// Some PDFs have stream followed directly by content
		return afterStream;
	}

	// Handle stream content
	_pdfHandleStream(buf: Uint8Array, pos: number, _atEnd: boolean): number {
		if (this.pdfStreamType === "pass") {
			return this._pdfHandlePassStream(buf, pos, _atEnd);
		}
		return this._pdfHandleModifiedStream(buf, pos, _atEnd);
	}

	_pdfHandlePassStream(buf: Uint8Array, pos: number, _atEnd: boolean): number {
		if (this.pdfStreamLength >= 0) {
			const remaining = this.pdfStreamLength - this.pdfStreamBytesRead;
			const available = buf.length - pos;
			if (available >= remaining) {
				// Push stream content
				this._pdfPush(buf.slice(pos, pos + remaining));
				this.pdfStreamBytesRead = this.pdfStreamLength;
				this.pdfState = "scanning";
				return pos + remaining;
			} else {
				this._pdfPush(buf.slice(pos));
				this.pdfStreamBytesRead += available;
				return buf.length;
			}
		}
		// Unknown length - scan for endstream
		const searchBuf = buf.slice(pos);
		const endIdx = indexOf(searchBuf, "\nendstream");
		const endIdx2 = indexOf(searchBuf, "\r\nendstream");
		let endPos = -1;
		let endLen = 0;
		if (endIdx !== -1 && (endIdx2 === -1 || endIdx <= endIdx2)) {
			endPos = endIdx;
			endLen = 1; // the \n
		} else if (endIdx2 !== -1) {
			endPos = endIdx2;
			endLen = 2; // the \r\n
		}
		if (endPos !== -1) {
			this._pdfPush(buf.slice(pos, pos + endPos + endLen));
			this.pdfState = "scanning";
			return pos + endPos + endLen;
		}
		// Hold back last 12 bytes in case endstream straddles chunk boundary
		if (!_atEnd && searchBuf.length > 12) {
			this._pdfPush(buf.slice(pos, buf.length - 12));
			this.pdfPending = buf.slice(buf.length - 12);
			return -1;
		}
		this._pdfPush(buf.slice(pos));
		return buf.length;
	}

	_pdfHandleModifiedStream(buf: Uint8Array, pos: number, _atEnd: boolean): number {
		if (this.pdfStreamLength >= 0) {
			const remaining = this.pdfStreamLength - this.pdfStreamBytesRead;
			const available = buf.length - pos;
			if (available >= remaining) {
				this.pdfStreamData.push(buf.slice(pos, pos + remaining));
				this.pdfStreamBytesRead = this.pdfStreamLength;
				this._pdfFinishModifiedStream();
				this.pdfState = "scanning";
				return pos + remaining;
			} else {
				this.pdfStreamData.push(buf.slice(pos));
				this.pdfStreamBytesRead += available;
				return buf.length;
			}
		}
		// Unknown length - scan for endstream
		const searchBuf = buf.slice(pos);
		const endIdx = indexOf(searchBuf, "\nendstream");
		const endIdx2 = indexOf(searchBuf, "\r\nendstream");
		let endPos = -1;
		if (endIdx !== -1 && (endIdx2 === -1 || endIdx <= endIdx2)) {
			endPos = endIdx;
		} else if (endIdx2 !== -1) {
			endPos = endIdx2;
		}
		if (endPos !== -1) {
			this.pdfStreamData.push(buf.slice(pos, pos + endPos));
			this.pdfStreamLength = concat(this.pdfStreamData).length;
			this.pdfStreamBytesRead = this.pdfStreamLength;
			this._pdfFinishModifiedStream();
			this.pdfState = "scanning";
			// Return position after stream data but before \n/\r\n endstream
			return pos + endPos;
		}
		if (!_atEnd && searchBuf.length > 12) {
			this.pdfStreamData.push(buf.slice(pos, buf.length - 12));
			this.pdfPending = buf.slice(buf.length - 12);
			return -1;
		}
		this.pdfStreamData.push(buf.slice(pos));
		return buf.length;
	}

	_pdfFinishModifiedStream(): void {
		const streamContent = concat(this.pdfStreamData);
		const origStreamLen = streamContent.length;
		let newContent: Uint8Array;

		if (this.pdfStreamType === "metadata") {
			// Remove metadata entirely - replace with empty
			newContent = new Uint8Array();
		} else if (
			this.pdfStreamType === "image" ||
			this.pdfStreamType === "embedded"
		) {
			newContent = this._pdfProcessEmbedded(streamContent);
		} else if (this.pdfStreamType === "xref") {
			newContent = this._pdfProcessXrefStream(
				streamContent,
				this._pdfStoredDictText,
			);
		} else if (this.pdfStreamType === "check") {
			// Check for Photoshop 8BIM resource data
			if (
				streamContent.length >= 4 &&
				streamContent[0] === 0x38 && // '8'
				streamContent[1] === 0x42 && // 'B'
				streamContent[2] === 0x49 && // 'I'
				streamContent[3] === 0x4d    // 'M'
			) {
				newContent = new Uint8Array();
			} else {
				newContent = streamContent;
			}
		} else {
			newContent = streamContent;
		}

		// Update /Length in dict
		let dictText = this._pdfStoredDictText;
		if (this.pdfStreamType === "metadata") {
			dictText = this._pdfUpdateLength(dictText, 0);
		} else if (newContent.length !== origStreamLen) {
			dictText = this._pdfUpdateLength(dictText, newContent.length);
		}

		const dictBuf = newUint8Array(dictText, "binary");
		const streamHeader = this._pdfStoredStreamHeader;
		const totalOrigLen =
			this._pdfStoredDictOrigLen +
			this._pdfStoredStreamHeaderInputLen +
			origStreamLen;
		const totalNewData = concat([dictBuf, streamHeader, newContent]);

		this._pdfPushModified(totalOrigLen, totalNewData);

		// Reset stored state
		this._pdfStoredDictText = "";
		this._pdfStoredDictOrigLen = 0;
		this._pdfStoredStreamHeader = new Uint8Array();
		this._pdfStoredStreamHeaderInputLen = 0;
	}

	// Process traditional xref block
	_pdfProcessXrefBlock(block: Uint8Array): Uint8Array {
		const text = toLatin1(block);
		const lines = text.split(/\r?\n|\r/);
		const result: string[] = [];

		let inEntries = false;
		for (const line of lines) {
			if (line === "xref" || line === "") {
				result.push(line);
				inEntries = true;
				continue;
			}
			// Subsection header: startObj count
			const subsectionMatch = line.match(/^(\d+)\s+(\d+)\s*$/);
			if (subsectionMatch) {
				result.push(line);
				continue;
			}
			// Entry: 10-digit offset, 5-digit gen, n or f
			const entryMatch = line.match(/^(\d{10})\s+(\d{5})\s+(n|f)\s*$/);
			if (entryMatch && inEntries) {
				const offset = parseInt(entryMatch[1], 10);
				const gen = entryMatch[2];
				const status = entryMatch[3];
				if (status === "n") {
					const newOffset = this._pdfComputeOffset(offset);
					result.push(
						String(newOffset).padStart(10, "0") +
							" " +
							gen +
							" " +
							status +
							" ",
					);
				} else {
					result.push(line);
				}
				continue;
			}
			// trailer, startxref, etc
			if (line.startsWith("trailer")) {
				inEntries = false;
				result.push(line);
				continue;
			}
			if (line === "startxref") {
				result.push(line);
				continue;
			}
			// startxref offset value
			const offsetVal = line.match(/^(\d+)$/);
			if (offsetVal) {
				const orig = parseInt(offsetVal[1], 10);
				const newVal = this._pdfComputeOffset(orig);
				result.push(String(newVal));
				continue;
			}
			// /Prev in trailer
			const prevLine = line.replace(
				/\/Prev\s+(\d+)/g,
				(_match: string, p1: string) => {
					const orig = parseInt(p1, 10);
					return "/Prev " + this._pdfComputeOffset(orig);
				},
			);
			result.push(prevLine);
		}

		return newUint8Array(result.join("\n"), "binary");
	}

	// Process cross-reference stream
	_pdfProcessXrefStream(streamContent: Uint8Array, dictText: string): Uint8Array {
		// Extract /W array for field widths
		const wMatch = dictText.match(/\/W\s*\[(\d+)\s+(\d+)\s+(\d+)\]/);
		if (!wMatch) return streamContent;

		const w1 = parseInt(wMatch[1], 10);
		const w2 = parseInt(wMatch[2], 10);
		const w3 = parseInt(wMatch[3], 10);
		const entrySize = w1 + w2 + w3;

		// Check if content is compressed
		let data: Uint8Array;
		const isCompressed = /\/Filter\s*\/FlateDecode/.test(dictText);
		try {
			data = isCompressed
				? inflateSync(streamContent)
				: newUint8Array(streamContent);
		} catch (_e) {
			return streamContent;
		}

		// Parse and adjust entries
		const result = newUint8Array(data);
		for (let i = 0; i + entrySize <= result.length; i += entrySize) {
			// Read type field
			let type = 0;
			if (w1 === 0) {
				type = 1; // default
			} else {
				for (let j = 0; j < w1; j++) {
					type = (type << 8) | result[i + j];
				}
			}

			// Type 1 = regular object with byte offset
			if (type === 1 && w2 > 0) {
				let offset = 0;
				for (let j = 0; j < w2; j++) {
					offset = (offset << 8) | result[i + w1 + j];
				}
				const newOffset = this._pdfComputeOffset(offset);
				// Write back
				for (let j = w2 - 1; j >= 0; j--) {
					result[i + w1 + j] = newOffset & 0xff;
					// Use unsigned right shift
					offset = newOffset >>> (8 * (w2 - 1 - j));
				}
				// Write properly
				let val = newOffset;
				for (let j = w2 - 1; j >= 0; j--) {
					result[i + w1 + j] = val & 0xff;
					val = Math.floor(val / 256);
				}
			}
		}

		// Recompress if needed
		if (isCompressed) {
			try {
				return deflateSync(result);
			} catch (_e) {
				return streamContent;
			}
		}
		return result;
	}
}

export default class ExifTransformerWeb extends TransformStream<Uint8Array | PromiseLike<Uint8Array>, Uint8Array> {
	constructor() {
		const transformer = new ExifTransformer();
		super({
			start(controller) {
				transformer.onchunk = (chunk) => {
					controller.enqueue(chunk);
				};	
			},
			async transform(chunk, controller) {
    			chunk = await chunk;
				
				return new Promise((resolve) => {
					transformer._transform(
						newUint8Array(chunk),
						"binary",
						(err) => {
							if (err) {
								controller.error(err);
							}
							resolve();
						},
					);
				});
			},
			flush(controller) {
				return new Promise((resolve) => {
					transformer._final((err) => {
						if (err) {
							controller.error(err);
						}
						resolve();
					});
				});
			},
		});
	}
}
