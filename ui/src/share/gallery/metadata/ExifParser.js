export default class ExifParser {

    static parse(allMetadata) {
        delete allMetadata['MakerNote'];

        if(allMetadata['Make'] && allMetadata['Model']) {
            // Many models already carry the brand ("Canon EOS R5")
            const make = String(allMetadata['Make']).trim();
            const model = String(allMetadata['Model']).trim();
            allMetadata['x-Camera'] = model.toLowerCase().startsWith(make.toLowerCase()) ? model : make + ' ' + model;
            //delete allMetadata['Make'];
            delete allMetadata['Model'];
        }

        this.processGeo(allMetadata);
        this.processImageSize(allMetadata);
        this.processCamSettings(allMetadata);

        delete allMetadata['undefined'];
    }

    static processImageSize(allMetadata) {
        const ImageWidth = allMetadata['ImageWidth'];
        const ImageHeight = allMetadata['ImageHeight'];
        if(ImageWidth && ImageHeight) {
            allMetadata['x-Pixel Size'] = ImageWidth + ' x ' + ImageHeight;
            delete allMetadata['ImageWidth'];
            delete allMetadata['ImageHeight'];
        }
    }

    static processCamSettings(data) {
        if(data['ISOSpeedRatings'] && data['FocalLength'] && data['FNumber'] && data['ExposureTime']) {

            const exposure = Number(data['ExposureTime'].denominator) / Number(data['ExposureTime'].numerator);
            data['x-Settings'] = 'ISO-'+data['ISOSpeedRatings']
                + ', ' + data['FocalLength'] + 'mm, f/'
                + data['FNumber'] + ', 1/' + Math.round(exposure) + 's';
        }
    }

    static processGeo(allMetadata) {
        const gPSLatitude = allMetadata['GPSLatitude'];
        const gPSLongitude = allMetadata['GPSLongitude'];
        if(gPSLatitude && gPSLongitude) {
            // exifr already adds signed decimal latitude/longitude; fall back to
            // the DMS arrays plus their N/S/E/W references.
            const lat = Number.isFinite(allMetadata.latitude) ? allMetadata.latitude
                : ExifParser.latLongToDecimal(gPSLatitude, allMetadata['GPSLatitudeRef']);
            const long = Number.isFinite(allMetadata.longitude) ? allMetadata.longitude
                : ExifParser.latLongToDecimal(gPSLongitude, allMetadata['GPSLongitudeRef']);
            if(Number.isFinite(lat) && Number.isFinite(long)) {
                allMetadata['x-Location'] = { lat, long };
            }
            delete allMetadata['GPSLatitude'];
            delete allMetadata['GPSLongitude'];
            delete allMetadata['latitude'];
            delete allMetadata['longitude'];
        }
    }

    //credits: http://blogs.microsoft.co.il/ranw/2015/01/07/reading-gps-data-using-exif-js/
    static latLongToDecimal(number, reference) {
        if(!Array.isArray(number) || number.length < 3) return NaN;
        const [degrees, minutes, seconds] = number.map(part => (typeof part === 'number'
            ? part
            : Number(part.numerator) / Number(part.denominator)));
        const decimal = degrees + minutes / 60 + seconds / 3600;
        return reference === 'S' || reference === 'W' ? -decimal : decimal;
    }
}
