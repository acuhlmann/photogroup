import moment from 'moment';
import XmpParser from "./XmpParser";
import ExifParser from "./ExifParser";
import FileUtil from "../util/FileUtil";
import EXIF from 'exif-js';
import Logger from 'js-logger';
import jsmediatags from 'jsmediatags';
import StringUtil from "../util/StringUtil";

export default class MetadataParser {

    constructor() {
        window.EXIF = EXIF;
    }

    async readMetadata(tile, callback) {

        if(tile.isImage) {

            const self = this;
            const EXIF = window.EXIF;
            EXIF.enableXmp();
            try {
                EXIF.getData(tile.elem, function()  {

                    const metadata = self.extractAndProcess(this, tile);
                    callback(tile, metadata);
                });
            } catch(e) {
                Logger.error('error parsing image ');
            }

        } else if(tile.isAudio) {

            jsmediatags.read(tile.elem, {
                onSuccess: (tag) => {
                    Logger.info('id3 tag ' + tag);
                    const tags = tag.tags;

                    tile.picSummary = StringUtil.addEmptySpaces([
                        tags.artist, tags.title, tags.album, tags.genre]);

                    tags.format = StringUtil.addEmptySpaces([tag.type, tag.version, tag.major, tag.revision]);
                    tags.size = tag.size;
                    tags.flags = tag.flags;
                    callback(tile, tags);
                },
                onError: (error) => {
                    Logger.error(error);
                }
            });

        } else if(tile.isVideo) {


        }
    }

    extractAndProcess(img, tile) {

        const EXIF = window.EXIF;
        const allMetadata = EXIF.getAllTags(img);

        XmpParser.parse(allMetadata, img.xmpdata);
        ExifParser.parse(allMetadata);

        allMetadata['x-file name'] = tile.torrent.name;
        const picDesc = MetadataParser.findBestDesc(allMetadata);
        if(picDesc) {
            allMetadata['x-Description'] = picDesc;
        }

        //tile.allMetadata = allMetadata;
        this.sortByDate(tile, allMetadata);
        return allMetadata;
    }

    static findBestDesc(allMetadata) {
        const picDescXmp = allMetadata['Description XMP'];
        const picDesc = allMetadata['ImageDescription'];
        if((picDescXmp && picDesc) && picDescXmp === picDesc) {
            return picDesc;
        } else if((picDescXmp && picDesc) && picDescXmp !== picDesc) {
            return picDescXmp + ' ' + picDesc;
        } else if(picDescXmp || picDesc) {
            return picDescXmp || picDesc;
        }
        else {
            return '';
        }
    }

    sortByDate(tile, allMetadata) {

        const tileItem = tile;
        const DateTimeOriginal = allMetadata['DateTimeOriginal'];
        const timestamp = MetadataParser.toTimeStamp(DateTimeOriginal);

        if(tileItem) {
            const picDateTaken = MetadataParser.formatDateFromTimeStamp(timestamp);
            tileItem.picDateTaken = picDateTaken === 'Invalid date' ? '' : picDateTaken;
            tileItem.picDateTakenDate = timestamp.toDate();

            tileItem.picTitle = allMetadata['Title XMP'] ? allMetadata['Title XMP'] + ' ' : '';
            tileItem.picDesc = allMetadata['x-Description'] ? allMetadata['x-Description'] + ' ' : '';
            tileItem.fileName = FileUtil.truncateFileName(tile.torrent.name);

            tileItem.picSummary = this.createSummary(allMetadata, tileItem.picDateTaken, tile.torrent.name);
            const cameraMake = allMetadata['Make'] ? allMetadata['Make']  + ' ': '';
            const cameraSettings = allMetadata['x-Settings'] ? allMetadata['x-Settings'] : '';
            tileItem.cameraSettings = cameraMake + cameraSettings;
        }
    }

    createSummary(allMetadata, picDateTaken, name) {
        const picTitle = allMetadata['Title XMP'] ? allMetadata['Title XMP'] + ' ' : '';
        const picDesc = allMetadata['x-Description'] ? allMetadata['x-Description'] + ' ' : '';
        return picDateTaken + ' '
            + picTitle + picDesc
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

    createMetadataSummary(rawMetadata, tile) {

        if(!rawMetadata) return;

        const metadata = Object.entries(rawMetadata)
            .filter(entry => entry[0] !== 'thumbnail')
            .map(entry => {

                const key = entry[0];
                const valueObj = entry[1];
                let newValueObj;

                if(tile.isImage) {
                    if(key.substring(0, 2) === 'x-') {
                        newValueObj = valueObj;
                    } else if(key === 'DateTimeOriginal') {
                        newValueObj = MetadataParser.formatDate(valueObj);
                    } else if(Array.isArray(valueObj)) {
                        newValueObj = valueObj.toString();
                    } else if(typeof valueObj === 'string' || valueObj instanceof String) {
                        newValueObj = valueObj;
                    } else {
                        newValueObj = JSON.stringify(valueObj);
                    }
                } else if(tile.isAudio) {
                    if(key === 'flags' && valueObj) {

                        newValueObj = Object.entries(valueObj).map(entry => entry[0] + ': ' + entry[1] + ', ');

                    } else if(key === 'picture') {
                        newValueObj = valueObj;
                    } else if(key === 'size') {
                        newValueObj = FileUtil.formatBytes(valueObj);
                    }
                    else if(valueObj && valueObj.id) {
                        newValueObj = null;
                    } else if(Array.isArray(valueObj)) {
                        newValueObj = valueObj.toString();
                    } else if(typeof valueObj === 'string' || valueObj instanceof String) {
                        newValueObj = valueObj;
                    } else {
                        newValueObj = JSON.stringify(valueObj);
                    }
                }

                return {key: key,
                    value: newValueObj};
            }).filter(item => item.value);

        if(tile.isImage) {
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
        } else if(tile.isAudio) {
            ['x-file name', 'picture', 'artist', 'title', 'album', 'track', 'year', 'comment', 'format']
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
        }

        return metadata;
    }
}