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
});
