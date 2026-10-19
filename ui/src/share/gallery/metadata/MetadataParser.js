import {format, parse, getTime, toDate} from 'date-fns';
import XmpParser from "./XmpParser";
import ExifParser from "./ExifParser";
import * as exifr from 'exifr';
import FileUtil from "../../util/FileUtil";
import Logger from 'js-logger';
import * as mm from 'music-metadata';
import StringUtil from "../../util/StringUtil";
import _ from 'lodash';
import humanizeDuration from 'humanize-duration';

/** One torrent/file metadata parse per item — avoids competing read streams with playback. */
const mediaMetadataInflight = new Map();

function mediaMetadataKey(tile) {
    return tile.infoHash || tile.fileName || 'unknown';
}

export default class MetadataParser {

    constructor(master) {
        this.master = master;
    }

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
                    } else {
                        // No metadata found, but still call callback to complete rendering
                        tile.hasMetadata = false;
                        callback(tile, {});
                    }
                })
                .catch(e => {
                    Logger.error('error parsing image metadata ' + e);
                    // Always call callback even on error to complete rendering
                    tile.hasMetadata = false;
                    callback(tile, {});
                })

        } else if(tile.isAudio || tile.isVideo) {
            if (tile.hasMetadata && tile.metadata) {
                callback(tile, tile.metadata);
                return;
            }

            const key = mediaMetadataKey(tile);
            const isLeader = !mediaMetadataInflight.has(key);
            let pending = mediaMetadataInflight.get(key);
            if (!pending) {
                pending = this.parseMediaMetadata(tile)
                    .finally(() => mediaMetadataInflight.delete(key));
                mediaMetadataInflight.set(key, pending);
            }

            pending
                .then(metadata => this.applyMediaMetadataResult(tile, metadata, isLeader))
                .then(metadata => callback(tile, metadata || {}))
                .catch(e => {
                    Logger.error('error parsing media metadata ' + e);
                    callback(tile, {});
                });
        }
    }

    applyMediaMetadataResult(tile, metadata, emitGalleryUpdate) {
        if (metadata) {
            this.applyMediaMetadata(tile, metadata);
            tile.metadata = metadata;
            tile.hasMetadata = true;
            if (emitGalleryUpdate) {
                this.master.emitter.emit('photos', {type: 'update', item: [tile]});
            }
            return metadata;
        }
        return null;
    }

    applyMediaMetadata(tile, metadata) {
        const mmRef = mm;
        const rating = _.get(metadata, ['common.rating']);
        Logger.info('MetadataParser ' + Object.keys(metadata).join(',') + ' ' + (rating || ''));

        const duration = metadata.format.duration
            ? humanizeDuration(metadata.format.duration * 1000, { round: true })
            : '';
        const sampleRate = metadata.format.sampleRate
            ? 'sample rate ' + metadata.format.sampleRate : '';
        const bitrate = metadata.format.bitrate ?
            'bitrate ' + Math.round(metadata.format.bitrate) : '';

        // common.rating is a list of {source, rating 0..1}
        const rawRating = metadata.common.rating?.[0]?.rating;
        const starRating = rawRating != null ? mmRef.ratingToStars(rawRating) : '';
        metadata.common.starRating = starRating;

        if (tile.isVideo) {
            tile.picSummary = StringUtil.addEmptySpaces([
                tile.picDateTaken, duration, metadata.format.container, metadata.format.codec,
                sampleRate, bitrate], ', ');
            metadata.format.duration = duration;
        } else if (tile.isAudio) {
            tile.picSummary = StringUtil.addEmptySpaces([
                tile.picDateTaken, metadata.common.artist, metadata.common.title,
                metadata.common.album, metadata.common.genre,
                duration], ', ');
        }
    }

    /**
     * Parse audio/video metadata from a stream when possible so we never buffer
     * an entire multi-hundred-MB file on the main thread.
     */
    parseMediaMetadata(tile) {
        const mimeType = tile.fileType || tile.elem?.type || tile.file?.type;
        const size = tile.torrentFile?.length ?? tile.file?.size ?? tile.elem?.size;
        const parseOptions = {
            size,
            mimeType: mimeType || tile.torrentFile?.name || tile.fileName,
        };

        const localFile = tile.file || tile.elem;
        if (localFile && typeof localFile.stream === 'function') {
            return mm.parseWebStream(localFile.stream(), {
                size: localFile.size,
                mimeType: mimeType || localFile.name
            });
        }

        if (tile.torrentFile && typeof tile.torrentFile.createReadStream === 'function') {
            const stream = tile.torrentFile.createReadStream();
            return mm.parseWebStream(stream, parseOptions).finally(() => {
                if (typeof stream.destroy === 'function') {
                    stream.destroy();
                }
            });
        }

        if (tile.elem) {
            return mm.parseBlob(tile.elem);
        }

        return Promise.resolve(null);
    }

    readStreaming(tile, callback) {

        const stream = tile.torrentFile.createReadStream();
        stream.on('data', (chunk) => {
            console.log(`Received ${chunk.length} bytes of data.`);
        });
        stream.on('end', () => {
            console.log('There will be no more data.');
        });

        mm.parseWebStream(stream, {
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

        // exifr parses XMP/IPTC itself: dc:title/description arrive as
        // {lang, value}, dc:subject/creator as a string or array.
        const text = value => (value && typeof value === 'object' && !Array.isArray(value) ? value.value : value);
        const list = value => (Array.isArray(value) ? value.map(text).join(', ') : text(value));
        allMetadata['Title XMP'] = text(allMetadata.title) || allMetadata.ObjectName || allMetadata.Headline
            || allMetadata.XPTitle || allMetadata['Title XMP'];
        allMetadata['Description XMP'] = text(allMetadata.description) || allMetadata.Caption
            || allMetadata.XPComment || allMetadata['Description XMP'];
        allMetadata['Rating XMP'] = allMetadata.Rating ?? allMetadata['Rating XMP'];
        allMetadata['Keywords XMP'] = list(allMetadata.subject) || list(allMetadata.Keywords)
            || allMetadata.XPKeywords || allMetadata['Keywords XMP'];
        allMetadata['Label XMP'] = allMetadata.Label;
        allMetadata['Creator XMP'] = list(allMetadata.creator) || allMetadata.Artist || allMetadata.Byline;
        allMetadata['x-CreatorTool'] = allMetadata.CreatorTool || allMetadata['x-CreatorTool'];
        ['title', 'description', 'Rating', 'subject', 'Keywords', 'XPKeywords', 'Label', 'creator',
            'Artist', 'Byline', 'CreatorTool', 'ObjectName', 'Headline', 'XPTitle', 'Caption', 'XPComment', 'xmp']
            .forEach(key => delete allMetadata[key]);

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

        if(tileItem) {        const DateTimeOriginal = allMetadata['DateTimeOriginal'];
            if(DateTimeOriginal) {
                const timestamp = MetadataParser.toTimeStamp(DateTimeOriginal);
                const picDateTaken = MetadataParser.formatDateFromTimeStamp(timestamp);
                tileItem.picDateTaken = picDateTaken === 'Invalid date' ? '' : picDateTaken;
                tileItem.picDateTakenDate = toDate(timestamp);
            }

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
        return getTime(date);
        //return parse(date, "yyyy:MM:dd HH:mm:ss", new Date());
    }

    static toDate(date) {
        return MetadataParser.toTimeStamp(date).toDate();
    }

    static formatDate(date) {
        return MetadataParser.formatDateFromTimeStamp(MetadataParser.toTimeStamp(date));
    }

    static formatDateFromTimeStamp(date) {
        return format(date, "H:m MMM d y");
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
                    } else if(valueObj instanceof Date) {
                        newValueObj = isNaN(valueObj) ? '' : format(valueObj, 'MMM d, yyyy HH:mm');
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
            ['x-file name', 'Title XMP', 'Rating XMP', 'x-Description', 'Label XMP', 'Keywords XMP',
                'DateTimeOriginal', 'Creator XMP', 'x-Location', 'x-Camera', 'LensModel', 'x-Settings',
                'x-Pixel Size', 'GPSAltitude',
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