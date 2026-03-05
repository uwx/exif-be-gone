/* global it, describe */

const streamBuffers = require('stream-buffers')
const assert = require('chai').assert
const fs = require('fs')
const ExifBeGone = require('..')
const stream = require('stream')

describe('Exif be gone', () => {
  describe('stripping exif data', () => {
    it('should strip data', (done) => {
      const writer = new streamBuffers.WritableStreamBuffer()
      fs.createReadStream('Canon_40D.jpg').pipe(new ExifBeGone()).pipe(writer).on('finish', () => {
        assert.equal(writer.getContents().length, 5480)
        done()
      })
    })

    it('should still strip with partial chunks', (done) => {
      const writer = new streamBuffers.WritableStreamBuffer()
      const lengthBuf = Buffer.allocUnsafe(2)
      lengthBuf.writeInt16BE(8, 0)
      const readable = stream.Readable.from([
        Buffer.from('ff', 'hex'),
        Buffer.from('e1', 'hex'),
        lengthBuf,
        Buffer.from('457869', 'hex'),
        Buffer.from('660000', 'hex'),
        Buffer.from('0001020304050607', 'hex'),
        Buffer.from('08090a0b0c0d0e0f', 'hex'),
        Buffer.from('0001020304050607', 'hex'),
        Buffer.from('08090a0b0c0d0e0f', 'hex')
      ])
      readable.pipe(new ExifBeGone()).pipe(writer).on('finish', () => {
        const output = writer.getContents()
        assert.equal(output.length, 32)
        done()
      })
    })
  })

  describe('PDF support', () => {
    // Helper to build a minimal PDF
    function buildPDF (objects: string[], xrefAndTrailer?: string): Buffer {
      const header = '%PDF-1.4\n'
      let body = ''
      const offsets: number[] = []
      for (const obj of objects) {
        offsets.push(header.length + body.length)
        body += obj + '\n'
      }
      const xrefOffset = header.length + body.length
      let xref: string
      if (xrefAndTrailer) {
        xref = xrefAndTrailer
      } else {
        xref = 'xref\n0 ' + (objects.length + 1) + '\n'
        xref += '0000000000 65535 f \n'
        for (let i = 0; i < offsets.length; i++) {
          xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
        }
        xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' >>\n'
        xref += 'startxref\n' + xrefOffset + '\n%%EOF\n'
      }
      return Buffer.from(header + body + xref, 'binary')
    }

    function processPDF (input: Buffer): Promise<Buffer> {
      return new Promise((resolve, reject) => {
        const writer = new streamBuffers.WritableStreamBuffer()
        const readable = stream.Readable.from([input])
        readable.pipe(new ExifBeGone()).pipe(writer)
          .on('finish', () => resolve(writer.getContents()))
          .on('error', reject)
      })
    }

    it('should detect PDF by header', async () => {
      const pdf = buildPDF(['1 0 obj\n<< /Type /Catalog >>\nendobj'])
      const output = await processPDF(pdf)
      assert.ok(output.slice(0, 5).toString() === '%PDF-')
    })

    it('should not affect non-PDF files', async () => {
      const data = Buffer.from('Hello, this is not a PDF')
      const output = await processPDF(data)
      assert.equal(output.toString(), data.toString())
    })

    it('should scrub Info dictionary string values', async () => {
      const pdf = buildPDF([
        '1 0 obj\n<< /Type /Catalog >>\nendobj',
        '2 0 obj\n<< /Title (My Secret Title) /Author (John Doe) /CreationDate (D:20200101) >>\nendobj'
      ])
      const output = await processPDF(pdf)
      const text = output.toString('binary')
      assert.ok(text.indexOf('/Title ()') !== -1, 'Title should be emptied')
      assert.ok(text.indexOf('/Author ()') !== -1, 'Author should be emptied')
      assert.ok(text.indexOf('My Secret Title') === -1, 'Title content should be removed')
      assert.ok(text.indexOf('John Doe') === -1, 'Author content should be removed')
    })

    it('should scrub Info dictionary hex string values', async () => {
      const pdf = buildPDF([
        '1 0 obj\n<< /Type /Catalog >>\nendobj',
        '2 0 obj\n<< /Producer <48656C6C6F> >>\nendobj'
      ])
      const output = await processPDF(pdf)
      const text = output.toString('binary')
      assert.ok(text.indexOf('/Producer <>') !== -1, 'Producer hex should be emptied')
    })

    it('should remove XMP metadata stream content', async () => {
      const xmpContent = '<?xml version="1.0"?><x:xmpmeta>secret metadata</x:xmpmeta>'
      const obj = '1 0 obj\n<< /Type /Metadata /Subtype /XML /Length ' + xmpContent.length + ' >>\nstream\n' + xmpContent + '\nendstream\nendobj'
      const pdf = buildPDF([obj])
      const output = await processPDF(pdf)
      const text = output.toString('binary')
      assert.ok(text.indexOf('secret metadata') === -1, 'XMP content should be removed')
      assert.ok(text.indexOf('/Length 0') !== -1 || text.indexOf('/Length  0') !== -1, 'Length should be 0')
    })

    it('should pass through non-metadata streams unchanged', async () => {
      const content = 'BT /F1 12 Tf (Hello World) Tj ET'
      const obj = '1 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj'
      const pdf = buildPDF([obj])
      const output = await processPDF(pdf)
      const text = output.toString('binary')
      assert.ok(text.indexOf('Hello World') !== -1, 'Content stream should be preserved')
    })

    it('should handle chunk boundaries across dict markers', async () => {
      const pdf = buildPDF([
        '1 0 obj\n<< /Title (Secret) /Author (Someone) >>\nendobj'
      ])
      // Split into small chunks to test boundary handling
      const chunks: Buffer[] = []
      for (let i = 0; i < pdf.length; i += 10) {
        chunks.push(pdf.slice(i, Math.min(i + 10, pdf.length)))
      }
      const output: Buffer = await new Promise((resolve, reject) => {
        const writer = new streamBuffers.WritableStreamBuffer()
        const readable = stream.Readable.from(chunks)
        readable.pipe(new ExifBeGone()).pipe(writer)
          .on('finish', () => resolve(writer.getContents()))
          .on('error', reject)
      })
      const text = output.toString('binary')
      assert.ok(text.indexOf('/Title ()') !== -1, 'Title should be emptied even with chunked input')
      assert.ok(text.indexOf('Secret') === -1, 'Secret should be removed')
    })

    it('should produce valid PDF structure', async () => {
      const pdf = buildPDF([
        '1 0 obj\n<< /Type /Catalog >>\nendobj',
        '2 0 obj\n<< /Title (Test) >>\nendobj'
      ])
      const output = await processPDF(pdf)
      const text = output.toString('binary')
      assert.ok(text.startsWith('%PDF-'), 'Should start with PDF header')
      assert.ok(text.indexOf('%%EOF') !== -1, 'Should contain %%EOF')
      assert.ok(text.indexOf('xref') !== -1, 'Should contain xref')
      assert.ok(text.indexOf('startxref') !== -1, 'Should contain startxref')
    })

    it('should adjust xref offsets after metadata removal', async () => {
      // Object 1: Catalog (unchanged)
      // Object 2: Info dict with metadata (will be scrubbed, shrinking the file)
      // Object 3: Another object (whose offset should be adjusted)
      const obj1 = '1 0 obj\n<< /Type /Catalog >>\nendobj'
      const obj2 = '2 0 obj\n<< /Author (A Very Long Author Name That Will Be Removed) >>\nendobj'
      const obj3 = '3 0 obj\n<< /Type /Page >>\nendobj'
      const pdf = buildPDF([obj1, obj2, obj3])
      const output = await processPDF(pdf)
      const text = output.toString('binary')

      // Extract the xref offset for object 3 from output
      const xrefStart = text.indexOf('xref')
      assert.ok(xrefStart !== -1, 'Should have xref')

      // Find object 3 in the output and check xref points to it
      const obj3pos = text.indexOf('3 0 obj')
      assert.ok(obj3pos !== -1, 'Object 3 should exist')

      // Parse xref entries
      const xrefSection = text.substring(xrefStart)
      const entries = xrefSection.match(/(\d{10}) \d{5} n /g)
      if (entries && entries.length >= 3) {
        const obj3offset = parseInt(entries[2].substring(0, 10), 10)
        assert.equal(obj3offset, obj3pos, 'Xref offset for object 3 should match actual position')
      }
    })
  })

  describe('TIFF support', () => {
    function processBuffer (input: Buffer): Promise<Buffer> {
      return new Promise((resolve, reject) => {
        const writer = new streamBuffers.WritableStreamBuffer()
        const readable = stream.Readable.from([input])
        readable.pipe(new ExifBeGone()).pipe(writer)
          .on('finish', () => resolve(writer.getContents()))
          .on('error', reject)
      })
    }

    // Build a minimal TIFF with given IFD entries
    // entries: array of {tag, type, count, value: Buffer(4)}
    // remoteData: array of {offset: number, data: Buffer} (filled after layout)
    function buildTIFF (
      le: boolean,
      entries: Array<{ tag: number, type: number, count: number, value: Buffer }>,
      remoteBlocks?: Array<Buffer>,
      nextIFDEntries?: Array<{ tag: number, type: number, count: number, value: Buffer }>
    ): Buffer {
      const writeU16 = le
        ? (b: Buffer, v: number, o: number) => b.writeUInt16LE(v, o)
        : (b: Buffer, v: number, o: number) => b.writeUInt16BE(v, o)
      const writeU32 = le
        ? (b: Buffer, v: number, o: number) => b.writeUInt32LE(v, o)
        : (b: Buffer, v: number, o: number) => b.writeUInt32BE(v, o)

      // Layout: header(8) + IFD0(2 + entries*12 + 4) + remote data + optional IFD1
      const ifd0Offset = 8
      const ifd0Size = 2 + entries.length * 12 + 4
      let remoteStart = ifd0Offset + ifd0Size
      const remoteOffsets: number[] = []
      if (remoteBlocks) {
        for (const block of remoteBlocks) {
          remoteOffsets.push(remoteStart)
          remoteStart += block.length
        }
      }

      let ifd1Offset = 0
      let ifd1Size = 0
      if (nextIFDEntries) {
        ifd1Offset = remoteStart
        ifd1Size = 2 + nextIFDEntries.length * 12 + 4
      }

      const totalSize = remoteStart + ifd1Size
      const buf = Buffer.alloc(totalSize)

      // Header
      if (le) {
        buf[0] = 0x49; buf[1] = 0x49; writeU16(buf, 42, 2)
      } else {
        buf[0] = 0x4D; buf[1] = 0x4D; writeU16(buf, 42, 2)
      }
      writeU32(buf, ifd0Offset, 4)

      // IFD0
      writeU16(buf, entries.length, ifd0Offset)
      for (let i = 0; i < entries.length; i++) {
        const off = ifd0Offset + 2 + i * 12
        writeU16(buf, entries[i].tag, off)
        writeU16(buf, entries[i].type, off + 2)
        writeU32(buf, entries[i].count, off + 4)
        entries[i].value.copy(buf, off + 8)
      }
      // Next IFD pointer
      writeU32(buf, ifd1Offset, ifd0Offset + 2 + entries.length * 12)

      // Remote data
      if (remoteBlocks) {
        for (let i = 0; i < remoteBlocks.length; i++) {
          remoteBlocks[i].copy(buf, remoteOffsets[i])
        }
      }

      // IFD1
      if (nextIFDEntries && ifd1Offset > 0) {
        writeU16(buf, nextIFDEntries.length, ifd1Offset)
        for (let i = 0; i < nextIFDEntries.length; i++) {
          const off = ifd1Offset + 2 + i * 12
          writeU16(buf, nextIFDEntries[i].tag, off)
          writeU16(buf, nextIFDEntries[i].type, off + 2)
          writeU32(buf, nextIFDEntries[i].count, off + 4)
          nextIFDEntries[i].value.copy(buf, off + 8)
        }
        writeU32(buf, 0, ifd1Offset + 2 + nextIFDEntries.length * 12)
      }

      return buf
    }

    function makeValueU32 (le: boolean, val: number): Buffer {
      const b = Buffer.alloc(4)
      if (le) b.writeUInt32LE(val, 0); else b.writeUInt32BE(val, 0)
      return b
    }

    function makeValueU16Padded (le: boolean, val: number): Buffer {
      const b = Buffer.alloc(4, 0)
      if (le) b.writeUInt16LE(val, 0); else b.writeUInt16BE(val, 0)
      return b
    }

    it('should detect LE TIFF', async () => {
      const tiff = buildTIFF(true, [
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(true, 640) }
      ])
      const output = await processBuffer(tiff)
      assert.equal(output[0], 0x49)
      assert.equal(output[1], 0x49)
    })

    it('should detect BE TIFF', async () => {
      const tiff = buildTIFF(false, [
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(false, 640) }
      ])
      const output = await processBuffer(tiff)
      assert.equal(output[0], 0x4D)
      assert.equal(output[1], 0x4D)
    })

    it('should strip ExifIFD pointer and zero sub-IFD', async () => {
      const le = true
      // Build a sub-IFD at a known offset - we'll place it in remote data
      // Sub-IFD: 1 entry (ExifVersion tag 0x9000, type 7/UNDEFINED, count 4, value inline)
      const subIFD = Buffer.alloc(2 + 1 * 12 + 4, 0)
      subIFD.writeUInt16LE(1, 0) // 1 entry
      subIFD.writeUInt16LE(0x9000, 2) // ExifVersion
      subIFD.writeUInt16LE(7, 4)      // UNDEFINED
      subIFD.writeUInt32LE(4, 6)      // count
      subIFD.write('0231', 10)        // value inline
      // next IFD = 0

      // The sub-IFD will be at offset = 8 + (2 + 2*12 + 4) = 8 + 30 = 38
      const subIFDOffset = 8 + 2 + 2 * 12 + 4
      const tiff = buildTIFF(le, [
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) }, // ImageWidth - keep
        { tag: 0x8769, type: 4, count: 1, value: makeValueU32(le, subIFDOffset) }  // ExifIFD - strip
      ], [subIFD])

      const output = await processBuffer(tiff)
      // ExifIFD entry should be gone, only ImageWidth remains
      const entryCount = output.readUInt16LE(8)
      assert.equal(entryCount, 1, 'Should have 1 entry after stripping')
      const remainingTag = output.readUInt16LE(10)
      assert.equal(remainingTag, 0x0100, 'Remaining tag should be ImageWidth')
      // Sub-IFD should be zeroed
      const subIFDRegion = output.slice(subIFDOffset, subIFDOffset + subIFD.length)
      assert.ok(subIFDRegion.every((b: number) => b === 0), 'Sub-IFD should be zeroed')
    })

    it('should strip GPSIFD pointer', async () => {
      const le = true
      const subIFDOffset = 8 + 2 + 1 * 12 + 4
      const subIFD = Buffer.alloc(2 + 4, 0) // empty sub-IFD: 0 entries + next=0
      const tiff = buildTIFF(le, [
        { tag: 0x8825, type: 4, count: 1, value: makeValueU32(le, subIFDOffset) } // GPSIFD
      ], [subIFD])

      const output = await processBuffer(tiff)
      const entryCount = output.readUInt16LE(8)
      assert.equal(entryCount, 0, 'Should have 0 entries after stripping GPS')
    })

    it('should strip XMP data (remote)', async () => {
      const le = true
      const xmpData = Buffer.from('<x:xmpmeta>secret XMP data here!</x:xmpmeta>')
      const remoteOffset = 8 + 2 + 2 * 12 + 4
      const tiff = buildTIFF(le, [
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) },
        { tag: 0x02BC, type: 1, count: xmpData.length, value: makeValueU32(le, remoteOffset) } // XMP
      ], [xmpData])

      const output = await processBuffer(tiff)
      const xmpRegion = output.slice(remoteOffset, remoteOffset + xmpData.length)
      assert.ok(xmpRegion.every((b: number) => b === 0), 'XMP data should be zeroed')
    })

    it('should strip inline metadata (short ImageDescription)', async () => {
      const le = true
      const value = Buffer.alloc(4, 0)
      value.write('Hi', 0)
      const tiff = buildTIFF(le, [
        { tag: 0x010E, type: 2, count: 2, value }, // ImageDescription, inline
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 320) }
      ])

      const output = await processBuffer(tiff)
      const entryCount = output.readUInt16LE(8)
      assert.equal(entryCount, 1, 'Only ImageWidth should remain')
      const tag = output.readUInt16LE(10)
      assert.equal(tag, 0x0100)
    })

    it('should strip remote metadata (long ImageDescription)', async () => {
      const le = true
      const desc = Buffer.from('This is a long image description that exceeds 4 bytes')
      const remoteOffset = 8 + 2 + 2 * 12 + 4
      const tiff = buildTIFF(le, [
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) },
        { tag: 0x010E, type: 2, count: desc.length, value: makeValueU32(le, remoteOffset) }
      ], [desc])

      const output = await processBuffer(tiff)
      const descRegion = output.slice(remoteOffset, remoteOffset + desc.length)
      assert.ok(descRegion.every((b: number) => b === 0), 'Remote description should be zeroed')
    })

    it('should preserve image tags', async () => {
      const le = true
      const tiff = buildTIFF(le, [
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) },  // ImageWidth
        { tag: 0x0101, type: 3, count: 1, value: makeValueU16Padded(le, 480) },  // ImageLength
        { tag: 0x0102, type: 3, count: 1, value: makeValueU16Padded(le, 8) }     // BitsPerSample
      ])

      const output = await processBuffer(tiff)
      const entryCount = output.readUInt16LE(8)
      assert.equal(entryCount, 3, 'All 3 image tags should be preserved')
    })

    it('should walk IFD chain and strip metadata in second IFD', async () => {
      const le = true
      const tiff = buildTIFF(le, [
        { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) }
      ], [], [
        { tag: 0x010E, type: 2, count: 2, value: Buffer.from('Hi\0\0') }, // ImageDescription in IFD1
        { tag: 0x0101, type: 3, count: 1, value: makeValueU16Padded(le, 480) }
      ])

      const output = await processBuffer(tiff)
      // IFD0 should still have 1 entry
      const ifd0Count = output.readUInt16LE(8)
      assert.equal(ifd0Count, 1)

      // Find IFD1 offset
      const ifd1Ptr = output.readUInt32LE(8 + 2 + 1 * 12)
      if (ifd1Ptr > 0 && ifd1Ptr + 2 <= output.length) {
        const ifd1Count = output.readUInt16LE(ifd1Ptr)
        assert.equal(ifd1Count, 1, 'IFD1 should have 1 entry after stripping ImageDescription')
        const tag = output.readUInt16LE(ifd1Ptr + 2)
        assert.equal(tag, 0x0101, 'Remaining tag in IFD1 should be ImageLength')
      }
    })

    it('should handle truncated TIFF without crashing', async () => {
      const truncated = Buffer.from('49492a00', 'hex') // Just the header, no IFD offset data
      const output = await processBuffer(truncated)
      assert.ok(output.length === truncated.length, 'Should pass through unchanged')
    })
  })

  describe('ISOBMFF support (HEIC/AVIF)', () => {
    function processBuffer (input: Buffer): Promise<Buffer> {
      return new Promise((resolve, reject) => {
        const writer = new streamBuffers.WritableStreamBuffer()
        const readable = stream.Readable.from([input])
        readable.pipe(new ExifBeGone()).pipe(writer)
          .on('finish', () => resolve(writer.getContents()))
          .on('error', reject)
      })
    }

    function writeBox (type: string, payload: Buffer): Buffer {
      const size = 8 + payload.length
      const buf = Buffer.alloc(size)
      buf.writeUInt32BE(size, 0)
      buf.write(type, 4, 4, 'utf-8')
      payload.copy(buf, 8)
      return buf
    }

    function writeFullBox (type: string, version: number, flags: number, payload: Buffer): Buffer {
      const vf = Buffer.alloc(4)
      vf.writeUInt32BE((version << 24) | (flags & 0xFFFFFF), 0)
      return writeBox(type, Buffer.concat([vf, payload]))
    }

    // Build a minimal ISOBMFF with ftyp, meta (with iinf, iloc), and mdat
    function buildISOBMFF (
      brand: string,
      items: Array<{ itemId: number, itemType: string, data: Buffer }>,
      imageData?: Buffer
    ): Buffer {
      // ftyp box
      const ftypPayload = Buffer.alloc(8)
      ftypPayload.write(brand, 0, 4, 'utf-8')
      ftypPayload.writeUInt32BE(0, 4) // minor version
      const ftypBox = writeBox('ftyp', ftypPayload)

      // We'll compute mdat content and offsets after knowing the layout
      // First build iinf and iloc, then compute mdat offset

      // Build infe boxes
      const infeBoxes: Buffer[] = []
      for (const item of items) {
        // infe v2: item_id(2) + protection_index(2) + item_type(4)
        const infePayload = Buffer.alloc(8)
        infePayload.writeUInt16BE(item.itemId, 0)
        infePayload.writeUInt16BE(0, 2) // protection index
        infePayload.write(item.itemType, 4, 4, 'utf-8')
        infeBoxes.push(writeFullBox('infe', 2, 0, infePayload))
      }

      // iinf box: version 0, entry count (2 bytes)
      const iinfPayload = Buffer.alloc(2)
      iinfPayload.writeUInt16BE(items.length, 0)
      const iinfContent = Buffer.concat([iinfPayload, ...infeBoxes])
      const iinfBox = writeFullBox('iinf', 0, 0, iinfContent)

      // iloc box: version 0, offset_size=4, length_size=4, base_offset_size=0, reserved=0
      // Items: item_id(2), data_ref_idx(2), base_offset(0), extent_count(2), offset(4), length(4)
      const ilocHeaderSize = 2 + 2 // size nibbles + item count
      let ilocItemsSize = 0
      for (const _item of items) {
        ilocItemsSize += 2 + 2 + 2 + 4 + 4 // itemId + dataRefIdx + extCount + offset + length
      }
      if (imageData) {
        ilocItemsSize += 2 + 2 + 2 + 4 + 4 // for image item
      }

      // We need to know mdat offset to set extent offsets.
      // Layout: ftyp + meta + mdat
      // meta = writeFullBox('meta', 0, 0, iinf + iloc)
      // We need to pre-calculate sizes.

      // iloc payload (without offsets yet - we'll fill them in)
      const ilocItemCount = items.length + (imageData ? 1 : 0)
      const ilocPayloadBuf = Buffer.alloc(ilocHeaderSize + ilocItemsSize)
      ilocPayloadBuf[0] = 0x44 // offset_size=4, length_size=4
      ilocPayloadBuf[1] = 0x00 // base_offset_size=0, reserved=0
      ilocPayloadBuf.writeUInt16BE(ilocItemCount, 2)

      // Meta size calculation
      const ilocBox = writeFullBox('iloc', 0, 0, ilocPayloadBuf)
      const metaContent = Buffer.concat([iinfBox, ilocBox])
      const metaBox = writeFullBox('meta', 0, 0, metaContent)

      // mdat content: all items then imageData
      const mdatParts: Buffer[] = []
      for (const item of items) mdatParts.push(item.data)
      if (imageData) mdatParts.push(imageData)
      const mdatPayload = Buffer.concat(mdatParts)
      writeBox('mdat', mdatPayload) // just for size estimation

      // Now we know the mdat offset: ftyp.length + meta.length + 8 (mdat header)
      const mdatDataOffset = ftypBox.length + metaBox.length + 8

      // Rebuild iloc with correct offsets
      let pos = 4 // after item count in iloc payload
      let dataPos = mdatDataOffset
      for (const item of items) {
        ilocPayloadBuf.writeUInt16BE(item.itemId, pos); pos += 2
        ilocPayloadBuf.writeUInt16BE(0, pos); pos += 2 // data_ref_idx
        ilocPayloadBuf.writeUInt16BE(1, pos); pos += 2 // extent_count
        ilocPayloadBuf.writeUInt32BE(dataPos, pos); pos += 4
        ilocPayloadBuf.writeUInt32BE(item.data.length, pos); pos += 4
        dataPos += item.data.length
      }
      if (imageData) {
        const imgItemId = items.length + 1
        ilocPayloadBuf.writeUInt16BE(imgItemId, pos); pos += 2
        ilocPayloadBuf.writeUInt16BE(0, pos); pos += 2
        ilocPayloadBuf.writeUInt16BE(1, pos); pos += 2
        ilocPayloadBuf.writeUInt32BE(dataPos, pos); pos += 4
        ilocPayloadBuf.writeUInt32BE(imageData.length, pos); pos += 4
      }

      // Rebuild the full file with corrected iloc
      const ilocBox2 = writeFullBox('iloc', 0, 0, ilocPayloadBuf)
      const metaContent2 = Buffer.concat([iinfBox, ilocBox2])
      const metaBox2 = writeFullBox('meta', 0, 0, metaContent2)

      // Recalculate if meta size changed
      if (metaBox2.length !== metaBox.length) {
        // Shouldn't happen since we pre-allocated, but handle it
        const newMdatOffset = ftypBox.length + metaBox2.length + 8
        let pos2 = 4
        let dataPos2 = newMdatOffset
        for (const item of items) {
          ilocPayloadBuf.writeUInt16BE(item.itemId, pos2); pos2 += 2
          pos2 += 2; // data_ref_idx
          pos2 += 2; // extent_count
          ilocPayloadBuf.writeUInt32BE(dataPos2, pos2); pos2 += 4
          ilocPayloadBuf.writeUInt32BE(item.data.length, pos2); pos2 += 4
          dataPos2 += item.data.length
        }
        if (imageData) {
          ilocPayloadBuf.writeUInt16BE(items.length + 1, pos2); pos2 += 2
          pos2 += 2; pos2 += 2
          ilocPayloadBuf.writeUInt32BE(dataPos2, pos2); pos2 += 4
          ilocPayloadBuf.writeUInt32BE(imageData.length, pos2); pos2 += 4
        }
      }

      const finalIlocBox = writeFullBox('iloc', 0, 0, ilocPayloadBuf)
      const finalMetaContent = Buffer.concat([iinfBox, finalIlocBox])
      const finalMetaBox = writeFullBox('meta', 0, 0, finalMetaContent)
      const finalMdatBox = writeBox('mdat', mdatPayload)

      return Buffer.concat([ftypBox, finalMetaBox, finalMdatBox])
    }

    it('should detect HEIC (ftyp brand heic)', async () => {
      const heic = buildISOBMFF('heic', [], Buffer.from('imagedata'))
      const output = await processBuffer(heic)
      assert.ok(output.slice(4, 8).toString() === 'ftyp')
      assert.ok(output.slice(8, 12).toString() === 'heic')
    })

    it('should detect AVIF (ftyp brand avif)', async () => {
      const avif = buildISOBMFF('avif', [], Buffer.from('imagedata'))
      const output = await processBuffer(avif)
      assert.ok(output.slice(4, 8).toString() === 'ftyp')
      assert.ok(output.slice(8, 12).toString() === 'avif')
    })

    it('should zero Exif item data', async () => {
      const exifData = Buffer.from('Exif\0\0fake exif data here!!')
      const file = buildISOBMFF('heic', [
        { itemId: 1, itemType: 'Exif', data: exifData }
      ], Buffer.from('real image pixels'))

      const output = await processBuffer(file)
      // Find the exif data region - it should be zeroed
      const exifStr = output.toString('binary')
      assert.ok(exifStr.indexOf('fake exif data') === -1, 'Exif data should be zeroed')
    })

    it('should zero XMP (mime) item data', async () => {
      const xmpData = Buffer.from('<x:xmpmeta>secret XMP metadata</x:xmpmeta>')
      const file = buildISOBMFF('heic', [
        { itemId: 1, itemType: 'mime', data: xmpData }
      ], Buffer.from('real image pixels'))

      const output = await processBuffer(file)
      const outStr = output.toString('binary')
      assert.ok(outStr.indexOf('secret XMP') === -1, 'XMP data should be zeroed')
    })

    it('should preserve non-metadata item data', async () => {
      const exifData = Buffer.from('Exif\0\0secret exif')
      const imageData = Buffer.from('precious image pixels that must be preserved')
      const file = buildISOBMFF('heic', [
        { itemId: 1, itemType: 'Exif', data: exifData }
      ], imageData)

      const output = await processBuffer(file)
      const outStr = output.toString('binary')
      assert.ok(outStr.indexOf('precious image pixels') !== -1, 'Image data should be preserved')
      assert.ok(outStr.indexOf('secret exif') === -1, 'Exif should be removed')
    })

    it('should pass through file with no meta box', async () => {
      // Build a minimal ftyp + mdat with no meta box
      const ftypPayload = Buffer.alloc(8)
      ftypPayload.write('heic', 0, 4, 'utf-8')
      const sizeF = 8 + ftypPayload.length
      const ftypBox = Buffer.alloc(sizeF)
      ftypBox.writeUInt32BE(sizeF, 0)
      ftypBox.write('ftyp', 4, 4, 'utf-8')
      ftypPayload.copy(ftypBox, 8)

      const mdatContent = Buffer.from('image data here')
      const sizeM = 8 + mdatContent.length
      const mdatBox = Buffer.alloc(sizeM)
      mdatBox.writeUInt32BE(sizeM, 0)
      mdatBox.write('mdat', 4, 4, 'utf-8')
      mdatContent.copy(mdatBox, 8)

      const file = Buffer.concat([ftypBox, mdatBox])
      const output = await processBuffer(file)
      assert.ok(Buffer.compare(output, file) === 0, 'Should pass through unchanged')
    })

    it('should handle truncated file without crashing', async () => {
      // Just ftyp header, truncated
      const buf = Buffer.alloc(12)
      buf.writeUInt32BE(12, 0)
      buf.write('ftyp', 4, 4, 'utf-8')
      buf.write('heic', 8, 4, 'utf-8')
      const output = await processBuffer(buf)
      assert.ok(output.length === buf.length, 'Should pass through unchanged')
    })
  })
})
