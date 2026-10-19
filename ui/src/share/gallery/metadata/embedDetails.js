import Logger from 'js-logger';
import { SHARED_FIELDS } from './groupPhotoMetadata';

// Write the room's shared details (title, description, rating) into a saved
// photo's XMP, so the edits travel with the file instead of only living on
// the server. Only JPEG is rewritten; anything else is returned unchanged.

const NS = {
    x: 'adobe:ns:meta/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    dc: 'http://purl.org/dc/elements/1.1/',
    xmp: 'http://ns.adobe.com/xap/1.0/',
    xmlns: 'http://www.w3.org/2000/xmlns/',
    xml: 'http://www.w3.org/XML/1998/namespace',
};

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';
const MAX_SEGMENT_LENGTH = 0xFFFF;

const EMPTY_PACKET = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + `<x:xmpmeta xmlns:x="${NS.x}"><rdf:RDF xmlns:rdf="${NS.rdf}">`
    + '<rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

/** The shared fields someone actually set, or null when there are none. */
function sharedChanges(details) {
    if (!details) return null;
    const changes = {};
    SHARED_FIELDS.forEach(key => {
        if (details[key] !== undefined) changes[key] = details[key];
    });
    return Object.keys(changes).length ? changes : null;
}

/** Split a JPEG into its header segments up to the image data. */
function readSegments(bytes) {
    const segments = [];
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 0xFF) {
        const marker = bytes[offset + 1];
        if (marker === 0xFF) { offset++; continue; } // fill byte
        if (marker === 0xDA) break; // start of scan
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        segments.push({ marker, start: offset, end: offset + 2 + length });
        offset += 2 + length;
    }
    return segments;
}

function isXmpSegment(bytes, segment) {
    if (segment.marker !== 0xE1) return false;
    const header = new TextDecoder('latin1').decode(bytes.subarray(segment.start + 4, segment.start + 4 + XMP_HEADER.length));
    return header === XMP_HEADER;
}

function declare(element, prefix) {
    if (element.lookupNamespaceURI(prefix) !== NS[prefix]) {
        element.setAttributeNS(NS.xmlns, 'xmlns:' + prefix, NS[prefix]);
    }
}

function langAlt(doc, name, text) {
    const field = doc.createElementNS(NS.dc, name);
    const alt = doc.createElementNS(NS.rdf, 'rdf:Alt');
    const li = doc.createElementNS(NS.rdf, 'rdf:li');
    li.setAttributeNS(NS.xml, 'xml:lang', 'x-default');
    li.textContent = text;
    alt.appendChild(li);
    field.appendChild(alt);
    return field;
}

/** Parse an XMP packet, falling back to an empty one when it is missing or broken. */
function parsePacket(xml) {
    const parser = new DOMParser();
    if (xml) {
        const doc = parser.parseFromString(xml.replace(/\0+$/, ''), 'application/xml');
        if (!doc.getElementsByTagName('parsererror').length
            && doc.getElementsByTagNameNS(NS.rdf, 'RDF').length) {
            return doc;
        }
        Logger.warn('Replacing unreadable XMP while saving photo details');
    }
    return parser.parseFromString(EMPTY_PACKET, 'application/xml');
}

/**
 * Apply shared details to an XMP packet. A cleared title or description,
 * or a rating of 0, removes the field rather than writing it empty.
 */
export function applyDetailsToXmp(xml, details) {
    const doc = parsePacket(xml);
    const rdf = doc.getElementsByTagNameNS(NS.rdf, 'RDF')[0];
    const descriptions = Array.from(doc.getElementsByTagNameNS(NS.rdf, 'Description'));

    descriptions.forEach(description => {
        if (details.title !== undefined) {
            Array.from(description.getElementsByTagNameNS(NS.dc, 'title')).forEach(node => node.remove());
        }
        if (details.description !== undefined) {
            Array.from(description.getElementsByTagNameNS(NS.dc, 'description')).forEach(node => node.remove());
        }
        if (details.rating !== undefined) {
            description.removeAttributeNS(NS.xmp, 'Rating');
            Array.from(description.getElementsByTagNameNS(NS.xmp, 'Rating')).forEach(node => node.remove());
        }
    });

    let target = descriptions[0];
    if (!target) {
        target = doc.createElementNS(NS.rdf, 'rdf:Description');
        target.setAttributeNS(NS.rdf, 'rdf:about', '');
        rdf.appendChild(target);
    }

    if (details.rating !== undefined && details.rating !== 0) {
        declare(target, 'xmp');
        target.setAttributeNS(NS.xmp, 'xmp:Rating', String(details.rating));
    }
    if (details.title) {
        declare(target, 'dc');
        target.appendChild(langAlt(doc, 'dc:title', details.title));
    }
    if (details.description) {
        declare(target, 'dc');
        target.appendChild(langAlt(doc, 'dc:description', details.description));
    }

    return new XMLSerializer().serializeToString(doc);
}

/**
 * Return the photo with its shared details embedded as XMP. Non-JPEG files,
 * photos without shared details, and packets too large for one APP1 segment
 * come back unchanged.
 */
export async function embedDetails(blob, details) {
    const changes = sharedChanges(details);
    if (!changes || !blob || typeof blob.arrayBuffer !== 'function') return blob;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return blob;

    const segments = readSegments(bytes);
    const existing = segments.find(segment => isXmpSegment(bytes, segment));
    const oldXml = existing
        ? new TextDecoder('utf-8').decode(bytes.subarray(existing.start + 4 + XMP_HEADER.length, existing.end))
        : null;
    const payload = new TextEncoder().encode(XMP_HEADER + applyDetailsToXmp(oldXml, changes));

    const length = payload.length + 2;
    if (length > MAX_SEGMENT_LENGTH) {
        Logger.warn('Photo details are too large to embed; saving the original file');
        return blob;
    }
    const segment = new Uint8Array(4 + payload.length);
    segment.set([0xFF, 0xE1, length >> 8, length & 0xFF]);
    segment.set(payload, 4);

    let before;
    let after;
    if (existing) {
        before = existing.start;
        after = existing.end;
    } else {
        // Keep JFIF/Exif first, as readers expect, and put XMP right after them.
        const leading = segments.findIndex(item => item.marker !== 0xE0 && item.marker !== 0xE1);
        const anchor = leading < 0 ? segments[segments.length - 1] : segments[leading - 1];
        before = after = anchor ? anchor.end : 2;
    }
    return new Blob([bytes.subarray(0, before), segment, bytes.subarray(after)],
        { type: blob.type || 'image/jpeg' });
}
