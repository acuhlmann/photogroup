import { describe, it, expect } from 'vitest';
import { embedDetails } from './embedDetails';
import XmpParser from './XmpParser';

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

function segment(marker, payload) {
    const length = payload.length + 2;
    return [0xFF, marker, length >> 8, length & 0xFF, ...payload];
}

function jpeg(...segments) {
    const jfif = segment(0xE0, [...new TextEncoder().encode('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const scan = [...segment(0xDA, [1, 2, 3]), 0x11, 0x22, 0x33, 0xFF, 0xD9];
    return new Blob([new Uint8Array([0xFF, 0xD8, ...jfif, ...segments.flat(), ...scan])], { type: 'image/jpeg' });
}

function xmpSegment(xml) {
    return segment(0xE1, [...new TextEncoder().encode(XMP_HEADER + xml)]);
}

async function readXmp(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const start = text.indexOf(XMP_HEADER);
    if (start < 0) return null;
    const end = text.indexOf('</x:xmpmeta>', start);
    return text.slice(start + XMP_HEADER.length, end + '</x:xmpmeta>'.length);
}

describe('embedDetails', () => {
    it('returns the original file when nobody edited its details', async () => {
        const blob = jpeg();
        expect(await embedDetails(blob, undefined)).toBe(blob);
        expect(await embedDetails(blob, { editedBy: 'peer', editedAt: 1 })).toBe(blob);
    });

    it('leaves files that are not JPEG untouched', async () => {
        const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], { type: 'image/png' });
        expect(await embedDetails(blob, { title: 'Sunset' })).toBe(blob);
    });

    it('adds an XMP packet the app reads back as the shared details', async () => {
        const result = await embedDetails(jpeg(), { title: 'Sunset', description: 'At the pier', rating: 4 });
        const metadata = XmpParser.parse({}, await readXmp(result));
        expect(metadata['Title XMP']).toBe('Sunset');
        expect(metadata['Description XMP']).toBe('At the pier');
        expect(Number(metadata['Rating XMP'])).toBe(4);

        const bytes = new Uint8Array(await result.arrayBuffer());
        expect([bytes[0], bytes[1]]).toEqual([0xFF, 0xD8]);
        expect(Array.from(bytes.slice(-2))).toEqual([0xFF, 0xD9]);
        expect(result.type).toBe('image/jpeg');
    });

    it('replaces edited fields in existing XMP and keeps the rest', async () => {
        const original = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            + '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="2" xmp:CreatorTool="Lightroom">'
            + '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old title</rdf:li></rdf:Alt></dc:title>'
            + '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Old description</rdf:li></rdf:Alt></dc:description>'
            + '<dc:subject><rdf:Bag><rdf:li>beach</rdf:li></rdf:Bag></dc:subject>'
            + '</rdf:Description></rdf:RDF></x:xmpmeta>';
        const result = await embedDetails(jpeg(xmpSegment(original)), { title: 'New title', rating: 0 });
        const xml = await readXmp(result);
        const metadata = XmpParser.parse({}, xml);

        expect(metadata['Title XMP']).toBe('New title');
        expect(metadata['Description XMP']).toBe('Old description');
        expect(metadata['Rating XMP']).toBeUndefined();
        expect(metadata['x-CreatorTool']).toBe('Lightroom');
        expect(xml).toContain('beach');
        expect(xml).not.toContain('Old title');
        expect(new TextDecoder().decode(await result.arrayBuffer()).split(XMP_HEADER)).toHaveLength(2);
    });

    it('removes a cleared title instead of writing it empty', async () => {
        const original = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            + '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">'
            + '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Old title</rdf:li></rdf:Alt></dc:title>'
            + '</rdf:Description></rdf:RDF></x:xmpmeta>';
        const result = await embedDetails(jpeg(xmpSegment(original)), { title: '' });
        expect(XmpParser.parse({}, await readXmp(result))['Title XMP']).toBeUndefined();
    });
});
