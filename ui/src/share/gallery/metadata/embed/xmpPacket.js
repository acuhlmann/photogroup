import Logger from 'js-logger';

// Merge shared details into an XMP packet, the metadata block that JPEG,
// PNG, WebP and HEIF/AVIF all carry the same way.

const NS = {
    x: 'adobe:ns:meta/',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    dc: 'http://purl.org/dc/elements/1.1/',
    xmp: 'http://ns.adobe.com/xap/1.0/',
    exif: 'http://ns.adobe.com/exif/1.0/',
    xmlns: 'http://www.w3.org/2000/xmlns/',
    xml: 'http://www.w3.org/XML/1998/namespace',
};

const EMPTY_PACKET = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + `<x:xmpmeta xmlns:x="${NS.x}"><rdf:RDF xmlns:rdf="${NS.rdf}">`
    + '<rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

/** XMP's GPS coordinate text, "DDD,MM.mmmmmmK" (degrees, decimal minutes, hemisphere). */
export function xmpCoordinate(value, positive, negative) {
    const abs = Math.abs(value);
    const degrees = Math.floor(abs);
    const minutes = Number(((abs - degrees) * 60).toFixed(6));
    return `${degrees},${minutes}${value < 0 ? negative : positive}`;
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
 * a rating of 0, or a location of null removes the field rather than
 * writing it empty.
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
        if (details.location !== undefined) {
            // A moved or hidden location makes the old altitude, heading and so on stale too.
            Array.from(description.attributes)
                .filter(attr => attr.namespaceURI === NS.exif && attr.localName.startsWith('GPS'))
                .forEach(attr => description.removeAttributeNode(attr));
            Array.from(description.getElementsByTagNameNS(NS.exif, '*'))
                .filter(node => node.localName.startsWith('GPS'))
                .forEach(node => node.remove());
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
    if (details.location) {
        declare(target, 'exif');
        target.setAttributeNS(NS.exif, 'exif:GPSLatitude', xmpCoordinate(details.location.lat, 'N', 'S'));
        target.setAttributeNS(NS.exif, 'exif:GPSLongitude', xmpCoordinate(details.location.long, 'E', 'W'));
    }

    return new XMLSerializer().serializeToString(doc);
}
