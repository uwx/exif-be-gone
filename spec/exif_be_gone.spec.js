"use strict";
/* global it, describe */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var streamBuffers = require('stream-buffers');
var assert = require('chai').assert;
var fs = require('fs');
var ExifBeGone = require('..');
var stream = require('stream');
describe('Exif be gone', function () {
    describe('stripping exif data', function () {
        it('should strip data', function (done) {
            var writer = new streamBuffers.WritableStreamBuffer();
            fs.createReadStream('Canon_40D.jpg').pipe(new ExifBeGone()).pipe(writer).on('finish', function () {
                assert.equal(writer.getContents().length, 5480);
                done();
            });
        });
        it('should still strip with partial chunks', function (done) {
            var writer = new streamBuffers.WritableStreamBuffer();
            var lengthBuf = Buffer.allocUnsafe(2);
            lengthBuf.writeInt16BE(8, 0);
            var readable = stream.Readable.from([
                Buffer.from('ff', 'hex'),
                Buffer.from('e1', 'hex'),
                lengthBuf,
                Buffer.from('457869', 'hex'),
                Buffer.from('660000', 'hex'),
                Buffer.from('0001020304050607', 'hex'),
                Buffer.from('08090a0b0c0d0e0f', 'hex'),
                Buffer.from('0001020304050607', 'hex'),
                Buffer.from('08090a0b0c0d0e0f', 'hex')
            ]);
            readable.pipe(new ExifBeGone()).pipe(writer).on('finish', function () {
                var output = writer.getContents();
                assert.equal(output.length, 32);
                done();
            });
        });
    });
    describe('PDF support', function () {
        // Helper to build a minimal PDF
        function buildPDF(objects, xrefAndTrailer) {
            var header = '%PDF-1.4\n';
            var body = '';
            var offsets = [];
            for (var _i = 0, objects_1 = objects; _i < objects_1.length; _i++) {
                var obj = objects_1[_i];
                offsets.push(header.length + body.length);
                body += obj + '\n';
            }
            var xrefOffset = header.length + body.length;
            var xref;
            if (xrefAndTrailer) {
                xref = xrefAndTrailer;
            }
            else {
                xref = 'xref\n0 ' + (objects.length + 1) + '\n';
                xref += '0000000000 65535 f \n';
                for (var i = 0; i < offsets.length; i++) {
                    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
                }
                xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' >>\n';
                xref += 'startxref\n' + xrefOffset + '\n%%EOF\n';
            }
            return Buffer.from(header + body + xref, 'binary');
        }
        function processPDF(input) {
            return new Promise(function (resolve, reject) {
                var writer = new streamBuffers.WritableStreamBuffer();
                var readable = stream.Readable.from([input]);
                readable.pipe(new ExifBeGone()).pipe(writer)
                    .on('finish', function () { return resolve(writer.getContents()); })
                    .on('error', reject);
            });
        }
        it('should detect PDF by header', function () { return __awaiter(void 0, void 0, void 0, function () {
            var pdf, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pdf = buildPDF(['1 0 obj\n<< /Type /Catalog >>\nendobj']);
                        return [4 /*yield*/, processPDF(pdf)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.slice(0, 5).toString() === '%PDF-');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should not affect non-PDF files', function () { return __awaiter(void 0, void 0, void 0, function () {
            var data, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        data = Buffer.from('Hello, this is not a PDF');
                        return [4 /*yield*/, processPDF(data)];
                    case 1:
                        output = _a.sent();
                        assert.equal(output.toString(), data.toString());
                        return [2 /*return*/];
                }
            });
        }); });
        it('should scrub Info dictionary string values', function () { return __awaiter(void 0, void 0, void 0, function () {
            var pdf, output, text;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pdf = buildPDF([
                            '1 0 obj\n<< /Type /Catalog >>\nendobj',
                            '2 0 obj\n<< /Title (My Secret Title) /Author (John Doe) /CreationDate (D:20200101) >>\nendobj'
                        ]);
                        return [4 /*yield*/, processPDF(pdf)];
                    case 1:
                        output = _a.sent();
                        text = output.toString('binary');
                        assert.ok(text.indexOf('/Title ()') !== -1, 'Title should be emptied');
                        assert.ok(text.indexOf('/Author ()') !== -1, 'Author should be emptied');
                        assert.ok(text.indexOf('My Secret Title') === -1, 'Title content should be removed');
                        assert.ok(text.indexOf('John Doe') === -1, 'Author content should be removed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should scrub Info dictionary hex string values', function () { return __awaiter(void 0, void 0, void 0, function () {
            var pdf, output, text;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pdf = buildPDF([
                            '1 0 obj\n<< /Type /Catalog >>\nendobj',
                            '2 0 obj\n<< /Producer <48656C6C6F> >>\nendobj'
                        ]);
                        return [4 /*yield*/, processPDF(pdf)];
                    case 1:
                        output = _a.sent();
                        text = output.toString('binary');
                        assert.ok(text.indexOf('/Producer <>') !== -1, 'Producer hex should be emptied');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should remove XMP metadata stream content', function () { return __awaiter(void 0, void 0, void 0, function () {
            var xmpContent, obj, pdf, output, text;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        xmpContent = '<?xml version="1.0"?><x:xmpmeta>secret metadata</x:xmpmeta>';
                        obj = '1 0 obj\n<< /Type /Metadata /Subtype /XML /Length ' + xmpContent.length + ' >>\nstream\n' + xmpContent + '\nendstream\nendobj';
                        pdf = buildPDF([obj]);
                        return [4 /*yield*/, processPDF(pdf)];
                    case 1:
                        output = _a.sent();
                        text = output.toString('binary');
                        assert.ok(text.indexOf('secret metadata') === -1, 'XMP content should be removed');
                        assert.ok(text.indexOf('/Length 0') !== -1 || text.indexOf('/Length  0') !== -1, 'Length should be 0');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should pass through non-metadata streams unchanged', function () { return __awaiter(void 0, void 0, void 0, function () {
            var content, obj, pdf, output, text;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        content = 'BT /F1 12 Tf (Hello World) Tj ET';
                        obj = '1 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj';
                        pdf = buildPDF([obj]);
                        return [4 /*yield*/, processPDF(pdf)];
                    case 1:
                        output = _a.sent();
                        text = output.toString('binary');
                        assert.ok(text.indexOf('Hello World') !== -1, 'Content stream should be preserved');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should handle chunk boundaries across dict markers', function () { return __awaiter(void 0, void 0, void 0, function () {
            var pdf, chunks, i, output, text;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pdf = buildPDF([
                            '1 0 obj\n<< /Title (Secret) /Author (Someone) >>\nendobj'
                        ]);
                        chunks = [];
                        for (i = 0; i < pdf.length; i += 10) {
                            chunks.push(pdf.slice(i, Math.min(i + 10, pdf.length)));
                        }
                        return [4 /*yield*/, new Promise(function (resolve, reject) {
                                var writer = new streamBuffers.WritableStreamBuffer();
                                var readable = stream.Readable.from(chunks);
                                readable.pipe(new ExifBeGone()).pipe(writer)
                                    .on('finish', function () { return resolve(writer.getContents()); })
                                    .on('error', reject);
                            })];
                    case 1:
                        output = _a.sent();
                        text = output.toString('binary');
                        assert.ok(text.indexOf('/Title ()') !== -1, 'Title should be emptied even with chunked input');
                        assert.ok(text.indexOf('Secret') === -1, 'Secret should be removed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should produce valid PDF structure', function () { return __awaiter(void 0, void 0, void 0, function () {
            var pdf, output, text;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pdf = buildPDF([
                            '1 0 obj\n<< /Type /Catalog >>\nendobj',
                            '2 0 obj\n<< /Title (Test) >>\nendobj'
                        ]);
                        return [4 /*yield*/, processPDF(pdf)];
                    case 1:
                        output = _a.sent();
                        text = output.toString('binary');
                        assert.ok(text.startsWith('%PDF-'), 'Should start with PDF header');
                        assert.ok(text.indexOf('%%EOF') !== -1, 'Should contain %%EOF');
                        assert.ok(text.indexOf('xref') !== -1, 'Should contain xref');
                        assert.ok(text.indexOf('startxref') !== -1, 'Should contain startxref');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should adjust xref offsets after metadata removal', function () { return __awaiter(void 0, void 0, void 0, function () {
            var obj1, obj2, obj3, pdf, output, text, xrefStart, obj3pos, xrefSection, entries, obj3offset;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        obj1 = '1 0 obj\n<< /Type /Catalog >>\nendobj';
                        obj2 = '2 0 obj\n<< /Author (A Very Long Author Name That Will Be Removed) >>\nendobj';
                        obj3 = '3 0 obj\n<< /Type /Page >>\nendobj';
                        pdf = buildPDF([obj1, obj2, obj3]);
                        return [4 /*yield*/, processPDF(pdf)];
                    case 1:
                        output = _a.sent();
                        text = output.toString('binary');
                        xrefStart = text.indexOf('xref');
                        assert.ok(xrefStart !== -1, 'Should have xref');
                        obj3pos = text.indexOf('3 0 obj');
                        assert.ok(obj3pos !== -1, 'Object 3 should exist');
                        xrefSection = text.substring(xrefStart);
                        entries = xrefSection.match(/(\d{10}) \d{5} n /g);
                        if (entries && entries.length >= 3) {
                            obj3offset = parseInt(entries[2].substring(0, 10), 10);
                            assert.equal(obj3offset, obj3pos, 'Xref offset for object 3 should match actual position');
                        }
                        return [2 /*return*/];
                }
            });
        }); });
    });
    describe('TIFF support', function () {
        function processBuffer(input) {
            return new Promise(function (resolve, reject) {
                var writer = new streamBuffers.WritableStreamBuffer();
                var readable = stream.Readable.from([input]);
                readable.pipe(new ExifBeGone()).pipe(writer)
                    .on('finish', function () { return resolve(writer.getContents()); })
                    .on('error', reject);
            });
        }
        // Build a minimal TIFF with given IFD entries
        // entries: array of {tag, type, count, value: Buffer(4)}
        // remoteData: array of {offset: number, data: Buffer} (filled after layout)
        function buildTIFF(le, entries, remoteBlocks, nextIFDEntries) {
            var writeU16 = le
                ? function (b, v, o) { return b.writeUInt16LE(v, o); }
                : function (b, v, o) { return b.writeUInt16BE(v, o); };
            var writeU32 = le
                ? function (b, v, o) { return b.writeUInt32LE(v, o); }
                : function (b, v, o) { return b.writeUInt32BE(v, o); };
            // Layout: header(8) + IFD0(2 + entries*12 + 4) + remote data + optional IFD1
            var ifd0Offset = 8;
            var ifd0Size = 2 + entries.length * 12 + 4;
            var remoteStart = ifd0Offset + ifd0Size;
            var remoteOffsets = [];
            if (remoteBlocks) {
                for (var _i = 0, remoteBlocks_1 = remoteBlocks; _i < remoteBlocks_1.length; _i++) {
                    var block = remoteBlocks_1[_i];
                    remoteOffsets.push(remoteStart);
                    remoteStart += block.length;
                }
            }
            var ifd1Offset = 0;
            var ifd1Size = 0;
            if (nextIFDEntries) {
                ifd1Offset = remoteStart;
                ifd1Size = 2 + nextIFDEntries.length * 12 + 4;
            }
            var totalSize = remoteStart + ifd1Size;
            var buf = Buffer.alloc(totalSize);
            // Header
            if (le) {
                buf[0] = 0x49;
                buf[1] = 0x49;
                writeU16(buf, 42, 2);
            }
            else {
                buf[0] = 0x4D;
                buf[1] = 0x4D;
                writeU16(buf, 42, 2);
            }
            writeU32(buf, ifd0Offset, 4);
            // IFD0
            writeU16(buf, entries.length, ifd0Offset);
            for (var i = 0; i < entries.length; i++) {
                var off = ifd0Offset + 2 + i * 12;
                writeU16(buf, entries[i].tag, off);
                writeU16(buf, entries[i].type, off + 2);
                writeU32(buf, entries[i].count, off + 4);
                entries[i].value.copy(buf, off + 8);
            }
            // Next IFD pointer
            writeU32(buf, ifd1Offset, ifd0Offset + 2 + entries.length * 12);
            // Remote data
            if (remoteBlocks) {
                for (var i = 0; i < remoteBlocks.length; i++) {
                    remoteBlocks[i].copy(buf, remoteOffsets[i]);
                }
            }
            // IFD1
            if (nextIFDEntries && ifd1Offset > 0) {
                writeU16(buf, nextIFDEntries.length, ifd1Offset);
                for (var i = 0; i < nextIFDEntries.length; i++) {
                    var off = ifd1Offset + 2 + i * 12;
                    writeU16(buf, nextIFDEntries[i].tag, off);
                    writeU16(buf, nextIFDEntries[i].type, off + 2);
                    writeU32(buf, nextIFDEntries[i].count, off + 4);
                    nextIFDEntries[i].value.copy(buf, off + 8);
                }
                writeU32(buf, 0, ifd1Offset + 2 + nextIFDEntries.length * 12);
            }
            return buf;
        }
        function makeValueU32(le, val) {
            var b = Buffer.alloc(4);
            if (le)
                b.writeUInt32LE(val, 0);
            else
                b.writeUInt32BE(val, 0);
            return b;
        }
        function makeValueU16Padded(le, val) {
            var b = Buffer.alloc(4, 0);
            if (le)
                b.writeUInt16LE(val, 0);
            else
                b.writeUInt16BE(val, 0);
            return b;
        }
        it('should detect LE TIFF', function () { return __awaiter(void 0, void 0, void 0, function () {
            var tiff, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        tiff = buildTIFF(true, [
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(true, 640) }
                        ]);
                        return [4 /*yield*/, processBuffer(tiff)];
                    case 1:
                        output = _a.sent();
                        assert.equal(output[0], 0x49);
                        assert.equal(output[1], 0x49);
                        return [2 /*return*/];
                }
            });
        }); });
        it('should detect BE TIFF', function () { return __awaiter(void 0, void 0, void 0, function () {
            var tiff, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        tiff = buildTIFF(false, [
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(false, 640) }
                        ]);
                        return [4 /*yield*/, processBuffer(tiff)];
                    case 1:
                        output = _a.sent();
                        assert.equal(output[0], 0x4D);
                        assert.equal(output[1], 0x4D);
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip ExifIFD pointer and zero sub-IFD', function () { return __awaiter(void 0, void 0, void 0, function () {
            var le, subIFD, subIFDOffset, tiff, output, entryCount, remainingTag, subIFDRegion;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        le = true;
                        subIFD = Buffer.alloc(2 + 1 * 12 + 4, 0);
                        subIFD.writeUInt16LE(1, 0); // 1 entry
                        subIFD.writeUInt16LE(0x9000, 2); // ExifVersion
                        subIFD.writeUInt16LE(7, 4); // UNDEFINED
                        subIFD.writeUInt32LE(4, 6); // count
                        subIFD.write('0231', 10); // value inline
                        subIFDOffset = 8 + 2 + 2 * 12 + 4;
                        tiff = buildTIFF(le, [
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) },
                            { tag: 0x8769, type: 4, count: 1, value: makeValueU32(le, subIFDOffset) } // ExifIFD - strip
                        ], [subIFD]);
                        return [4 /*yield*/, processBuffer(tiff)
                            // ExifIFD entry should be gone, only ImageWidth remains
                        ];
                    case 1:
                        output = _a.sent();
                        entryCount = output.readUInt16LE(8);
                        assert.equal(entryCount, 1, 'Should have 1 entry after stripping');
                        remainingTag = output.readUInt16LE(10);
                        assert.equal(remainingTag, 0x0100, 'Remaining tag should be ImageWidth');
                        subIFDRegion = output.slice(subIFDOffset, subIFDOffset + subIFD.length);
                        assert.ok(subIFDRegion.every(function (b) { return b === 0; }), 'Sub-IFD should be zeroed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip GPSIFD pointer', function () { return __awaiter(void 0, void 0, void 0, function () {
            var le, subIFDOffset, subIFD, tiff, output, entryCount;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        le = true;
                        subIFDOffset = 8 + 2 + 1 * 12 + 4;
                        subIFD = Buffer.alloc(2 + 4, 0) // empty sub-IFD: 0 entries + next=0
                        ;
                        tiff = buildTIFF(le, [
                            { tag: 0x8825, type: 4, count: 1, value: makeValueU32(le, subIFDOffset) } // GPSIFD
                        ], [subIFD]);
                        return [4 /*yield*/, processBuffer(tiff)];
                    case 1:
                        output = _a.sent();
                        entryCount = output.readUInt16LE(8);
                        assert.equal(entryCount, 0, 'Should have 0 entries after stripping GPS');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip XMP data (remote)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var le, xmpData, remoteOffset, tiff, output, xmpRegion;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        le = true;
                        xmpData = Buffer.from('<x:xmpmeta>secret XMP data here!</x:xmpmeta>');
                        remoteOffset = 8 + 2 + 2 * 12 + 4;
                        tiff = buildTIFF(le, [
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) },
                            { tag: 0x02BC, type: 1, count: xmpData.length, value: makeValueU32(le, remoteOffset) } // XMP
                        ], [xmpData]);
                        return [4 /*yield*/, processBuffer(tiff)];
                    case 1:
                        output = _a.sent();
                        xmpRegion = output.slice(remoteOffset, remoteOffset + xmpData.length);
                        assert.ok(xmpRegion.every(function (b) { return b === 0; }), 'XMP data should be zeroed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip inline metadata (short ImageDescription)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var le, value, tiff, output, entryCount, tag;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        le = true;
                        value = Buffer.alloc(4, 0);
                        value.write('Hi', 0);
                        tiff = buildTIFF(le, [
                            { tag: 0x010E, type: 2, count: 2, value: value },
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 320) }
                        ]);
                        return [4 /*yield*/, processBuffer(tiff)];
                    case 1:
                        output = _a.sent();
                        entryCount = output.readUInt16LE(8);
                        assert.equal(entryCount, 1, 'Only ImageWidth should remain');
                        tag = output.readUInt16LE(10);
                        assert.equal(tag, 0x0100);
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip remote metadata (long ImageDescription)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var le, desc, remoteOffset, tiff, output, descRegion;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        le = true;
                        desc = Buffer.from('This is a long image description that exceeds 4 bytes');
                        remoteOffset = 8 + 2 + 2 * 12 + 4;
                        tiff = buildTIFF(le, [
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) },
                            { tag: 0x010E, type: 2, count: desc.length, value: makeValueU32(le, remoteOffset) }
                        ], [desc]);
                        return [4 /*yield*/, processBuffer(tiff)];
                    case 1:
                        output = _a.sent();
                        descRegion = output.slice(remoteOffset, remoteOffset + desc.length);
                        assert.ok(descRegion.every(function (b) { return b === 0; }), 'Remote description should be zeroed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should preserve image tags', function () { return __awaiter(void 0, void 0, void 0, function () {
            var le, tiff, output, entryCount;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        le = true;
                        tiff = buildTIFF(le, [
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) },
                            { tag: 0x0101, type: 3, count: 1, value: makeValueU16Padded(le, 480) },
                            { tag: 0x0102, type: 3, count: 1, value: makeValueU16Padded(le, 8) } // BitsPerSample
                        ]);
                        return [4 /*yield*/, processBuffer(tiff)];
                    case 1:
                        output = _a.sent();
                        entryCount = output.readUInt16LE(8);
                        assert.equal(entryCount, 3, 'All 3 image tags should be preserved');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should walk IFD chain and strip metadata in second IFD', function () { return __awaiter(void 0, void 0, void 0, function () {
            var le, tiff, output, ifd0Count, ifd1Ptr, ifd1Count, tag;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        le = true;
                        tiff = buildTIFF(le, [
                            { tag: 0x0100, type: 3, count: 1, value: makeValueU16Padded(le, 640) }
                        ], [], [
                            { tag: 0x010E, type: 2, count: 2, value: Buffer.from('Hi\0\0') },
                            { tag: 0x0101, type: 3, count: 1, value: makeValueU16Padded(le, 480) }
                        ]);
                        return [4 /*yield*/, processBuffer(tiff)
                            // IFD0 should still have 1 entry
                        ];
                    case 1:
                        output = _a.sent();
                        ifd0Count = output.readUInt16LE(8);
                        assert.equal(ifd0Count, 1);
                        ifd1Ptr = output.readUInt32LE(8 + 2 + 1 * 12);
                        if (ifd1Ptr > 0 && ifd1Ptr + 2 <= output.length) {
                            ifd1Count = output.readUInt16LE(ifd1Ptr);
                            assert.equal(ifd1Count, 1, 'IFD1 should have 1 entry after stripping ImageDescription');
                            tag = output.readUInt16LE(ifd1Ptr + 2);
                            assert.equal(tag, 0x0101, 'Remaining tag in IFD1 should be ImageLength');
                        }
                        return [2 /*return*/];
                }
            });
        }); });
        it('should handle truncated TIFF without crashing', function () { return __awaiter(void 0, void 0, void 0, function () {
            var truncated, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        truncated = Buffer.from('49492a00', 'hex') // Just the header, no IFD offset data
                        ;
                        return [4 /*yield*/, processBuffer(truncated)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.length === truncated.length, 'Should pass through unchanged');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    describe('ISOBMFF support (HEIC/AVIF)', function () {
        function processBuffer(input) {
            return new Promise(function (resolve, reject) {
                var writer = new streamBuffers.WritableStreamBuffer();
                var readable = stream.Readable.from([input]);
                readable.pipe(new ExifBeGone()).pipe(writer)
                    .on('finish', function () { return resolve(writer.getContents()); })
                    .on('error', reject);
            });
        }
        function writeBox(type, payload) {
            var size = 8 + payload.length;
            var buf = Buffer.alloc(size);
            buf.writeUInt32BE(size, 0);
            buf.write(type, 4, 4, 'utf-8');
            payload.copy(buf, 8);
            return buf;
        }
        function writeFullBox(type, version, flags, payload) {
            var vf = Buffer.alloc(4);
            vf.writeUInt32BE((version << 24) | (flags & 0xFFFFFF), 0);
            return writeBox(type, Buffer.concat([vf, payload]));
        }
        // Build a minimal ISOBMFF with ftyp, meta (with iinf, iloc), and mdat
        function buildISOBMFF(brand, items, imageData) {
            // ftyp box
            var ftypPayload = Buffer.alloc(8);
            ftypPayload.write(brand, 0, 4, 'utf-8');
            ftypPayload.writeUInt32BE(0, 4); // minor version
            var ftypBox = writeBox('ftyp', ftypPayload);
            // We'll compute mdat content and offsets after knowing the layout
            // First build iinf and iloc, then compute mdat offset
            // Build infe boxes
            var infeBoxes = [];
            for (var _i = 0, items_1 = items; _i < items_1.length; _i++) {
                var item = items_1[_i];
                // infe v2: item_id(2) + protection_index(2) + item_type(4)
                var infePayload = Buffer.alloc(8);
                infePayload.writeUInt16BE(item.itemId, 0);
                infePayload.writeUInt16BE(0, 2); // protection index
                infePayload.write(item.itemType, 4, 4, 'utf-8');
                infeBoxes.push(writeFullBox('infe', 2, 0, infePayload));
            }
            // iinf box: version 0, entry count (2 bytes)
            var iinfPayload = Buffer.alloc(2);
            iinfPayload.writeUInt16BE(items.length, 0);
            var iinfContent = Buffer.concat(__spreadArray([iinfPayload], infeBoxes, true));
            var iinfBox = writeFullBox('iinf', 0, 0, iinfContent);
            // iloc box: version 0, offset_size=4, length_size=4, base_offset_size=0, reserved=0
            // Items: item_id(2), data_ref_idx(2), base_offset(0), extent_count(2), offset(4), length(4)
            var ilocHeaderSize = 2 + 2; // size nibbles + item count
            var ilocItemsSize = 0;
            for (var _a = 0, items_2 = items; _a < items_2.length; _a++) {
                var _item = items_2[_a];
                ilocItemsSize += 2 + 2 + 2 + 4 + 4; // itemId + dataRefIdx + extCount + offset + length
            }
            if (imageData) {
                ilocItemsSize += 2 + 2 + 2 + 4 + 4; // for image item
            }
            // We need to know mdat offset to set extent offsets.
            // Layout: ftyp + meta + mdat
            // meta = writeFullBox('meta', 0, 0, iinf + iloc)
            // We need to pre-calculate sizes.
            // iloc payload (without offsets yet - we'll fill them in)
            var ilocItemCount = items.length + (imageData ? 1 : 0);
            var ilocPayloadBuf = Buffer.alloc(ilocHeaderSize + ilocItemsSize);
            ilocPayloadBuf[0] = 0x44; // offset_size=4, length_size=4
            ilocPayloadBuf[1] = 0x00; // base_offset_size=0, reserved=0
            ilocPayloadBuf.writeUInt16BE(ilocItemCount, 2);
            // Meta size calculation
            var ilocBox = writeFullBox('iloc', 0, 0, ilocPayloadBuf);
            var metaContent = Buffer.concat([iinfBox, ilocBox]);
            var metaBox = writeFullBox('meta', 0, 0, metaContent);
            // mdat content: all items then imageData
            var mdatParts = [];
            for (var _b = 0, items_3 = items; _b < items_3.length; _b++) {
                var item = items_3[_b];
                mdatParts.push(item.data);
            }
            if (imageData)
                mdatParts.push(imageData);
            var mdatPayload = Buffer.concat(mdatParts);
            writeBox('mdat', mdatPayload); // just for size estimation
            // Now we know the mdat offset: ftyp.length + meta.length + 8 (mdat header)
            var mdatDataOffset = ftypBox.length + metaBox.length + 8;
            // Rebuild iloc with correct offsets
            var pos = 4; // after item count in iloc payload
            var dataPos = mdatDataOffset;
            for (var _c = 0, items_4 = items; _c < items_4.length; _c++) {
                var item = items_4[_c];
                ilocPayloadBuf.writeUInt16BE(item.itemId, pos);
                pos += 2;
                ilocPayloadBuf.writeUInt16BE(0, pos);
                pos += 2; // data_ref_idx
                ilocPayloadBuf.writeUInt16BE(1, pos);
                pos += 2; // extent_count
                ilocPayloadBuf.writeUInt32BE(dataPos, pos);
                pos += 4;
                ilocPayloadBuf.writeUInt32BE(item.data.length, pos);
                pos += 4;
                dataPos += item.data.length;
            }
            if (imageData) {
                var imgItemId = items.length + 1;
                ilocPayloadBuf.writeUInt16BE(imgItemId, pos);
                pos += 2;
                ilocPayloadBuf.writeUInt16BE(0, pos);
                pos += 2;
                ilocPayloadBuf.writeUInt16BE(1, pos);
                pos += 2;
                ilocPayloadBuf.writeUInt32BE(dataPos, pos);
                pos += 4;
                ilocPayloadBuf.writeUInt32BE(imageData.length, pos);
                pos += 4;
            }
            // Rebuild the full file with corrected iloc
            var ilocBox2 = writeFullBox('iloc', 0, 0, ilocPayloadBuf);
            var metaContent2 = Buffer.concat([iinfBox, ilocBox2]);
            var metaBox2 = writeFullBox('meta', 0, 0, metaContent2);
            // Recalculate if meta size changed
            if (metaBox2.length !== metaBox.length) {
                // Shouldn't happen since we pre-allocated, but handle it
                var newMdatOffset = ftypBox.length + metaBox2.length + 8;
                var pos2 = 4;
                var dataPos2 = newMdatOffset;
                for (var _d = 0, items_5 = items; _d < items_5.length; _d++) {
                    var item = items_5[_d];
                    ilocPayloadBuf.writeUInt16BE(item.itemId, pos2);
                    pos2 += 2;
                    pos2 += 2; // data_ref_idx
                    pos2 += 2; // extent_count
                    ilocPayloadBuf.writeUInt32BE(dataPos2, pos2);
                    pos2 += 4;
                    ilocPayloadBuf.writeUInt32BE(item.data.length, pos2);
                    pos2 += 4;
                    dataPos2 += item.data.length;
                }
                if (imageData) {
                    ilocPayloadBuf.writeUInt16BE(items.length + 1, pos2);
                    pos2 += 2;
                    pos2 += 2;
                    pos2 += 2;
                    ilocPayloadBuf.writeUInt32BE(dataPos2, pos2);
                    pos2 += 4;
                    ilocPayloadBuf.writeUInt32BE(imageData.length, pos2);
                    pos2 += 4;
                }
            }
            var finalIlocBox = writeFullBox('iloc', 0, 0, ilocPayloadBuf);
            var finalMetaContent = Buffer.concat([iinfBox, finalIlocBox]);
            var finalMetaBox = writeFullBox('meta', 0, 0, finalMetaContent);
            var finalMdatBox = writeBox('mdat', mdatPayload);
            return Buffer.concat([ftypBox, finalMetaBox, finalMdatBox]);
        }
        it('should detect HEIC (ftyp brand heic)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var heic, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        heic = buildISOBMFF('heic', [], Buffer.from('imagedata'));
                        return [4 /*yield*/, processBuffer(heic)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.slice(4, 8).toString() === 'ftyp');
                        assert.ok(output.slice(8, 12).toString() === 'heic');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should detect AVIF (ftyp brand avif)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var avif, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        avif = buildISOBMFF('avif', [], Buffer.from('imagedata'));
                        return [4 /*yield*/, processBuffer(avif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.slice(4, 8).toString() === 'ftyp');
                        assert.ok(output.slice(8, 12).toString() === 'avif');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should zero Exif item data', function () { return __awaiter(void 0, void 0, void 0, function () {
            var exifData, file, output, exifStr;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        exifData = Buffer.from('Exif\0\0fake exif data here!!');
                        file = buildISOBMFF('heic', [
                            { itemId: 1, itemType: 'Exif', data: exifData }
                        ], Buffer.from('real image pixels'));
                        return [4 /*yield*/, processBuffer(file)
                            // Find the exif data region - it should be zeroed
                        ];
                    case 1:
                        output = _a.sent();
                        exifStr = output.toString('binary');
                        assert.ok(exifStr.indexOf('fake exif data') === -1, 'Exif data should be zeroed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should zero XMP (mime) item data', function () { return __awaiter(void 0, void 0, void 0, function () {
            var xmpData, file, output, outStr;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        xmpData = Buffer.from('<x:xmpmeta>secret XMP metadata</x:xmpmeta>');
                        file = buildISOBMFF('heic', [
                            { itemId: 1, itemType: 'mime', data: xmpData }
                        ], Buffer.from('real image pixels'));
                        return [4 /*yield*/, processBuffer(file)];
                    case 1:
                        output = _a.sent();
                        outStr = output.toString('binary');
                        assert.ok(outStr.indexOf('secret XMP') === -1, 'XMP data should be zeroed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should preserve non-metadata item data', function () { return __awaiter(void 0, void 0, void 0, function () {
            var exifData, imageData, file, output, outStr;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        exifData = Buffer.from('Exif\0\0secret exif');
                        imageData = Buffer.from('precious image pixels that must be preserved');
                        file = buildISOBMFF('heic', [
                            { itemId: 1, itemType: 'Exif', data: exifData }
                        ], imageData);
                        return [4 /*yield*/, processBuffer(file)];
                    case 1:
                        output = _a.sent();
                        outStr = output.toString('binary');
                        assert.ok(outStr.indexOf('precious image pixels') !== -1, 'Image data should be preserved');
                        assert.ok(outStr.indexOf('secret exif') === -1, 'Exif should be removed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should pass through file with no meta box', function () { return __awaiter(void 0, void 0, void 0, function () {
            var ftypPayload, sizeF, ftypBox, mdatContent, sizeM, mdatBox, file, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        ftypPayload = Buffer.alloc(8);
                        ftypPayload.write('heic', 0, 4, 'utf-8');
                        sizeF = 8 + ftypPayload.length;
                        ftypBox = Buffer.alloc(sizeF);
                        ftypBox.writeUInt32BE(sizeF, 0);
                        ftypBox.write('ftyp', 4, 4, 'utf-8');
                        ftypPayload.copy(ftypBox, 8);
                        mdatContent = Buffer.from('image data here');
                        sizeM = 8 + mdatContent.length;
                        mdatBox = Buffer.alloc(sizeM);
                        mdatBox.writeUInt32BE(sizeM, 0);
                        mdatBox.write('mdat', 4, 4, 'utf-8');
                        mdatContent.copy(mdatBox, 8);
                        file = Buffer.concat([ftypBox, mdatBox]);
                        return [4 /*yield*/, processBuffer(file)];
                    case 1:
                        output = _a.sent();
                        assert.ok(Buffer.compare(output, file) === 0, 'Should pass through unchanged');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should handle truncated file without crashing', function () { return __awaiter(void 0, void 0, void 0, function () {
            var buf, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        buf = Buffer.alloc(12);
                        buf.writeUInt32BE(12, 0);
                        buf.write('ftyp', 4, 4, 'utf-8');
                        buf.write('heic', 8, 4, 'utf-8');
                        return [4 /*yield*/, processBuffer(buf)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.length === buf.length, 'Should pass through unchanged');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    describe('GIF support', function () {
        function scrubBuffer(input) {
            return new Promise(function (resolve, reject) {
                var writer = new streamBuffers.WritableStreamBuffer();
                var readable = stream.Readable.from([input]);
                readable.pipe(new ExifBeGone()).pipe(writer)
                    .on('finish', function () { return resolve(writer.getContents()); })
                    .on('error', reject);
            });
        }
        // Build a minimal GIF89a with optional GCT and blocks
        function buildGIF(blocks) {
            // Header (6) + LSD (7) + GCT (6 bytes for 2-color) + blocks + trailer
            var header = Buffer.from('GIF89a', 'ascii');
            var lsd = Buffer.alloc(7);
            lsd.writeUInt16LE(1, 0); // width
            lsd.writeUInt16LE(1, 2); // height
            lsd[4] = 0x80; // packed: GCT flag=1, color res=0, sort=0, GCT size=0 (2 colors)
            lsd[5] = 0; // bg color
            lsd[6] = 0; // pixel aspect
            var gct = Buffer.alloc(6, 0); // 2 colors * 3 bytes
            var trailer = Buffer.from([0x3B]);
            return Buffer.concat(__spreadArray(__spreadArray([header, lsd, gct], blocks, true), [trailer], false));
        }
        function buildCommentExt(text) {
            var intro = Buffer.from([0x21, 0xFE]);
            var data = Buffer.from(text, 'ascii');
            var subBlock = Buffer.alloc(1);
            subBlock[0] = data.length;
            var terminator = Buffer.from([0x00]);
            return Buffer.concat([intro, subBlock, data, terminator]);
        }
        function buildAppExt(appId, payload) {
            var intro = Buffer.from([0x21, 0xFF]);
            var blockSize = Buffer.from([appId.length]);
            var id = Buffer.from(appId, 'ascii');
            var subBlockLen = Buffer.alloc(1);
            subBlockLen[0] = payload.length;
            var terminator = Buffer.from([0x00]);
            return Buffer.concat([intro, blockSize, id, subBlockLen, payload, terminator]);
        }
        it('should detect GIF87a', function () { return __awaiter(void 0, void 0, void 0, function () {
            var buf, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        buf = Buffer.alloc(13);
                        buf.write('GIF87a', 0, 6, 'ascii');
                        buf.writeUInt16LE(1, 6);
                        buf.writeUInt16LE(1, 8);
                        buf[10] = 0;
                        buf[11] = 0;
                        buf[12] = 0;
                        return [4 /*yield*/, scrubBuffer(buf)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.subarray(0, 6).toString('ascii') === 'GIF87a');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should detect GIF89a', function () { return __awaiter(void 0, void 0, void 0, function () {
            var gif, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        gif = buildGIF([]);
                        return [4 /*yield*/, scrubBuffer(gif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.subarray(0, 6).toString('ascii') === 'GIF89a');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip comment extension', function () { return __awaiter(void 0, void 0, void 0, function () {
            var comment, gif, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        comment = buildCommentExt('Secret comment here');
                        gif = buildGIF([comment]);
                        return [4 /*yield*/, scrubBuffer(gif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('ascii').indexOf('Secret comment') === -1, 'Comment should be stripped');
                        assert.ok(output[output.length - 1] === 0x3B, 'Should end with trailer');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip XMP application extension', function () { return __awaiter(void 0, void 0, void 0, function () {
            var xmpPayload, xmpExt, gif, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        xmpPayload = Buffer.from('<x:xmpmeta>secret XMP</x:xmpmeta>');
                        xmpExt = buildAppExt('XMP DataXMP', xmpPayload);
                        gif = buildGIF([xmpExt]);
                        return [4 /*yield*/, scrubBuffer(gif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('ascii').indexOf('secret XMP') === -1, 'XMP should be stripped');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should preserve NETSCAPE2.0 extension', function () { return __awaiter(void 0, void 0, void 0, function () {
            var netscapePayload, netscapeExt, gif, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        netscapePayload = Buffer.from([0x01, 0x00, 0x00]) // loop count
                        ;
                        netscapeExt = buildAppExt('NETSCAPE2.0', netscapePayload);
                        gif = buildGIF([netscapeExt]);
                        return [4 /*yield*/, scrubBuffer(gif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('ascii').indexOf('NETSCAPE2.0') !== -1, 'NETSCAPE2.0 should be preserved');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should preserve image data', function () { return __awaiter(void 0, void 0, void 0, function () {
            var imgDesc, lzwMin, imgData, imageBlock, comment, gif, output, hasImage, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        imgDesc = Buffer.alloc(10);
                        imgDesc[0] = 0x2C; // image separator
                        imgDesc.writeUInt16LE(0, 1); // left
                        imgDesc.writeUInt16LE(0, 3); // top
                        imgDesc.writeUInt16LE(1, 5); // width
                        imgDesc.writeUInt16LE(1, 7); // height
                        imgDesc[9] = 0; // packed
                        lzwMin = Buffer.from([0x02]) // LZW minimum code size
                        ;
                        imgData = Buffer.from([0x02, 0x44, 0x01, 0x00]) // sub-block(2 bytes) + terminator
                        ;
                        imageBlock = Buffer.concat([imgDesc, lzwMin, imgData]);
                        comment = buildCommentExt('Remove me');
                        gif = buildGIF([comment, imageBlock]);
                        return [4 /*yield*/, scrubBuffer(gif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('ascii').indexOf('Remove me') === -1, 'Comment stripped');
                        hasImage = false;
                        for (i = 0; i < output.length; i++) {
                            if (output[i] === 0x2C) {
                                hasImage = true;
                                break;
                            }
                        }
                        assert.ok(hasImage, 'Image data should be preserved');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip mixed metadata keeping animation', function () { return __awaiter(void 0, void 0, void 0, function () {
            var comment, xmpPayload, xmpExt, netscapePayload, netscapeExt, gif, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        comment = buildCommentExt('Author info');
                        xmpPayload = Buffer.from('<xmp>data</xmp>');
                        xmpExt = buildAppExt('XMP DataXMP', xmpPayload);
                        netscapePayload = Buffer.from([0x01, 0x00, 0x00]);
                        netscapeExt = buildAppExt('NETSCAPE2.0', netscapePayload);
                        gif = buildGIF([comment, xmpExt, netscapeExt]);
                        return [4 /*yield*/, scrubBuffer(gif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('ascii').indexOf('Author info') === -1, 'Comment stripped');
                        assert.ok(output.toString('ascii').indexOf('<xmp>') === -1, 'XMP stripped');
                        assert.ok(output.toString('ascii').indexOf('NETSCAPE2.0') !== -1, 'NETSCAPE kept');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should handle GIF with no extensions', function () { return __awaiter(void 0, void 0, void 0, function () {
            var gif, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        gif = buildGIF([]);
                        return [4 /*yield*/, scrubBuffer(gif)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.length > 0);
                        assert.ok(output[output.length - 1] === 0x3B, 'Should end with trailer');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should handle truncated GIF', function () { return __awaiter(void 0, void 0, void 0, function () {
            var buf, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        buf = Buffer.from('GIF89a', 'ascii');
                        return [4 /*yield*/, scrubBuffer(buf)];
                    case 1:
                        output = _a.sent();
                        assert.deepEqual(output, buf, 'Should pass through unchanged');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip comment from real GIF file (exiftool GIF.gif)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var gifPath, input, output, hasComment, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        gifPath = 'exiftool-fixtures/t/images/GIF.gif';
                        if (!fs.existsSync(gifPath))
                            return [2 /*return*/]; // skip if fixture not available
                        input = fs.readFileSync(gifPath);
                        return [4 /*yield*/, scrubBuffer(input)
                            // Verify comment extension is gone
                        ];
                    case 1:
                        output = _a.sent();
                        hasComment = false;
                        for (i = 0; i < output.length - 1; i++) {
                            if (output[i] === 0x21 && output[i + 1] === 0xFE) {
                                hasComment = true;
                                break;
                            }
                        }
                        assert.ok(!hasComment, 'Comment extension should be stripped');
                        // Verify XMP is gone
                        assert.ok(output.toString('binary').indexOf('XMP DataXMP') === -1, 'XMP should be stripped');
                        // Verify it's still a valid GIF
                        assert.ok(output.subarray(0, 6).toString('ascii') === 'GIF89a' || output.subarray(0, 6).toString('ascii') === 'GIF87a');
                        assert.ok(output[output.length - 1] === 0x3B, 'Should end with trailer');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip XMP from real GIF file (photoshop GIF)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var gifPath, input, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        gifPath = 'metadata-extractor-images/gif/photoshop-8x12-32colors-alpha.gif';
                        if (!fs.existsSync(gifPath))
                            return [2 /*return*/];
                        input = fs.readFileSync(gifPath);
                        return [4 /*yield*/, scrubBuffer(input)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('binary').indexOf('XMP DataXMP') === -1, 'XMP should be stripped');
                        assert.ok(output.subarray(0, 3).toString('ascii') === 'GIF');
                        return [2 /*return*/];
                }
            });
        }); });
    });
    describe('JPEG segment stripping (APP13/APP2/APP12/COM)', function () {
        function scrubBuffer(input) {
            return new Promise(function (resolve, reject) {
                var writer = new streamBuffers.WritableStreamBuffer();
                var readable = stream.Readable.from([input]);
                readable.pipe(new ExifBeGone()).pipe(writer)
                    .on('finish', function () { return resolve(writer.getContents()); })
                    .on('error', reject);
            });
        }
        function buildJpegSegment(markerByte, payload) {
            var marker = Buffer.from([0xFF, markerByte]);
            var length = Buffer.alloc(2);
            length.writeUInt16BE(payload.length + 2, 0);
            return Buffer.concat([marker, length, payload]);
        }
        function buildJpeg(segments) {
            var soi = Buffer.from([0xFF, 0xD8]);
            var eoi = Buffer.from([0xFF, 0xD9]);
            return Buffer.concat(__spreadArray(__spreadArray([soi], segments, true), [eoi], false));
        }
        it('should strip APP13 (IPTC) segment', function () { return __awaiter(void 0, void 0, void 0, function () {
            var iptcData, app13, jpeg, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        iptcData = Buffer.from('Photoshop 3.0\x008BIM secret IPTC data');
                        app13 = buildJpegSegment(0xED, iptcData);
                        jpeg = buildJpeg([app13]);
                        return [4 /*yield*/, scrubBuffer(jpeg)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('binary').indexOf('secret IPTC') === -1, 'IPTC data should be stripped');
                        assert.ok(output[0] === 0xFF && output[1] === 0xD8, 'SOI preserved');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip COM (comment) segment', function () { return __awaiter(void 0, void 0, void 0, function () {
            var comment, comSeg, jpeg, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        comment = Buffer.from('This is a secret comment');
                        comSeg = buildJpegSegment(0xFE, comment);
                        jpeg = buildJpeg([comSeg]);
                        return [4 /*yield*/, scrubBuffer(jpeg)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('binary').indexOf('secret comment') === -1, 'Comment should be stripped');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip APP12 (Ducky) segment', function () { return __awaiter(void 0, void 0, void 0, function () {
            var ducky, app12, jpeg, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        ducky = Buffer.from('Ducky quality data');
                        app12 = buildJpegSegment(0xEC, ducky);
                        jpeg = buildJpeg([app12]);
                        return [4 /*yield*/, scrubBuffer(jpeg)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('binary').indexOf('Ducky quality') === -1, 'Ducky data should be stripped');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip APP2 (FlashPix) but keep ICC_PROFILE', function () { return __awaiter(void 0, void 0, void 0, function () {
            var flashpix, app2Flash, iccData, app2ICC, jpeg, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        flashpix = Buffer.from('FlashPix data here');
                        app2Flash = buildJpegSegment(0xE2, flashpix);
                        iccData = Buffer.concat([Buffer.from('ICC_PROFILE'), Buffer.from([0x00, 0x01, 0x01]), Buffer.alloc(20, 0x42)]);
                        app2ICC = buildJpegSegment(0xE2, iccData);
                        jpeg = buildJpeg([app2Flash, app2ICC]);
                        return [4 /*yield*/, scrubBuffer(jpeg)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('binary').indexOf('FlashPix') === -1, 'FlashPix should be stripped');
                        assert.ok(output.toString('binary').indexOf('ICC_PROFILE') !== -1, 'ICC_PROFILE should be preserved');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip XMP after ICC_PROFILE', function () { return __awaiter(void 0, void 0, void 0, function () {
            var iccData, app2ICC, xmpPayload, app1XMP, jpeg, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        iccData = Buffer.concat([Buffer.from('ICC_PROFILE'), Buffer.from([0x00, 0x01, 0x01]), Buffer.alloc(20, 0x42)]);
                        app2ICC = buildJpegSegment(0xE2, iccData);
                        xmpPayload = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\x00'), Buffer.from('<x:xmpmeta>secret GPS data</x:xmpmeta>')]);
                        app1XMP = buildJpegSegment(0xE1, xmpPayload);
                        jpeg = buildJpeg([app2ICC, app1XMP]);
                        return [4 /*yield*/, scrubBuffer(jpeg)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('binary').indexOf('ICC_PROFILE') !== -1, 'ICC_PROFILE preserved');
                        assert.ok(output.toString('binary').indexOf('secret GPS') === -1, 'XMP after ICC should be stripped');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip multiple metadata segments', function () { return __awaiter(void 0, void 0, void 0, function () {
            var iptc, comment, ducky, jpeg, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        iptc = buildJpegSegment(0xED, Buffer.from('Photoshop 3.0\x00secret'));
                        comment = buildJpegSegment(0xFE, Buffer.from('author info'));
                        ducky = buildJpegSegment(0xEC, Buffer.from('ducky data'));
                        jpeg = buildJpeg([iptc, comment, ducky]);
                        return [4 /*yield*/, scrubBuffer(jpeg)];
                    case 1:
                        output = _a.sent();
                        assert.ok(output.toString('binary').indexOf('secret') === -1);
                        assert.ok(output.toString('binary').indexOf('author info') === -1);
                        assert.ok(output.toString('binary').indexOf('ducky data') === -1);
                        return [2 /*return*/];
                }
            });
        }); });
        it('should preserve non-metadata segments (DQT, SOF, DHT)', function () { return __awaiter(void 0, void 0, void 0, function () {
            var dqt, sof, dht, jpeg, output;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        dqt = buildJpegSegment(0xDB, Buffer.alloc(64, 0x10)) // DQT
                        ;
                        sof = buildJpegSegment(0xC0, Buffer.alloc(11, 0x20)) // SOF0
                        ;
                        dht = buildJpegSegment(0xC4, Buffer.alloc(16, 0x30)) // DHT
                        ;
                        jpeg = buildJpeg([dqt, sof, dht]);
                        return [4 /*yield*/, scrubBuffer(jpeg)
                            // All segments should be preserved
                        ];
                    case 1:
                        output = _a.sent();
                        // All segments should be preserved
                        assert.ok(output.length === jpeg.length, 'No segments should be removed');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip IPTC from real IPTC.jpg', function () { return __awaiter(void 0, void 0, void 0, function () {
            var iptcPath, input, output, hasApp13, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        iptcPath = 'exiftool-fixtures/t/images/IPTC.jpg';
                        if (!fs.existsSync(iptcPath))
                            return [2 /*return*/];
                        input = fs.readFileSync(iptcPath);
                        return [4 /*yield*/, scrubBuffer(input)
                            // Check that APP13 markers are gone
                        ];
                    case 1:
                        output = _a.sent();
                        hasApp13 = false;
                        for (i = 0; i < output.length - 1; i++) {
                            if (output[i] === 0xFF && output[i + 1] === 0xED) {
                                hasApp13 = true;
                                break;
                            }
                        }
                        assert.ok(!hasApp13, 'APP13 should be stripped');
                        assert.ok(output[0] === 0xFF && output[1] === 0xD8, 'Still a valid JPEG');
                        return [2 /*return*/];
                }
            });
        }); });
        it('should strip metadata from real PhotoMechanic.jpg', function () { return __awaiter(void 0, void 0, void 0, function () {
            var pmPath, input, output, hasApp1Exif, hasApp13, i, payload;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pmPath = 'exiftool-fixtures/t/images/PhotoMechanic.jpg';
                        if (!fs.existsSync(pmPath))
                            return [2 /*return*/];
                        input = fs.readFileSync(pmPath);
                        return [4 /*yield*/, scrubBuffer(input)
                            // Check that Exif and IPTC markers are gone
                        ];
                    case 1:
                        output = _a.sent();
                        hasApp1Exif = false;
                        hasApp13 = false;
                        for (i = 0; i < output.length - 1; i++) {
                            if (output[i] === 0xFF && output[i + 1] === 0xE1) {
                                // Check if it's Exif or XMP
                                if (i + 10 < output.length) {
                                    payload = output.subarray(i + 4, i + 10);
                                    if (payload.toString('binary').startsWith('Exif'))
                                        hasApp1Exif = true;
                                }
                            }
                            if (output[i] === 0xFF && output[i + 1] === 0xED)
                                hasApp13 = true;
                        }
                        assert.ok(!hasApp1Exif, 'Exif APP1 should be stripped');
                        assert.ok(!hasApp13, 'APP13 should be stripped');
                        return [2 /*return*/];
                }
            });
        }); });
    });
});
