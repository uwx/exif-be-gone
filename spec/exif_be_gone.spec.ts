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
})
