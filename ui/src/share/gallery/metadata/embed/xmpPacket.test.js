import { describe, it, expect } from 'vitest';
import { applyDetailsToXmp } from './xmpPacket';

// ExifTool writes GPS values as elements. When Android blanks the location,
// it fills the element's value with zero bytes but leaves the tags.
const ZEROED_GPS = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:GCamera="http://ns.google.com/photos/1.0/camera/">
   <GCamera:MotionPhoto>1</GCamera:MotionPhoto>
   <exif:GPSLatitude>${'\0'.repeat(12)}</exif:GPSLatitude>
   <exif:GPSLongitude>${'\0'.repeat(12)}</exif:GPSLongitude>
   <dc:subject><rdf:Bag><rdf:li>harbour</rdf:li></rdf:Bag></dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>${'\0'.repeat(8)}`;

describe('applyDetailsToXmp', () => {
    it('keeps the other fields when Android zeroed a GPS element', () => {
        const xml = applyDetailsToXmp(ZEROED_GPS, { title: 'Dock' });

        expect(xml).not.toContain('\0');
        expect(xml).toContain('MotionPhoto>1<');
        expect(xml).toContain('>harbour<');
        expect(xml).toContain('>Dock<');
    });

    it('replaces the zeroed location when the room sets one', () => {
        const xml = applyDetailsToXmp(ZEROED_GPS, { location: { lat: 47.37, long: 8.54 } });

        expect(xml).toContain('MotionPhoto>1<');
        expect(xml).toMatch(/GPSLatitude="47,22\.2+\d*N"/);
        expect(xml.match(/GPSLatitude/g)).toHaveLength(1);
    });
});
