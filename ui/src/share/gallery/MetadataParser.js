import moment from 'moment';
import XmpParser from "./XmpParser";
import ExifParser from "./ExifParser";

export default class MetadataParser {

    readMetadata(tile, event) {

        const scope = this;

        const id = event.currentTarget.id;
        const img = document.getElementById(id);

        const index = id.substring(3, id.length);
        const EXIF = window.EXIF;
        EXIF.enableXmp();
        EXIF.getData(img, function()  {

            scope.extractAndProcess(this, index, tile);
        });
    }

    extractAndProcess(img, index, tile) {

        const EXIF = window.EXIF;
        const allMetadata = EXIF.getAllTags(img);

        XmpParser.parse(allMetadata, img.xmpdata);
        ExifParser.parse(allMetadata);

        allMetadata['x-Description'] = MetadataParser.findBestDesc(allMetadata);

        tile.allMetadata = allMetadata;
        this.sortByDate(tile, index, allMetadata);
    }

    static findBestDesc(allMetadata) {
        const descXmp = allMetadata['Description XMP'];
        const desc = allMetadata['ImageDescription'];
        if((descXmp && desc) && descXmp === desc) {
            return desc;
        } else if((descXmp && desc) && descXmp !== desc) {
            return descXmp + ' ' + desc;
        } else if(descXmp || desc) {
            return descXmp || desc;
        }
        else {
            return '';
        }
    }

    sortByDate(tile, index, allMetadata) {

        const DateTimeOriginal = allMetadata['DateTimeOriginal'];
        const timestamp = MetadataParser.toTimeStamp(DateTimeOriginal);

        const tileCopy = this.view.state.tileData.slice();
        if(tileCopy[index]) {
            const dateTaken = MetadataParser.formatDateFromTimeStamp(timestamp);
            tileCopy[index].dateTaken = dateTaken === 'Invalid date' ? '' : dateTaken;
            tileCopy[index].dateTakenDate = timestamp.toDate();

            const title = allMetadata['Title XMP'] ? allMetadata['Title XMP'] : '';
            tileCopy[index].summary = tileCopy[index].dateTaken + ', '
                + title + ' ' + allMetadata['x-Description'];
            tileCopy[index].cameraSettings = allMetadata['x-Settings'];

            tileCopy.sort(function(a,b){
                return new Date(b.dateTakenDate) - new Date(a.dateTakenDate);
            });
            this.view.setState({tileData: tileCopy});
        }
    }

    static toTimeStamp(date) {
        return moment(date, "YYYY:MM:DD HH:mm:ss");
    }

    static toDate(date) {
        return MetadataParser.toTimeStamp(date).toDate();
    }

    static formatDate(date) {
        return MetadataParser.formatDateFromTimeStamp(MetadataParser.toTimeStamp(date));
    }

    static formatDateFromTimeStamp(date) {
        return date.format("HH:mm:ss MMM Do YY");
    }

    createMetadataSummary(rawMetadata) {

        const metadata = Object.entries(rawMetadata)
            .filter(entry => entry[0] !== 'thumbnail')
            .map(entry => {

                const key = entry[0];
                const valueObj = entry[1];
                let newValueObj;

                if(key.substring(0, 2) === 'x-') {
                    newValueObj = valueObj;
                } else if(key === 'DateTimeOriginal') {
                    newValueObj = MetadataParser.formatDate(valueObj);
                }
                else if(Array.isArray(valueObj)) {
                    newValueObj = valueObj.toString();
                } else if(typeof valueObj === 'string' || valueObj instanceof String) {
                    newValueObj = valueObj;
                } else {
                    newValueObj = JSON.stringify(valueObj);
                }

                return {key: key,
                    value: newValueObj};
            });

        ['Title XMP', 'x-Description', 'Rating XMP', 'Keywords XMP', 'XPKeywords',
            'DateTimeOriginal', 'x-Location', 'GPSAltitude',
            'x-Pixel Size', 'x-Camera', 'x-Settings',
            'DigitalZoomRation', 'Flash', 'WhiteBalance', 'MeteringMode',
            'Software', 'x-Last Save with', 'x-Last Save at']
            .reverse()
            .forEach(key => {

            metadata.find((item, index) => {
                if(item.key === key) {

                    metadata.splice(index, 1);
                    metadata.unshift(item);
                    return true;
                }
                return false;
            });
        });

        return metadata;
    }
}