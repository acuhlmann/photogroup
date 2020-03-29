import moment from 'moment';
import momentDurationFormatSetup  from 'moment-duration-format';
import XmpParser from "./XmpParser";
import ExifParser from "./ExifParser";
import * as exifr from 'exifr';
import FileUtil from "../../util/FileUtil";
import Logger from 'js-logger';
import * as mm from 'music-metadata-browser';
import StringUtil from "../../util/StringUtil";
import _ from 'lodash';

export default class MetadataParser {

    async readMetadata(tile, callback) {

        if(tile.isImage) {

            const self = this;
            //{xmp: true, userComment: true, makerNote: true, ifd1: true}
            exifr.parse(tile.elem, true)
                .then(output => {
                    if(output) {
                        Logger.info('Camera:', output.Make, output.Model);
                        delete output.Category;
                        const metadata = self.extractAndProcess(output, tile);
                        tile.metadata = metadata;
                        tile.hasMetadata = true;
                        callback(tile, metadata);
                    }
                })

        } else if(tile.isAudio || tile.isVideo) {

            try {
                const mmRef = mm;
                mm.parseBlob(tile.elem).then(metadata => {
                    const rating = _.get(metadata, ['common.rating']);
                    Logger.info('MetadataParser ' + Object.keys(metadata).join(',') + ' ' + (rating || ''));

                    const duration = metadata.format.duration ? moment
                        .duration(metadata.format.duration, "seconds").format() + ' sec' : '';
                    const sampleRate = metadata.format.sampleRate
                        ? 'sample rate ' + metadata.format.sampleRate : '';
                    const bitrate = metadata.format.bitrate ?
                        'bitrate ' + Math.round(metadata.format.bitrate) : '';

                    const starRating = metadata.common.rating ? mmRef.ratingToStars(metadata.common.rating) : '';
                    metadata.common.starRating = starRating;

                    if(tile.isVideo) {

                        tile.picSummary = StringUtil.addEmptySpaces([
                            tile.picDateTaken, duration, metadata.format.container, metadata.format.codec,
                            sampleRate, bitrate], ', ');
                        metadata.format.duration = duration;

                    } else if(tile.isAudio) {
                        tile.picSummary = StringUtil.addEmptySpaces([
                            tile.picDateTaken, metadata.common.artist, metadata.common.title,
                            metadata.common.album, metadata.common.genre,
                            duration], ', ');
                    }

                    tile.metadata = metadata;
                    tile.hasMetadata = true;
                    callback(tile, metadata);
                }).catch(e => {
                    Logger.error('error parsing media metadata ' + e);
                    callback(tile, {});
                });
            } catch(e) {
                Logger.error('error parsing media metadata ' + e);
                callback(tile, {});
            }
        }
    }

    readStreaming(tile, callback) {

        const stream = tile.torrentFile.createReadStream();
        stream.on('data', (chunk) => {
            console.log(`Received ${chunk.length} bytes of data.`);
        });
        stream.on('end', () => {
            console.log('There will be no more data.');
        });

        mm.parseReadableStream(stream, {
            size: tile.torrentFile.length,
            mimeType: tile.torrentFile.name})
            .then(metadata => {
                console.log(Logger.info(metadata));
                stream.close();
            });
    }

    extractAndProcess(allMetadata, tile) {

        XmpParser.parse(allMetadata, allMetadata.xmp);
        ExifParser.parse(allMetadata);

        allMetadata['Title XMP'] = _.get(allMetadata, 'title.value');
        allMetadata['Description XMP'] = _.get(allMetadata, 'description.value');
        allMetadata['Rating XMP'] = allMetadata.Rating;

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

            //photo.picDateTaken, photo.picTitle, photo.picDesc, photo.fileName
            tileItem.picSummary = this.createSummary(allMetadata, tileItem.picDateTaken, tile.fileName);
            tileItem.cameraSettings = StringUtil.addEmptySpaces([
                allMetadata['Make'],
                allMetadata['x-Settings']]);
        }
    }

    createSummary(allMetadata, picDateTaken, name) {

        return StringUtil.addEmptySpaces([picDateTaken,
            allMetadata['Title XMP'], allMetadata['x-Description'],
            FileUtil.truncateFileName(name)], ', ');
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
                } else if(tile.isAudio || tile.isVideo) {
                    if((key === 'format' || key === 'common') && valueObj) {
                        newValueObj = valueObj;
                    } else if(key === 'native') {
                        newValueObj = Object.entries(valueObj)
                            .map(entry => entry[0] + '----->' + entry[1]
                                .map(item => item.id + ': ' + item.value));
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
        } else if(tile.isAudio || tile.isVideo) {
            //['x-file name', 'picture', 'artist', 'title', 'album', 'track', 'year', 'comment', 'format']
            ['x-file name', 'common', 'format']
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