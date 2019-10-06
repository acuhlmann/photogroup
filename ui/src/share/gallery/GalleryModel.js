import Logger from 'js-logger';
import MetadataParser from "./MetadataParser";
import Encrypter from "../security/Encrypter";
import FileUtil from "../util/FileUtil";

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
        return this.torrentMaster.torrentDeletion.deleteItem(tile.torrent).then(infoHash => {
            return scope.performDeleteTile(infoHash);
        });
    }

    performDeleteTile(infoHash) {
        const tiles = this.view.state.tileData;

        const found = tiles.find((tile, index) => {
            if(tile.torrent.infoHash === infoHash) {
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

    addMediaToDom(file, torrent, secure, seed, sharedBy) {

        if(seed) {
            this.renderTo(file, file, torrent, secure, sharedBy, seed);
        } else {
            file.getBlob((err, elem) => {
                if (err) {
                    Logger.error(err.message);

                    throw err
                }

                this.renderTo(file, elem, torrent, secure, sharedBy, seed);
            });
        }
    }

    renderTo(file, elem, torrent, secure, sharedBy, seed) {
        Logger.debug('New DOM node of file: ' + file.name);

        const scope = this;
        //secure is undefined when content is added via local storage; hence the need to inspect if it's encrypted.
        if(secure === undefined) {
            Encrypter.isSecure(elem, isSecure => {
                secure = isSecure;
                scope.addTile(file, elem, torrent, secure, sharedBy, seed);
            });
        } else {
            this.addTile(file, elem, torrent, secure, sharedBy, seed);
        }
    }

    addTile(file, elem, torrent, secure, sharedBy, seed) {
        const fileSize = FileUtil.formatBytes(file.size || file.length);
        this.view.state.tileData.push({
            elem: elem,
            img: window.URL.createObjectURL(elem),
            name: file.name,
            file: file,
            size: fileSize.size + fileSize.type,
            torrent: torrent,
            secure: secure,
            sharedBy: sharedBy || {}
        });
        this.updateTiles();

        if(!seed) {

            this.torrentMaster.emitter.emit('appEventRequest', {level: 'success', type: 'downloaded',
                event: {file: torrent.name, sharedBy: sharedBy, downloader: this.torrentMaster.client.peerId}
            });
            this.torrentMaster.emitter.emit('torrentDone', torrent);

            this.torrentMaster.service.addOwner(torrent.infoHash, this.torrentMaster.client.peerId);
        }
    }

    decrypt(tile, password, index) {
        const file = tile.file;
        const elem = tile.elem;
        const torrent = tile.torrent;
        const scope = this;

        Encrypter.decryptPic(elem, password, (blob) => {
            scope.view.state.tileData.splice(index, 1);
            scope.renderTo(file, blob, torrent, false);
        });
    }

    updateTiles() {
        const copy = this.view.state.tileData.slice();
        this.view.setState({tileData: copy});
    }
}