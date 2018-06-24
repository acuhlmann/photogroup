import moment from 'moment';
//import piexif from 'piexifjs/piexif';

export default class GalleryModel {

    constructor(torrentMaster) {
        this.log = torrentMaster.log.bind(torrentMaster);
        this.torrentMaster = torrentMaster;
    }

    deleteTile(tile) {
        const scope = this;
        return this.torrentMaster.torrentDeletion.deleteItem(tile.torrent).then(magnetURI => {
            return scope.performDeleteTile(magnetURI);
        });
    }

    performDeleteTile(magnetURI) {
        const tiles = this.view.state.tileData;

        const found = tiles.find((tile, index) => {
            if(tile.torrent.magnetURI === magnetURI) {
                tiles.splice(index, 1);
                return true;
            }
            return false;
        });

        if(found) {
            this.updateTiles();
        }

        return found;
    }

    getTileByUri(uri) {
        const tiles = this.view.state.tileData;

        let foundAtIndex = 0;
        const found = tiles.find((tile, index) => {
            if(tile.torrent.infoHash === uri) {
                foundAtIndex = index;
                return true;
            }
            return false;
        });
        return {item: found, index: foundAtIndex};
    }

    addMediaToDom(file, torrent) {
        // Stream the file in the browser

        file.getBlobURL((err, elem) => {
            if (err) {
                this.log('error ' + err.message);
                throw err
            } // file failed to download or display in the DOM

            this.log('New DOM node with the content' + elem);

            this.view.state.tileData.push({
                img: elem,
                name: file.name,
                torrent: torrent
            });
            this.updateTiles();
        });
    }

    updateTiles() {
        const copy = this.view.state.tileData.slice();
        this.view.setState({tileData: copy});
    }

    toDataURL(src, callback) {
        let image = new Image();
        image.crossOrigin = 'Anonymous';

        image.onload = function() {
            let canvas = document.createElement('canvas');
            let context = canvas.getContext('2d');
            canvas.height = this.naturalHeight;
            canvas.width = this.naturalWidth;
            context.drawImage(this, 0, 0);
            let dataURL = canvas.toDataURL('image/jpeg');
            callback(dataURL);
        };

        image.src = src;
    }

    updateMetadata(tile, event) {

        const scope = this;

        const id = event.currentTarget.id;
        const img = document.getElementById(id);

        /*this.toDataURL(img.src, url => {
            //console.log('url '+ url);
            this.readPiexifMetadata(url);
        });*/

        const index = id.substring(3, id.length);
        const EXIF = window.EXIF;
        EXIF.enableXmp();
        EXIF.getData(img, function()  {
            const allMetadata = EXIF.getAllTags(this);

            delete allMetadata['MakerNote'];

            if(allMetadata['Make'] && allMetadata['Model']) {
                allMetadata['Camera'] = allMetadata['Make'] + ' ' + allMetadata['Model'];
                delete allMetadata['Make'];
                delete allMetadata['Model'];
            }

            const DateTimeOriginal = EXIF.getTag(this, "DateTimeOriginal");

            tile.allMetadata = allMetadata;
            scope.readMetadata(tile, index, DateTimeOriginal);
        });
    }

    readMetadata(tile, index, DateTimeOriginal) {

        const tstamp = moment(DateTimeOriginal, "YYYY:MM:DD HH:mm:ss");
        const date = tstamp.toDate();

        const tileCopy = this.view.state.tileData.slice();
        if(tileCopy[index]) {
            tileCopy[index].dateTaken = tstamp.format("HH:mm:ss MMM Do YY");
            tileCopy[index].dateTakenDate = date;

            tileCopy.sort(function(a,b){
                return new Date(b.dateTakenDate) - new Date(a.dateTakenDate);
            });
            this.view.setState({tileData: tileCopy});
        }
        //this.updateTiles();
    }

    formatDate(date) {
        const tstamp = moment(date, "YYYY:MM:DD HH:mm:ss");
        return tstamp.format("HH:mm:ss MMM Do YY");
    }

    createMetadataSummary(rawMetadata) {

        const metadata = Object.entries(rawMetadata)
            .filter(entry => entry[0] !== 'thumbnail')
            .map(entry => {

                let valueObj = entry[1], newValueObj;
                if(Array.isArray(valueObj)) {
                    newValueObj = valueObj.toString();
                } else if(typeof valueObj === 'string' || valueObj instanceof String) {
                    newValueObj = valueObj;
                } else {
                    newValueObj = JSON.stringify(valueObj);
                }

                const key = entry[0];
                if(key === 'DateTimeOriginal') {
                    newValueObj = this.formatDate(newValueObj);
                }

                const item = {key: entry[0],
                    value: newValueObj};
                return item;
            });

        ['ImageDescription', 'XPSubject',
            'DateTimeOriginal', 'Rating', 'XPKeywords', 'Camera']
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