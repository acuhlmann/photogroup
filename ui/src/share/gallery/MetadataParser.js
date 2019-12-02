import moment from 'moment';
import XmpParser from "./XmpParser";
import ExifParser from "./ExifParser";
import FileUtil from "../util/FileUtil";

export default class MetadataParser {

    readMetadata(tile, img, callback) {

        const scope = this;

        //const id = event.currentTarget.id;
        //const img = document.getElementById(id);

        //const index = id.substring(3, id.length);
        const EXIF = window.EXIF;
        EXIF.enableXmp();
        EXIF.getData(tile.elem, function()  {

            scope.extractAndProcess(this, tile);
            callback(tile);
        });
    }

    extractAndProcess(img, tile) {

        const EXIF = window.EXIF;
        const allMetadata = EXIF.getAllTags(img);

        XmpParser.parse(allMetadata, img.xmpdata);
        ExifParser.parse(allMetadata);

        allMetadata['x-file name'] = tile.torrent.name;
        const desc = MetadataParser.findBestDesc(allMetadata);
        if(desc)
            allMetadata['x-Description'] = desc;

        tile.allMetadata = allMetadata;
        this.sortByDate(tile, allMetadata);
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

    sortByDate(tile, allMetadata) {

        const DateTimeOriginal = allMetadata['DateTimeOriginal'];
        const timestamp = MetadataParser.toTimeStamp(DateTimeOriginal);

        const tiles = this.view.state.tileData;
        const tileItem = tiles.find(item => item.torrent.infoHash === tile.torrent.infoHash);
        if(tileItem) {
            const dateTaken = MetadataParser.formatDateFromTimeStamp(timestamp);
            tileItem.dateTaken = dateTaken === 'Invalid date' ? '' : dateTaken;
            tileItem.dateTakenDate = timestamp.toDate();

            tileItem.title = allMetadata['Title XMP'] ? allMetadata['Title XMP'] + ' ' : '';
            tileItem.desc = allMetadata['x-Description'] ? allMetadata['x-Description'] + ' ' : '';
            tileItem.fileName = FileUtil.truncateFileName(tile.torrent.name);

            tileItem.summary = this.createSummary(allMetadata, tileItem.dateTaken, tile.torrent.name);
            const cameraMake = allMetadata['Make'] ? allMetadata['Make']  + ' ': '';
            const cameraSettings = allMetadata['x-Settings'] ? allMetadata['x-Settings'] : '';
            tileItem.cameraSettings = cameraMake + cameraSettings;

            tiles.sort(function(a,b){
                return new Date(b.dateTakenDate) - new Date(a.dateTakenDate);
            });
            this.view.setState({tileData: tiles});
        }
    }

    createSummary(allMetadata, dateTaken, name) {
        const title = allMetadata['Title XMP'] ? allMetadata['Title XMP'] + ' ' : '';
        const desc = allMetadata['x-Description'] ? allMetadata['x-Description'] + ' ' : '';
        return dateTaken + ' '
            + title + desc
            + FileUtil.truncateFileName(name)
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

        if(!rawMetadata) return;

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

        ['x-file name', 'Title XMP', 'x-Description', 'Rating XMP', 'Keywords XMP', 'XPKeywords',
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