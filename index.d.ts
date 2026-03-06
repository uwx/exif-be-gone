/// <reference types="node" />
/// <reference types="node" />
import { Transform, type TransformOptions, type TransformCallback } from 'stream';
declare type PdfStreamType = 'metadata' | 'image' | 'embedded' | 'xref' | 'pass';
declare class ExifTransformer extends Transform {
    remainingScrubBytes: number | undefined;
    remainingGoodBytes: number | undefined;
    pending: Array<Buffer>;
    mode: 'png' | 'webp' | 'pdf' | 'tiff' | 'isobmff' | 'gif' | 'other' | undefined;
    pdfState: 'scanning' | 'in_dict' | 'in_stream';
    pdfDictBuffer: Buffer;
    pdfDictNesting: number;
    pdfStringNesting: number;
    pdfInEscape: boolean;
    pdfStreamLength: number;
    pdfStreamType: PdfStreamType;
    pdfStreamBytesRead: number;
    pdfStreamData: Buffer[];
    pdfInputOffset: number;
    pdfOutputOffset: number;
    pdfOffsetMap: Array<[number, number]>;
    pdfInXref: boolean;
    pdfXrefBuffer: Buffer;
    pdfPending: Buffer;
    pdfDictStart: number;
    constructor(options?: TransformOptions);
    _transform(chunk: any, _: BufferEncoding, callback: TransformCallback): void;
    _final(callback: TransformCallback): void;
    _scrub(atEnd: Boolean, chunk?: Buffer): void;
    _findJpegMetadataMarker(buf: Buffer, startFrom?: number): number;
    _scrubOther(atEnd: Boolean, chunk?: Buffer): void;
    _scrubPNG(atEnd: Boolean, chunk?: Buffer): void;
    _processPNGGood(chunk: Buffer): Buffer;
    _gifSkipSubBlocks(buf: Buffer, pos: number): number;
    _scrubGIF(buf: Buffer): Buffer;
    _scrubWEBP(atEnd: Boolean, chunk?: Buffer): void;
    _scrubTIFF(buf: Buffer): Buffer;
    _tiffZeroSubIFD(buf: Buffer, offset: number, readU16: (b: Buffer, o: number) => number, readU32: (b: Buffer, o: number) => number, visited: Set<number>): void;
    _scrubISOBMFF(buf: Buffer): Buffer;
    _isobmffParseBoxes(buf: Buffer, start: number, end: number): Array<{
        type: string;
        offset: number;
        size: number;
        dataOffset: number;
    }>;
    _isobmffReadUintBE(buf: Buffer, offset: number, byteCount: number): number;
    _isobmffParseIinf(buf: Buffer, dataOffset: number, boxEnd: number): Array<{
        itemId: number;
        itemType: string;
    }>;
    _isobmffParseIloc(buf: Buffer, dataOffset: number, boxEnd: number): Array<{
        itemId: number;
        extents: Array<{
            offset: number;
            length: number;
        }>;
    }>;
    _pdfPush(data: Buffer): void;
    _pdfSkip(n: number): void;
    _pdfPushModified(origLen: number, newData: Buffer): void;
    _pdfComputeOffset(origOffset: number): number;
    _pdfProcessEmbedded(data: Buffer): Buffer;
    _pdfScrubInfoDict(dictText: string): string;
    _pdfUpdateLength(dictText: string, newLength: number): string;
    _scrubPDF(_atEnd: boolean, chunk?: Buffer): void;
    _pdfHandleDict(buf: Buffer, pos: number): void;
    _pdfStoredDictText: string;
    _pdfStoredDictOrigLen: number;
    _pdfStoredStreamHeader: Buffer;
    _pdfStoredStreamHeaderInputLen: number;
    _pdfFindStreamKeyword(buf: Buffer): number;
    _pdfStreamKeywordEnd(buf: Buffer, streamStart: number): number;
    _pdfHandleStream(buf: Buffer, pos: number, _atEnd: boolean): number;
    _pdfHandlePassStream(buf: Buffer, pos: number, _atEnd: boolean): number;
    _pdfHandleModifiedStream(buf: Buffer, pos: number, _atEnd: boolean): number;
    _pdfFinishModifiedStream(): void;
    _pdfProcessXrefBlock(block: Buffer): Buffer;
    _pdfProcessXrefStream(streamContent: Buffer, dictText: string): Buffer;
}
export default ExifTransformer;
//# sourceMappingURL=index.d.ts.map