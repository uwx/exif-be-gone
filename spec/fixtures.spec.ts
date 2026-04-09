import { exiftool, Tags } from "exiftool-vendored";
import ExifBeGone from "../src/index";
import { globby } from "globby";
import { assert, describe, expect, it } from 'vitest';
import streamBuffers, { WritableStreamBuffer } from "stream-buffers";
import { createReadStream, openAsBlob } from 'node:fs';
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { inspect } from "node:util";
import { Readable, Writable } from "node:stream";

const extensions = [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'tif',
    'tiff',
    'heic',
    'heif',
    'avif',
    'jxl',
    'pdf',
];

const dirs = `samples
exif-samples
metadata-extractor-images
exifr-fixtures/test/fixtures
imagemeta-fixtures/testdata/images
pypdf-samples
exiftool-fixtures/t/images`.split("\n").map(dir => dir.trim());

const exclusions = ['!**/\.git/**', '!**/corrupt/**'];

const globs = dirs.flatMap(dir => extensions.map(ext => `${dir}/**/*.${ext}`)).concat(exclusions);

const files = await globby([...globs, ...exclusions], { absolute: true });

async function processWithExifTool(file: string | Buffer, ext?: string) {
    if (typeof file === "string") {
        return await exiftool.read(file);
    }

    const tempFile = resolve(tmpdir(), `temp-${Date.now()}.${ext || "tmp"}`);
    await writeFile(tempFile, file);
    try {
        return await exiftool.read(tempFile);
    } finally {
        await unlink(tempFile);
    }
}

describe("Fixture tests", () => {
    for (const file of files) {
        it(`should process ${file} without error if exiftool processes it without error`, async (ctx) => {
            let preTags: Tags;

            try {
                preTags = await processWithExifTool(file);
            } catch (err) {
                console.error(err);
                ctx.skip();
            }

            return new Promise<WritableStreamBuffer>((resolve, reject) => {
                const writer = new streamBuffers.WritableStreamBuffer();
                Readable.toWeb(createReadStream(file))
                    .pipeThrough(new ExifBeGone())
                    .pipeTo(Writable.toWeb(writer))
                    .then(() => {
                        resolve(writer);
                    })
                    .catch((err) => {
                        reject(err);
                    });
            }).then(async writer => {
                assert(writer.size() > 0, "Output file should not be empty");
                const contents = writer.getContents();
                assert(contents instanceof Buffer, "Output should be a Buffer");
                const postTags = await processWithExifTool(contents as Buffer, file.toString().split('.').pop());

                // console.log(`Processed ${file}`);
                // console.log("Pre-processing tags:", preTags);
                // console.log("Post-processing tags:", postTags);

                const tags = JSON.stringify(postTags).toLowerCase();

                for (const tag of [
                    'gps', 'coordinates', 'latitude', 'longitude', 'altitude', 'digital signature', 'exif version', 'xmp toolkit', 'by-line', 'caption-abstract', 'keywords', 'artist', 'copyright', 'image description', 'author', 'title'
                ]) {
                    expect(tags).to.not.include(tag, `Tag "${tag}" should not be present in the output. tags: ${inspect(postTags)}`);
                }
            });
        });
    }
});