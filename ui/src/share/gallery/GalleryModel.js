import Logger from 'js-logger';
import MetadataParser from "./MetadataParser";
import Encrypter from "../security/Encrypter";
import FileUtil from "../util/FileUtil";
import update from 'immutability-helper';

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
        const self = this;
        return this.torrentMaster.torrentDeletion.deleteItem(tile.torrent).then(infoHash => {
            return self.performDeleteTile(infoHash);
        });
    }

    reload() {
        window.location.reload();
    }

    performDeleteTile(infoHash) {

        const currentTiles = this.view.state.tileData;
        const index = currentTiles.findIndex(item => item.torrent.infoHash === infoHash);
        if(index > -1 ) {
            const tiles = update(currentTiles, {$splice: [[index, 1]]});
            this.view.setState({
                tileData: tiles
            });
        }

        return infoHash;
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

    addMediaToDom(item) {

        if(item.seed) {
            this.renderTo(item, item.file);
        } else {
            item.file.getBlob((err, elem) => {
                if (err) {
                    Logger.error(err.message);

                    throw err
                }

                this.renderTo(item, elem);
            });
        }
    }

    renderTo(item, elem) {
        item.elem = elem;
        Logger.debug('New DOM node of file: ' + item.file.name);

        //const scope = this;
        this.addTile(item);
        /*//secure is undefined when content is added via local storage; hence the need to inspect if it's encrypted.
        if(item.secure === undefined) {
            Encrypter.isSecure(elem, isSecure => {
                item.secure = isSecure;
                scope.addTile(item);
            });
        } else {
            this.addTile(item);
        }*/
    }

    addTile(item) {
        const fileSize = FileUtil.formatBytes(item.file.size || item.file.length);
        const isVideo = item.elem.type.includes('video');
        const tile = item;
        tile.isVideo = isVideo;
        tile.name = item.file.name;
        tile.size = fileSize;
        tile.fileName = item.file.name;
        tile.sharedBy =  item.sharedBy || {};

        let tiles;
        const oldTiles = this.view.state.tileData;
        const index = oldTiles.findIndex(item => item.torrent.infoHash === tile.torrent.infoHash);
        if(index > -1) {
            tiles = update(oldTiles, {$splice: [[index, 1, tile]]});
        } else {
            tiles = update(oldTiles, {$push: [tile]});
        }
        this.view.setState({
            tileData: tiles
        });

        if(!item.seed) {

            this.torrentMaster.emitter.emit('torrentDone', item.torrent);
            this.torrentMaster.service.addOwner(item.torrent.infoHash, this.torrentMaster.client.peerId).then(() => {
                this.torrentMaster.emitter.emit('appEventRequest', {level: 'success', type: 'downloaded',
                    event: {file: item.torrent.name, sharedBy: item.sharedBy, downloader: this.torrentMaster.client.peerId}
                });
            });
        }
    }

    decrypt(tile, password, index) {
        const file = tile.file;
        const elem = tile.elem;
        const torrent = tile.torrent;
        const scope = this;

        Encrypter.decryptPic(elem, password, (blob) => {
            //scope.view.state.tileData.splice(index, 1);
            const tiles = update(scope.view.state.tileData, {$splice: [[index, 1]]});
            scope.view.setState({
                tileData: tiles
            });
            scope.renderTo(file, blob, torrent, false);
        });
    }
}