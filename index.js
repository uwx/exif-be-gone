"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var stream_1 = require("stream");
var zlib_1 = require("zlib");
var app1Marker = Buffer.from('ffe1', 'hex');
var pdfMarker = Buffer.from('%PDF-', 'utf-8');
var pdfInfoKeys = ['/Title', '/Author', '/Subject', '/Keywords', '/Creator', '/Producer', '/CreationDate', '/ModDate'];
var exifMarker = Buffer.from('457869660000', 'hex'); // Exif\0\0
var pngMarker = Buffer.from('89504e470d0a1a0a', 'hex'); // 211   P   N   G  \r  \n \032 \n
var webp1Marker = Buffer.from('52494646', 'hex'); // RIFF
var webp2Marker = Buffer.from('57454250', 'hex'); // WEBP
var xmpMarker = Buffer.from('http://ns.adobe.com/xap', 'utf-8');
var flirMarker = Buffer.from('FLIR', 'utf-8');
var maxMarkerLength = Math.max(exifMarker.length, xmpMarker.length, flirMarker.length);
var ExifTransformer = /** @class */ (function (_super) {
    __extends(ExifTransformer, _super);
    function ExifTransformer(options) {
        var _this = _super.call(this, options) || this;
        _this._pdfStoredDictText = '';
        _this._pdfStoredDictOrigLen = 0;
        _this._pdfStoredStreamHeader = Buffer.alloc(0);
        _this._pdfStoredStreamHeaderInputLen = 0;
        _this.remainingScrubBytes = undefined;
        _this.pending = [];
        _this.pdfState = 'scanning';
        _this.pdfDictBuffer = Buffer.alloc(0);
        _this.pdfDictNesting = 0;
        _this.pdfStringNesting = 0;
        _this.pdfInEscape = false;
        _this.pdfStreamLength = -1;
        _this.pdfStreamType = 'pass';
        _this.pdfStreamBytesRead = 0;
        _this.pdfStreamData = [];
        _this.pdfInputOffset = 0;
        _this.pdfOutputOffset = 0;
        _this.pdfOffsetMap = [[0, 0]];
        _this.pdfInXref = false;
        _this.pdfXrefBuffer = Buffer.alloc(0);
        _this.pdfPending = Buffer.alloc(0);
        _this.pdfDictStart = 0;
        return _this;
    }
    ExifTransformer.prototype._transform = function (chunk, _, callback) {
        if (this.mode === undefined) {
            if (pngMarker.equals(Uint8Array.prototype.slice.call(chunk, 0, 8))) {
                this.mode = 'png';
                this.push(Uint8Array.prototype.slice.call(chunk, 0, 8));
                chunk = Buffer.from(Uint8Array.prototype.slice.call(chunk, 8));
            }
            else if (webp1Marker.equals(Uint8Array.prototype.slice.call(chunk, 0, 4)) && webp2Marker.equals(Uint8Array.prototype.slice.call(chunk, 8, 12))) {
                this.mode = 'webp';
                this.push(Uint8Array.prototype.slice.call(chunk, 0, 12));
                chunk = Buffer.from(Uint8Array.prototype.slice.call(chunk, 12));
            }
            else if (chunk.length >= 5 && pdfMarker.equals(Uint8Array.prototype.slice.call(chunk, 0, 5))) {
                this.mode = 'pdf';
            }
            else {
                this.mode = 'other';
            }
        }
        if (this.mode === 'pdf') {
            this._scrubPDF(false, chunk);
            callback();
            return;
        }
        this._scrub(false, chunk);
        callback();
    };
    ExifTransformer.prototype._final = function (callback) {
        if (this.mode === 'pdf') {
            if (this.pdfPending.length > 0) {
                this._scrubPDF(true);
            }
            callback();
            return;
        }
        while (this.pending.length !== 0) {
            this._scrub(true);
        }
        callback();
    };
    ExifTransformer.prototype._scrub = function (atEnd, chunk) {
        switch (this.mode) {
            case 'other': return this._scrubOther(atEnd, chunk);
            case 'png': return this._scrubPNG(atEnd, chunk);
            case 'webp': return this._scrubWEBP(atEnd, chunk);
            default: throw new Error('unknown mode');
        }
    };
    ExifTransformer.prototype._scrubOther = function (atEnd, chunk) {
        var pendingChunk = chunk ? Buffer.concat(__spreadArray(__spreadArray([], this.pending, true), [chunk], false)) : Buffer.concat(this.pending);
        // currently haven't detected an app1 marker
        if (this.remainingScrubBytes === undefined) {
            var app1Start = pendingChunk.indexOf(app1Marker);
            // no app1 in the current pendingChunk
            if (app1Start === -1) {
                // if last byte is ff, wait for more
                if (!atEnd && pendingChunk[pendingChunk.length - 1] === app1Marker[0]) {
                    if (chunk)
                        this.pending.push(chunk);
                    return;
                }
            }
            else {
                // there is an app1, but not enough data to read to exif marker
                // so defer
                if (app1Start + maxMarkerLength + 4 > pendingChunk.length) {
                    if (atEnd) {
                        this.push(pendingChunk);
                        this.pending.length = 0;
                    }
                    else if (chunk) {
                        this.pending.push(chunk);
                    }
                    return;
                    // we have enough, so lets read the length
                }
                else {
                    var candidateMarker = Uint8Array.prototype.slice.call(pendingChunk, app1Start + 4, app1Start + maxMarkerLength + 4);
                    if (exifMarker.compare(candidateMarker, 0, exifMarker.length) === 0 || xmpMarker.compare(candidateMarker, 0, xmpMarker.length) === 0 || flirMarker.compare(candidateMarker, 0, flirMarker.length) === 0) {
                        // we add 2 to the remainingScrubBytes to account for the app1 marker
                        this.remainingScrubBytes = pendingChunk.readUInt16BE(app1Start + 2) + 2;
                        this.push(Uint8Array.prototype.slice.call(pendingChunk, 0, app1Start));
                        pendingChunk = Buffer.from(Uint8Array.prototype.slice.call(pendingChunk, app1Start));
                    }
                }
            }
        }
        // we have successfully read an app1/exif marker, so we can remove data
        if (this.remainingScrubBytes !== undefined && this.remainingScrubBytes !== 0) {
            // there is more data than we want to remove, so we only remove up to remainingScrubBytes
            if (pendingChunk.length >= this.remainingScrubBytes) {
                var remainingBuffer = Buffer.from(Uint8Array.prototype.slice.call(pendingChunk, this.remainingScrubBytes));
                this.pending = remainingBuffer.length !== 0 ? [remainingBuffer] : [];
                this.remainingScrubBytes = undefined;
                // this chunk is too large, remove everything
            }
            else {
                this.remainingScrubBytes -= pendingChunk.length;
                this.pending.length = 0;
            }
        }
        else {
            // push this chunk
            this.push(pendingChunk);
            this.remainingScrubBytes = undefined;
            this.pending.length = 0;
        }
    };
    ExifTransformer.prototype._scrubPNG = function (atEnd, chunk) {
        var pendingChunk = chunk ? Buffer.concat(__spreadArray(__spreadArray([], this.pending, true), [chunk], false)) : Buffer.concat(this.pending);
        while (pendingChunk.length !== 0) {
            pendingChunk = this._processPNGGood(pendingChunk);
            if (this.remainingScrubBytes !== undefined) {
                if (pendingChunk.length >= this.remainingScrubBytes) {
                    var remainingBuffer = Buffer.from(Uint8Array.prototype.slice.call(pendingChunk, this.remainingScrubBytes));
                    this.pending = remainingBuffer.length !== 0 ? [remainingBuffer] : [];
                    this.remainingScrubBytes = undefined;
                    // this chunk is too large, remove everything
                }
                else {
                    this.remainingScrubBytes -= pendingChunk.length;
                    this.pending.length = 0;
                }
                return;
            }
            if (pendingChunk.length === 0)
                return;
            if (pendingChunk.length < 8) {
                if (atEnd) {
                    this.push(pendingChunk);
                    this.pending.length = 0;
                }
                else {
                    this.pending = [pendingChunk];
                }
                return;
            }
            var size = pendingChunk.readUInt32BE(0);
            var chunkType = Uint8Array.prototype.slice.call(pendingChunk, 4, 8).toString();
            switch (chunkType) {
                case 'tIME':
                case 'iTXt':
                case 'tEXt':
                case 'zTXt':
                case 'eXIf':
                case 'dSIG':
                    this.remainingScrubBytes = size + 12;
                    continue;
                default:
                    this.remainingGoodBytes = size + 12;
                    continue;
            }
        }
    };
    ExifTransformer.prototype._processPNGGood = function (chunk) {
        if (this.remainingGoodBytes === undefined) {
            return chunk;
        }
        this.pending.length = 0;
        // we need all these bytes
        if (this.remainingGoodBytes >= chunk.length) {
            this.remainingGoodBytes -= chunk.length;
            this.push(chunk);
            return Buffer.alloc(0);
        }
        else {
            this.push(Uint8Array.prototype.slice.call(chunk, 0, this.remainingGoodBytes));
            var remaining = Buffer.from(Uint8Array.prototype.slice.call(chunk, this.remainingGoodBytes));
            this.remainingGoodBytes = undefined;
            return remaining;
        }
    };
    ExifTransformer.prototype._scrubWEBP = function (atEnd, chunk) {
        var pendingChunk = chunk ? Buffer.concat(__spreadArray(__spreadArray([], this.pending, true), [chunk], false)) : Buffer.concat(this.pending);
        while (pendingChunk.length !== 0) {
            pendingChunk = this._processPNGGood(pendingChunk);
            if (this.remainingScrubBytes !== undefined) {
                if (pendingChunk.length >= this.remainingScrubBytes) {
                    var remainingBuffer = Buffer.from(Uint8Array.prototype.slice.call(pendingChunk, this.remainingScrubBytes));
                    this.pending = remainingBuffer.length !== 0 ? [remainingBuffer] : [];
                    this.remainingScrubBytes = undefined;
                    // this chunk is too large, remove everything
                }
                else {
                    this.remainingScrubBytes -= pendingChunk.length;
                    this.pending.length = 0;
                }
                return;
            }
            if (pendingChunk.length === 0)
                return;
            if (pendingChunk.length < 8) {
                if (atEnd) {
                    this.push(pendingChunk);
                    this.pending.length = 0;
                }
                else {
                    this.pending = [pendingChunk];
                }
                return;
            }
            var chunkType = Uint8Array.prototype.slice.call(pendingChunk, 0, 4).toString();
            var size = pendingChunk.readUInt32LE(4);
            switch (chunkType) {
                case 'EXIF':
                    this.remainingScrubBytes = size + 12;
                    continue;
                default:
                    this.remainingGoodBytes = size + 12;
                    continue;
            }
        }
    };
    // PDF offset tracking helpers
    ExifTransformer.prototype._pdfPush = function (data) {
        this.push(data);
        this.pdfInputOffset += data.length;
        this.pdfOutputOffset += data.length;
    };
    ExifTransformer.prototype._pdfSkip = function (n) {
        this.pdfInputOffset += n;
        this.pdfOffsetMap.push([this.pdfInputOffset, this.pdfOutputOffset]);
    };
    ExifTransformer.prototype._pdfPushModified = function (origLen, newData) {
        this.push(newData);
        this.pdfInputOffset += origLen;
        this.pdfOutputOffset += newData.length;
        if (origLen !== newData.length) {
            this.pdfOffsetMap.push([this.pdfInputOffset, this.pdfOutputOffset]);
        }
    };
    ExifTransformer.prototype._pdfComputeOffset = function (origOffset) {
        var lastInput = 0;
        var lastOutput = 0;
        for (var _i = 0, _a = this.pdfOffsetMap; _i < _a.length; _i++) {
            var _b = _a[_i], inp = _b[0], out = _b[1];
            if (inp <= origOffset) {
                lastInput = inp;
                lastOutput = out;
            }
            else {
                break;
            }
        }
        return lastOutput + (origOffset - lastInput);
    };
    // Process embedded image/file through a new ExifTransformer
    ExifTransformer.prototype._pdfProcessEmbedded = function (data) {
        var chunks = [];
        var sub = new ExifTransformer();
        var origPush = sub.push.bind(sub);
        sub.push = function (chunk) {
            if (chunk !== null)
                chunks.push(Buffer.from(chunk));
            return true;
        };
        var noop = function () { };
        sub._transform(data, 'binary', noop);
        sub._final(noop);
        sub.push = origPush;
        return Buffer.concat(chunks);
    };
    // Scrub Info dictionary keys - replace values with empty
    ExifTransformer.prototype._pdfScrubInfoDict = function (dictText) {
        var result = dictText;
        for (var _i = 0, pdfInfoKeys_1 = pdfInfoKeys; _i < pdfInfoKeys_1.length; _i++) {
            var key = pdfInfoKeys_1[_i];
            // Match key followed by a parenthesized string value: /Key (value)
            // Handle nested parens and escapes
            var keyIdx = result.indexOf(key);
            if (keyIdx === -1)
                continue;
            var afterKey = keyIdx + key.length;
            // Find the value - skip whitespace
            var i = afterKey;
            while (i < result.length && (result[i] === ' ' || result[i] === '\n' || result[i] === '\r'))
                i++;
            if (i >= result.length)
                continue;
            if (result[i] === '(') {
                // Find matching close paren
                var depth = 0;
                var escaped = false;
                var start = i;
                for (; i < result.length; i++) {
                    if (escaped) {
                        escaped = false;
                        continue;
                    }
                    if (result[i] === '\\') {
                        escaped = true;
                        continue;
                    }
                    if (result[i] === '(')
                        depth++;
                    if (result[i] === ')') {
                        depth--;
                        if (depth === 0) {
                            i++;
                            break;
                        }
                    }
                }
                result = result.substring(0, start) + '()' + result.substring(i);
            }
            else if (result[i] === '<') {
                // Hex string
                var start = i;
                var end = result.indexOf('>', i);
                if (end !== -1) {
                    result = result.substring(0, start) + '<>' + result.substring(end + 1);
                }
            }
        }
        return result;
    };
    // Update /Length value in dictionary text
    ExifTransformer.prototype._pdfUpdateLength = function (dictText, newLength) {
        return dictText.replace(/\/Length\s+\d+/, '/Length ' + newLength);
    };
    // Main PDF scrubbing state machine
    ExifTransformer.prototype._scrubPDF = function (_atEnd, chunk) {
        if (chunk) {
            this.pdfPending = this.pdfPending.length > 0 ? Buffer.concat([this.pdfPending, chunk]) : chunk;
        }
        while (this.pdfPending.length > 0) {
            var buf = this.pdfPending;
            this.pdfPending = Buffer.alloc(0);
            var pos = 0;
            var madeProgress = false;
            while (pos < buf.length) {
                if (this.pdfState === 'scanning') {
                    if (this.pdfInXref) {
                        // Accumulate xref table data until we find startxref
                        var startxrefKey = 'startxref';
                        var remaining = buf.slice(pos);
                        var combined = Buffer.concat([this.pdfXrefBuffer, remaining]);
                        var combinedStr = combined.toString('binary');
                        var sxIdx = combinedStr.indexOf(startxrefKey);
                        if (sxIdx === -1) {
                            // Need more data
                            this.pdfXrefBuffer = combined;
                            pos = buf.length;
                            continue;
                        }
                        // Find the offset value after startxref
                        var afterSx = sxIdx + startxrefKey.length;
                        var eofIdx = combinedStr.indexOf('%%EOF', afterSx);
                        if (eofIdx === -1) {
                            this.pdfXrefBuffer = combined;
                            pos = buf.length;
                            continue;
                        }
                        // We have the full xref + trailer + startxref + %%EOF
                        var endPos = eofIdx + 5;
                        // Check for trailing newline
                        var realEnd = endPos;
                        if (realEnd < combinedStr.length && combinedStr[realEnd] === '\n')
                            realEnd++;
                        else if (realEnd + 1 < combinedStr.length && combinedStr[realEnd] === '\r' && combinedStr[realEnd + 1] === '\n')
                            realEnd += 2;
                        var fullBlock = combined.slice(0, realEnd);
                        var consumedFromBuf = realEnd - this.pdfXrefBuffer.length;
                        pos += consumedFromBuf;
                        this.pdfXrefBuffer = Buffer.alloc(0);
                        this.pdfInXref = false;
                        // Process the xref block
                        var processed = this._pdfProcessXrefBlock(fullBlock);
                        this._pdfPushModified(fullBlock.length, processed);
                        continue;
                    }
                    // Look for << (dict start) or xref keyword
                    var searchStart = pos;
                    var foundAt = -1;
                    var foundType = 'dict';
                    for (var i = searchStart; i < buf.length; i++) {
                        if (buf[i] === 0x3C && i + 1 < buf.length && buf[i + 1] === 0x3C) { // <<
                            foundAt = i;
                            foundType = 'dict';
                            break;
                        }
                        if (buf[i] === 0x78) { // 'x'
                            var candidate = buf.slice(i, i + 4).toString('binary');
                            if (candidate === 'xref' && (i === 0 || buf[i - 1] === 0x0A || buf[i - 1] === 0x0D || buf[i - 1] === 0x20)) {
                                // Check character after 'xref'
                                if (i + 4 >= buf.length || buf[i + 4] === 0x0A || buf[i + 4] === 0x0D || buf[i + 4] === 0x20) {
                                    foundAt = i;
                                    foundType = 'xref';
                                    break;
                                }
                            }
                        }
                    }
                    if (foundAt === -1) {
                        // No dict or xref found - push everything except last byte (could be partial <)
                        if (!_atEnd && buf.length - pos > 0) {
                            var safe = buf.length - 1;
                            if (safe > pos) {
                                this._pdfPush(buf.slice(pos, safe));
                                this.pdfPending = buf.slice(safe);
                            }
                            else {
                                this.pdfPending = buf.slice(pos);
                            }
                        }
                        else {
                            this._pdfPush(buf.slice(pos));
                        }
                        return;
                    }
                    // Push everything before the found marker
                    if (foundAt > pos) {
                        this._pdfPush(buf.slice(pos, foundAt));
                    }
                    pos = foundAt;
                    if (foundType === 'xref') {
                        this.pdfInXref = true;
                        this.pdfXrefBuffer = Buffer.alloc(0);
                        this.pdfDictStart = this.pdfInputOffset;
                        continue;
                    }
                    // Start of dictionary
                    this.pdfState = 'in_dict';
                    this.pdfDictBuffer = Buffer.alloc(0);
                    this.pdfDictNesting = 0;
                    this.pdfStringNesting = 0;
                    this.pdfInEscape = false;
                    this.pdfDictStart = this.pdfInputOffset;
                    continue;
                }
                if (this.pdfState === 'in_dict') {
                    // Accumulate dict bytes, tracking nesting
                    var startPos = pos;
                    while (pos < buf.length) {
                        var b = buf[pos];
                        if (this.pdfStringNesting > 0) {
                            if (this.pdfInEscape) {
                                this.pdfInEscape = false;
                                pos++;
                                continue;
                            }
                            if (b === 0x5C) { // backslash
                                this.pdfInEscape = true;
                                pos++;
                                continue;
                            }
                            if (b === 0x28) { // (
                                this.pdfStringNesting++;
                                pos++;
                                continue;
                            }
                            if (b === 0x29) { // )
                                this.pdfStringNesting--;
                                pos++;
                                continue;
                            }
                            pos++;
                            continue;
                        }
                        if (b === 0x28) { // (
                            this.pdfStringNesting = 1;
                            pos++;
                            continue;
                        }
                        if (b === 0x3C && pos + 1 < buf.length && buf[pos + 1] === 0x3C) { // <<
                            this.pdfDictNesting++;
                            pos += 2;
                            continue;
                        }
                        if (b === 0x3E && pos + 1 < buf.length && buf[pos + 1] === 0x3E) { // >>
                            this.pdfDictNesting--;
                            if (this.pdfDictNesting === 0) {
                                pos += 2;
                                // Finished dictionary
                                this.pdfDictBuffer = Buffer.concat([this.pdfDictBuffer, buf.slice(startPos, pos)]);
                                this._pdfHandleDict(buf, pos);
                                madeProgress = true;
                                break;
                            }
                            pos += 2;
                            continue;
                        }
                        pos++;
                    }
                    if (madeProgress)
                        break; // _pdfHandleDict set pdfPending; outer loop will re-consume
                    // Need more data
                    this.pdfDictBuffer = Buffer.concat([this.pdfDictBuffer, buf.slice(startPos)]);
                    return;
                }
                if (this.pdfState === 'in_stream') {
                    var result = this._pdfHandleStream(buf, pos, _atEnd);
                    if (result === -1)
                        return; // need more data
                    pos = result;
                    continue;
                }
            } // end inner while
        } // end outer while
    };
    // Handle completed dictionary
    ExifTransformer.prototype._pdfHandleDict = function (buf, pos) {
        var dictText = this.pdfDictBuffer.toString('binary');
        var dictLen = this.pdfDictBuffer.length;
        // Classify the stream type
        var streamType = 'pass';
        if (/\/Type\s*\/Metadata/.test(dictText) && /\/Subtype\s*\/XML/.test(dictText)) {
            streamType = 'metadata';
        }
        else if (/\/Subtype\s*\/Image/.test(dictText) && /\/Filter\s*\/DCTDecode/.test(dictText)) {
            streamType = 'image';
        }
        else if (/\/Type\s*\/EmbeddedFile/.test(dictText)) {
            streamType = 'embedded';
        }
        else if (/\/Type\s*\/XRef/.test(dictText)) {
            streamType = 'xref';
        }
        // Extract /Length
        var lengthMatch = dictText.match(/\/Length\s+(\d+)/);
        var streamLength = lengthMatch ? parseInt(lengthMatch[1], 10) : -1;
        // Scrub info dictionary keys
        var scrubbedDictText = this._pdfScrubInfoDict(dictText);
        // Check if stream keyword follows
        var remaining = buf.slice(pos);
        var combined = Buffer.concat([remaining]);
        var streamMatch = this._pdfFindStreamKeyword(combined);
        if (streamMatch === -1) {
            // No stream keyword - this is just a dictionary object
            var scrubbedDict = Buffer.from(scrubbedDictText, 'binary');
            this._pdfPushModified(dictLen, scrubbedDict);
            this.pdfState = 'scanning';
            this.pdfPending = remaining;
            return;
        }
        // There's a stream keyword
        var beforeStream = combined.slice(0, streamMatch);
        var afterKeyword = this._pdfStreamKeywordEnd(combined, streamMatch);
        if (afterKeyword === -1) {
            // Need more data for the stream keyword + newline
            var scrubbedDict = Buffer.from(scrubbedDictText, 'binary');
            this._pdfPushModified(dictLen, scrubbedDict);
            this._pdfPush(beforeStream);
            this.pdfState = 'in_stream';
            this.pdfStreamType = streamType;
            this.pdfStreamLength = streamLength;
            this.pdfStreamBytesRead = 0;
            this.pdfStreamData = [];
            this.pdfPending = combined.slice(streamMatch);
            return;
        }
        // We have the full stream header
        var streamHeader = combined.slice(0, afterKeyword);
        if (streamType === 'pass') {
            // Push dict + stream header as-is (but with scrubbed info keys)
            var scrubbedDict = Buffer.from(scrubbedDictText, 'binary');
            this._pdfPushModified(dictLen, scrubbedDict);
            this._pdfPush(streamHeader);
            this.pdfState = 'in_stream';
            this.pdfStreamType = 'pass';
            this.pdfStreamLength = streamLength;
            this.pdfStreamBytesRead = 0;
            this.pdfStreamData = [];
            this.pdfPending = combined.slice(afterKeyword);
            return;
        }
        // For modified streams, we need to buffer everything
        this.pdfState = 'in_stream';
        this.pdfStreamType = streamType;
        this.pdfStreamLength = streamLength;
        this.pdfStreamBytesRead = 0;
        this.pdfStreamData = [];
        // Store the scrubbed dict text for later /Length update
        this._pdfStoredDictText = scrubbedDictText;
        this._pdfStoredDictOrigLen = dictLen;
        this._pdfStoredStreamHeader = streamHeader;
        this._pdfStoredStreamHeaderInputLen = streamHeader.length;
        this.pdfPending = combined.slice(afterKeyword);
    };
    ExifTransformer.prototype._pdfFindStreamKeyword = function (buf) {
        // Look for 'stream' not preceded by 'end'
        var idx = 0;
        while (idx < buf.length) {
            var si = buf.indexOf('stream', idx);
            if (si === -1)
                return -1;
            // Make sure it's not 'endstream'
            if (si >= 3) {
                var before_1 = buf.slice(si - 3, si).toString('binary');
                if (before_1 === 'end') {
                    idx = si + 6;
                    continue;
                }
            }
            // Check that before 'stream' we have whitespace or >>
            if (si > 0) {
                var prevByte = buf[si - 1];
                if (prevByte !== 0x0A && prevByte !== 0x0D && prevByte !== 0x20 && prevByte !== 0x3E) {
                    idx = si + 6;
                    continue;
                }
            }
            return si;
        }
        return -1;
    };
    ExifTransformer.prototype._pdfStreamKeywordEnd = function (buf, streamStart) {
        // stream keyword is followed by \r\n or \n
        var afterStream = streamStart + 6; // length of 'stream'
        if (afterStream >= buf.length)
            return -1;
        if (buf[afterStream] === 0x0A)
            return afterStream + 1;
        if (buf[afterStream] === 0x0D) {
            if (afterStream + 1 >= buf.length)
                return -1;
            if (buf[afterStream + 1] === 0x0A)
                return afterStream + 2;
            return afterStream + 1;
        }
        // Some PDFs have stream followed directly by content
        return afterStream;
    };
    // Handle stream content
    ExifTransformer.prototype._pdfHandleStream = function (buf, pos, _atEnd) {
        if (this.pdfStreamType === 'pass') {
            return this._pdfHandlePassStream(buf, pos, _atEnd);
        }
        return this._pdfHandleModifiedStream(buf, pos, _atEnd);
    };
    ExifTransformer.prototype._pdfHandlePassStream = function (buf, pos, _atEnd) {
        if (this.pdfStreamLength >= 0) {
            var remaining = this.pdfStreamLength - this.pdfStreamBytesRead;
            var available = buf.length - pos;
            if (available >= remaining) {
                // Push stream content
                this._pdfPush(buf.slice(pos, pos + remaining));
                this.pdfStreamBytesRead = this.pdfStreamLength;
                this.pdfState = 'scanning';
                return pos + remaining;
            }
            else {
                this._pdfPush(buf.slice(pos));
                this.pdfStreamBytesRead += available;
                return buf.length;
            }
        }
        // Unknown length - scan for endstream
        var searchBuf = buf.slice(pos);
        var endIdx = searchBuf.indexOf('\nendstream');
        var endIdx2 = searchBuf.indexOf('\r\nendstream');
        var endPos = -1;
        var endLen = 0;
        if (endIdx !== -1 && (endIdx2 === -1 || endIdx <= endIdx2)) {
            endPos = endIdx;
            endLen = 1; // the \n
        }
        else if (endIdx2 !== -1) {
            endPos = endIdx2;
            endLen = 2; // the \r\n
        }
        if (endPos !== -1) {
            this._pdfPush(buf.slice(pos, pos + endPos + endLen));
            this.pdfState = 'scanning';
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
    };
    ExifTransformer.prototype._pdfHandleModifiedStream = function (buf, pos, _atEnd) {
        if (this.pdfStreamLength >= 0) {
            var remaining = this.pdfStreamLength - this.pdfStreamBytesRead;
            var available = buf.length - pos;
            if (available >= remaining) {
                this.pdfStreamData.push(buf.slice(pos, pos + remaining));
                this.pdfStreamBytesRead = this.pdfStreamLength;
                this._pdfFinishModifiedStream();
                this.pdfState = 'scanning';
                return pos + remaining;
            }
            else {
                this.pdfStreamData.push(buf.slice(pos));
                this.pdfStreamBytesRead += available;
                return buf.length;
            }
        }
        // Unknown length - scan for endstream
        var searchBuf = buf.slice(pos);
        var endIdx = searchBuf.indexOf('\nendstream');
        var endIdx2 = searchBuf.indexOf('\r\nendstream');
        var endPos = -1;
        if (endIdx !== -1 && (endIdx2 === -1 || endIdx <= endIdx2)) {
            endPos = endIdx;
        }
        else if (endIdx2 !== -1) {
            endPos = endIdx2;
        }
        if (endPos !== -1) {
            this.pdfStreamData.push(buf.slice(pos, pos + endPos));
            this.pdfStreamLength = Buffer.concat(this.pdfStreamData).length;
            this.pdfStreamBytesRead = this.pdfStreamLength;
            this._pdfFinishModifiedStream();
            this.pdfState = 'scanning';
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
    };
    ExifTransformer.prototype._pdfFinishModifiedStream = function () {
        var streamContent = Buffer.concat(this.pdfStreamData);
        var origStreamLen = streamContent.length;
        var newContent;
        if (this.pdfStreamType === 'metadata') {
            // Remove metadata entirely - replace with empty
            newContent = Buffer.alloc(0);
        }
        else if (this.pdfStreamType === 'image' || this.pdfStreamType === 'embedded') {
            newContent = this._pdfProcessEmbedded(streamContent);
        }
        else if (this.pdfStreamType === 'xref') {
            newContent = this._pdfProcessXrefStream(streamContent, this._pdfStoredDictText);
        }
        else {
            newContent = streamContent;
        }
        // Update /Length in dict
        var dictText = this._pdfStoredDictText;
        if (this.pdfStreamType === 'metadata') {
            dictText = this._pdfUpdateLength(dictText, 0);
        }
        else if (newContent.length !== origStreamLen) {
            dictText = this._pdfUpdateLength(dictText, newContent.length);
        }
        var dictBuf = Buffer.from(dictText, 'binary');
        var streamHeader = this._pdfStoredStreamHeader;
        var totalOrigLen = this._pdfStoredDictOrigLen + this._pdfStoredStreamHeaderInputLen + origStreamLen;
        var totalNewData = Buffer.concat([dictBuf, streamHeader, newContent]);
        this._pdfPushModified(totalOrigLen, totalNewData);
        // Reset stored state
        this._pdfStoredDictText = '';
        this._pdfStoredDictOrigLen = 0;
        this._pdfStoredStreamHeader = Buffer.alloc(0);
        this._pdfStoredStreamHeaderInputLen = 0;
    };
    // Process traditional xref block
    ExifTransformer.prototype._pdfProcessXrefBlock = function (block) {
        var _this = this;
        var text = block.toString('binary');
        var lines = text.split(/\r?\n|\r/);
        var result = [];
        var inEntries = false;
        for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
            var line = lines_1[_i];
            if (line === 'xref' || line === '') {
                result.push(line);
                inEntries = true;
                continue;
            }
            // Subsection header: startObj count
            var subsectionMatch = line.match(/^(\d+)\s+(\d+)\s*$/);
            if (subsectionMatch) {
                result.push(line);
                continue;
            }
            // Entry: 10-digit offset, 5-digit gen, n or f
            var entryMatch = line.match(/^(\d{10})\s+(\d{5})\s+(n|f)\s*$/);
            if (entryMatch && inEntries) {
                var offset = parseInt(entryMatch[1], 10);
                var gen = entryMatch[2];
                var status = entryMatch[3];
                if (status === 'n') {
                    var newOffset = this._pdfComputeOffset(offset);
                    result.push(String(newOffset).padStart(10, '0') + ' ' + gen + ' ' + status + ' ');
                }
                else {
                    result.push(line);
                }
                continue;
            }
            // trailer, startxref, etc
            if (line.startsWith('trailer')) {
                inEntries = false;
                result.push(line);
                continue;
            }
            if (line === 'startxref') {
                result.push(line);
                continue;
            }
            // startxref offset value
            var offsetVal = line.match(/^(\d+)$/);
            if (offsetVal) {
                var orig = parseInt(offsetVal[1], 10);
                var newVal = this._pdfComputeOffset(orig);
                result.push(String(newVal));
                continue;
            }
            // /Prev in trailer
            var prevLine = line.replace(/\/Prev\s+(\d+)/g, function (_match, p1) {
                var orig = parseInt(p1, 10);
                return '/Prev ' + _this._pdfComputeOffset(orig);
            });
            result.push(prevLine);
        }
        return Buffer.from(result.join('\n'), 'binary');
    };
    // Process cross-reference stream
    ExifTransformer.prototype._pdfProcessXrefStream = function (streamContent, dictText) {
        // Extract /W array for field widths
        var wMatch = dictText.match(/\/W\s*\[(\d+)\s+(\d+)\s+(\d+)\]/);
        if (!wMatch)
            return streamContent;
        var w1 = parseInt(wMatch[1], 10);
        var w2 = parseInt(wMatch[2], 10);
        var w3 = parseInt(wMatch[3], 10);
        var entrySize = w1 + w2 + w3;
        // Check if content is compressed
        var data;
        var isCompressed = /\/Filter\s*\/FlateDecode/.test(dictText);
        try {
            data = isCompressed ? (0, zlib_1.inflateSync)(streamContent) : Buffer.from(streamContent);
        }
        catch (_e) {
            return streamContent;
        }
        // Parse and adjust entries
        var result = Buffer.from(data);
        for (var i = 0; i + entrySize <= result.length; i += entrySize) {
            // Read type field
            var type = 0;
            if (w1 === 0) {
                type = 1; // default
            }
            else {
                for (var j = 0; j < w1; j++) {
                    type = (type << 8) | result[i + j];
                }
            }
            // Type 1 = regular object with byte offset
            if (type === 1 && w2 > 0) {
                var offset = 0;
                for (var j = 0; j < w2; j++) {
                    offset = (offset << 8) | result[i + w1 + j];
                }
                var newOffset = this._pdfComputeOffset(offset);
                // Write back
                for (var j = w2 - 1; j >= 0; j--) {
                    result[i + w1 + j] = newOffset & 0xFF;
                    // Use unsigned right shift
                    offset = newOffset >>> (8 * (w2 - 1 - j));
                }
                // Write properly
                var val = newOffset;
                for (var j = w2 - 1; j >= 0; j--) {
                    result[i + w1 + j] = val & 0xFF;
                    val = Math.floor(val / 256);
                }
            }
        }
        // Recompress if needed
        if (isCompressed) {
            try {
                return (0, zlib_1.deflateSync)(result);
            }
            catch (_e) {
                return streamContent;
            }
        }
        return result;
    };
    return ExifTransformer;
}(stream_1.Transform));
exports.default = ExifTransformer;
module.exports = ExifTransformer;
