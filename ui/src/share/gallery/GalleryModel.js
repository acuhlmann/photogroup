import Logger from 'js-logger';
import MetadataParser from "./MetadataParser";

export default class GalleryModel {

    constructor(torrentMaster) {
        this.torrentMaster = torrentMaster;
        this.parser = new MetadataParser();
    }

    get view() {
        return this._view;
    }
    set view(value) {
        this._view = this.parser.view = value;
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
                Logger.error(err.message);

                throw err
            } // file failed to download or display in the DOM

            Logger.info('New DOM node with the content' + elem);

            const fileSize = GalleryModel.formatBytes(file.length);
            this.view.state.tileData.push({
                img: elem,
                name: file.name,
                size: fileSize.size + fileSize.type,
                torrent: torrent
            });
            this.updateTiles();
        });
    }

    //https://stackoverflow.com/a/34166265
    static formatBytes(bytes) {
        const kb = 1024;
        const ndx = Math.floor( Math.log(bytes) / Math.log(kb) );
        const fileSizeTypes = ["bytes", "kb", "mb", "gb", "tb", "pb", "eb", "zb", "yb"];

        return {
            size: +(bytes / kb / kb).toFixed(2),
            type: fileSizeTypes[ndx]
        };
    }

    updateTiles() {
        const copy = this.view.state.tileData.slice();
        this.view.setState({tileData: copy});
    }
}