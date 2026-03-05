# Exif be gone

Zero dependency stream transformer to remove data that could be potentially private.

### Supported formats

- **JPEG** — Removes APP1 sections containing Exif, XMP, or FLIR data.
- **PNG** — Removes `tIME`, `iTXt`, `tEXt`, `zTXt`, `eXIf`, and `dSIG` chunks.
- **WebP** — Removes `EXIF` and `XMP` RIFF chunks.
- **TIFF** — Strips Exif, GPS, and Interop sub-IFDs, XMP, IPTC, Photoshop image resources, artist, copyright, and image description tags. Supports both little-endian and big-endian byte orders.
- **HEIC/HEIF** — Zeroes Exif and XMP item data within the ISOBMFF container.
- **AVIF** — Zeroes Exif and XMP item data within the ISOBMFF container.
- **PDF** — Scrubs Info dictionary values (title, author, etc.) and removes XMP metadata streams. Strips embedded JPEG Exif data. Adjusts cross-reference offsets.

## Installation

Use `npm install exif-be-gone` to install this package.

## Example usage

```javascript
const ExifTransformer = require('exif-be-gone')
const fs = require("fs")

const reader = fs.createReadStream('Canon_40D.jpg')
const writer = fs.createWriteStream('out.jpg')

reader.pipe(new ExifTransformer()).pipe(writer)
```

There is also a command-line version that is installed that can be run via:

`$ exif-be-gone [INPUT] [OUTPUT]`
