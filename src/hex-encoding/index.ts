/*!
The MIT License (MIT)

Copyright (c) 2021-present Fabio Spampinato
Copyright (c) 2022-present Fabio Spampinato

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
*/

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

const U8_encode = (data: string): Uint8Array => {
    return encoder.encode(data);
};

const U8_decode = (data: Uint8Array): string => {
    return decoder.decode(data);
};

const DEC2HEX = (() => {
    const alphabet = "0123456789abcdef";
    const dec2hex16 = [...alphabet];
    const dec2hex256 = new Array<string>(256);

    for (let i = 0; i < 256; i++) {
        dec2hex256[i] = `${dec2hex16[(i >>> 4) & 0xf]}${dec2hex16[i & 0xf]}`;
    }

    return dec2hex256;
})();

const HEX2DEC = (() => {
    const hex2dec: Record<string, number> = {};

    for (let i = 0; i < 256; i++) {
        const hex = DEC2HEX[i];
        const firstLower = hex[0];
        const firstUpper = firstLower.toUpperCase();
        const lastLower = hex[1];
        const lastUpper = lastLower.toUpperCase();

        hex2dec[hex] = i;
        hex2dec[`${firstLower}${lastUpper}`] = i;
        hex2dec[`${firstUpper}${lastLower}`] = i;
        hex2dec[`${firstUpper}${lastUpper}`] = i;
    }

    return hex2dec;
})();

export const is = (data: string): boolean => {
    if (data.length % 2) return false;

    if (!/^[a-fA-F0-9]*$/.test(data)) return false;

    return true;
};

export const encode = (data: Uint8Array): string => {
    let hex = "";

    for (let i = 0, l = data.length; i < l; i++) {
        hex += DEC2HEX[data[i]];
    }

    return hex;
};

export const encodeStr = (data: string): string => {
    return encode(U8_encode(data));
}

export const decode = (data: string): Uint8Array => {
    const length = data.length / 2;
    const u8 = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
        u8[i] = HEX2DEC[data.slice(i * 2, i * 2 + 2)];
    }

    return u8;
};

export const decodeStr = (data: string): string => {
    return U8_decode(decode(data));
};
