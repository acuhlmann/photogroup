import readerWasm from 'zxing-wasm/reader/zxing_reader.wasm?url';
import writerWasm from 'zxing-wasm/writer/zxing_writer.wasm?url';

// QR codes with raw bytes in them, made and read by ZXing (WebAssembly).
// The two halves load on first use: a sender needs only the writer, a
// receiver only the reader. The files come from this site, not from a CDN.

let writer = null;
let reader = null;

function loadWriter() {
    if (!writer) {
        writer = import('zxing-wasm/writer').then(async (module) => {
            // Start the WebAssembly now, so a failed download is seen here and the next try loads again.
            await module.prepareZXingModule({ overrides: { locateFile: () => writerWasm }, fireImmediately: true });
            return module;
        }).catch((err) => { writer = null; throw err; });
    }
    return writer;
}

function loadReader() {
    if (!reader) {
        reader = import('zxing-wasm/reader').then(async (module) => {
            await module.prepareZXingModule({ overrides: { locateFile: () => readerWasm }, fireImmediately: true });
            return module;
        }).catch((err) => { reader = null; throw err; });
    }
    return reader;
}

// What the codes are made and read with. 'M' error correction, not the
// lowest 'L': a blurred or partly glaring code can still be read, which
// matters more for a handheld camera than the slightly denser code it
// costs (the slow speed level more than pays for that in coarseness).
export const QR_WRITE_OPTIONS = { format: 'QRCode', ecLevel: 'M', withQuietZones: false };

/** The code for some bytes: `{ data, width, height }`, 0 for a dark module. */
export async function qrSymbol(bytes) {
    const { writeBarcode } = await loadWriter();
    const result = await writeBarcode(bytes, QR_WRITE_OPTIONS);
    if (result.error || !result.symbol?.width) throw new Error(result.error || 'no code');
    return result.symbol;
}

/** Draw a code on a canvas, one pixel per module; CSS makes it large. */
export function drawSymbol(canvas, symbol) {
    if (canvas.width !== symbol.width) canvas.width = symbol.width;
    if (canvas.height !== symbol.height) canvas.height = symbol.height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(symbol.width, symbol.height);
    for (let i = 0; i < symbol.data.length; i++) {
        const shade = symbol.data[i] === 0 ? 0 : 255;
        image.data[i * 4] = shade;
        image.data[i * 4 + 1] = shade;
        image.data[i * 4 + 2] = shade;
        image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
}

// Reading asks ZXing to work hard: a code filmed by hand is blurred,
// tilted and often larger than the picture is wide. With every one of
// these off (as they were), such codes were quietly not read and the
// transfer sat still with nothing on screen saying why.
export const QR_READ_OPTIONS = {
    formats: ['QRCode'],
    tryHarder: true,
    tryRotate: true,
    tryInvert: false,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
};

/** The bytes of the code in a camera picture, or null. */
export async function readQrBytes(imageData) {
    const { readBarcodes } = await loadReader();
    const [found] = await readBarcodes(imageData, QR_READ_OPTIONS);
    return found?.isValid && found.bytes?.length ? found.bytes : null;
}

/** Load the reader before the camera starts, so the first frames are not lost. */
export function prepareReader() {
    return loadReader();
}

/** Load the writer ahead of its first code. */
export function prepareWriter() {
    return loadWriter();
}
