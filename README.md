# Exif be gone (Web port)

Zero dependency stream transformer to remove data that could be potentially private.

This is a port of the upstream library by [Joshua Hull](https://github.com/joshbuddy/exif-be-gone) to work in web and
React Native environments. It uses roughly the same API and supports the same formats as the original library.

### Supported formats

- **JPEG** — Removes APP1 (Exif, XMP, FLIR), APP2 (FlashPix, but preserves ICC color profiles), APP12 (Ducky), APP13 (IPTC/Photoshop), and COM (comment) segments.
- **PNG** — Removes `tIME`, `iTXt`, `tEXt`, `zTXt`, `eXIf`, and `dSIG` chunks.
- **WebP** — Removes `EXIF` and `XMP` RIFF chunks.
- **GIF** — Strips Comment Extensions and XMP Application Extensions while preserving animation (NETSCAPE2.0) and image data.
- **TIFF** — Strips Exif, GPS, and Interop sub-IFDs, XMP, IPTC, Photoshop image resources, artist, copyright, and image description tags. Supports both little-endian and big-endian byte orders.
- **HEIC/HEIF** — Zeroes Exif and XMP item data within the ISOBMFF container.
- **AVIF** — Zeroes Exif and XMP item data within the ISOBMFF container.
- **JPEG XL** — Strips Exif, XMP, and Brotli-compressed metadata boxes from ISOBMFF container JXL files.
- **PDF** — Scrubs Info dictionary values (title, author, etc.) and removes XMP metadata streams. Strips embedded JPEG Exif data. Adjusts cross-reference offsets.

## Installation

Use `npm install @uwx/exif-be-gone-web` to install this package.
    
## Example usage

```javascript
const ExifTransformer = require('@uwx/exif-be-gone-web')
const fs = require("fs")

const reader = fs.createReadStream('Canon_40D.jpg')
const writer = fs.createWriteStream('out.jpg')

Reader.toWeb(reader).pipeThrough(new ExifTransformer()).pipeTo(Writer.toWeb(writer))
```

There is also a command-line version that is installed that can be run via:

`$ exif-be-gone [INPUT] [OUTPUT]`
