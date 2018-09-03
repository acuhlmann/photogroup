export default class ExifParser {

    static parse(allMetadata) {
        delete allMetadata['MakerNote'];

        if(allMetadata['Make'] && allMetadata['Model']) {
            allMetadata['x-Camera'] = allMetadata['Make'] + ' ' + allMetadata['Model'];
            delete allMetadata['Make'];
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
            allMetadata['x-Location'] = {
                lat: ExifParser.latLongToDecimal(gPSLatitude),
                long: ExifParser.latLongToDecimal(gPSLongitude)
            };
            delete allMetadata['GPSLatitude'];
            delete allMetadata['GPSLongitude'];
        }
    }

    //credits: http://blogs.microsoft.co.il/ranw/2015/01/07/reading-gps-data-using-exif-js/
    static latLongToDecimal(number) {
        return number[0].numerator + number[1].numerator /
            (60 * number[1].denominator) + number[2].numerator / (3600 * number[2].denominator);
    }
}