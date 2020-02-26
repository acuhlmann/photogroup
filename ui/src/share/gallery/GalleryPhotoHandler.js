import moment from "moment";
import update from "immutability-helper";

export default class GalleryPhotoHandler {

    constructor(view, emitter) {
        this.view = view;
        this.emitter = emitter;
    }

    sortPictures(photos, format) {
        if(!photos) return;
        photos.sort((a, b) => {
            const dateA = moment(a.picDateTaken, format).toDate();
            const dateB = moment(b.picDateTaken, format).toDate();
            return dateB - dateA;
        });
    }

    sync() {
        this.emitter.on('photos', event => {

            const format = 'HH:mm:ss MMM Do YY';
            if(event.type === 'all') {

                this.view.setState(() => {
                    const photos = event.item;
                    photos.forEach(item => {
                        item.loading = true;
                    });
                    this.sortPictures(photos, format);
                    return {tiles: photos};
                });

            } else if(event.type === 'add') {

                this.view.setState(state => {

                    const oldTiles = state.tiles;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        const index = oldTiles.findIndex(item => item.infoHash === photo.infoHash);
                        if(index < 0) {

                            const tile = photo;
                            tile.loading = true;
                            if(!tile.picDateTaken && tile.file && tile.file.lastModified) {
                                tile.picDateTaken = moment(tile.file.lastModified).format(format);
                            }
                            tiles = update(oldTiles, {$unshift: [tile]});
                        }
                    });
                    this.sortPictures(tiles, format);
                    return {tiles: tiles};
                });

            } else if(event.type === 'delete') {

                this.view.setState(state => {
                    const oldTiles = state.tiles;
                    const index = oldTiles.findIndex(item => item.infoHash === event.item);
                    if(index > -1) {
                        this.emitter.emit('disconnectNode', event.item);
                        const tiles = update(oldTiles, {$splice: [[index, 1]]});
                        return {tiles: tiles};
                    }
                });

            } else if(event.type === 'update') {

                this.view.setState(state => {
                    const oldTiles = state.tiles;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        const index = oldTiles.findIndex(item => item.infoHash === photo.infoHash);
                        if(index > -1) {
                            const newTile = update(oldTiles[index], {$merge: photo});
                            tiles = update(oldTiles, {$splice: [[index, 1, newTile]]});
                        }
                    });
                    return {tiles: tiles};
                });

            } else if(event.type === 'addOwner') {

                this.view.setState(state => {
                    const oldTiles = state.tiles;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        const index = oldTiles.findIndex(item => item.infoHash === photo.infoHash);
                        if(index > -1) {
                            const oldOwners = oldTiles[index].owners;
                            const ownersIndex = oldOwners.findIndex(item => item.peerId === photo.peerId);
                            if(ownersIndex < 0) {
                                delete photo.infoHash;
                                const owners = update(oldOwners, {$push: [photo]});
                                const tile = update(oldTiles[index], {owners: {$set: owners}});
                                tiles = update(oldTiles, {$splice: [[index, 1, tile]]});
                            }
                        }
                    });
                    return {tiles: tiles};
                });

            } else if(event.type === 'removeOwner') {

                this.view.setState(state => {
                    const oldTiles = state.tiles;
                    let tiles = oldTiles;
                    oldTiles.forEach((oldTile, tileIndex) => {
                        const ownerIndex = oldTile.owners.findIndex(owner => owner.peerId === event.item);
                        if(ownerIndex > -1) {
                            const owners = update(oldTile.owners, {$splice: [[ownerIndex, 1]]});
                            const tile = update(oldTiles[tileIndex], {owners: {$set: owners}});
                            tiles = update(oldTiles, {$splice: [[tileIndex, 1, tile]]});
                        }
                    });
                    return {tiles: tiles};
                });

            } else if(event.type === 'updateOwner') {

                this.view.setState(state => {
                    const oldTiles = state.tiles;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        const index = oldTiles.findIndex(item => item.infoHash === photo.infoHash);
                        if(index > -1) {
                            const oldOwners = oldTiles[index].owners;
                            const ownersIndex = oldOwners.findIndex(item => item.peerId === photo.peerId);
                            if(ownersIndex > -1) {
                                delete photo.infoHash;
                                const owners = update(oldOwners, {$splice: [[ownersIndex, 1, photo]]});
                                const tile = update(oldTiles[index], {owners: {$set: owners}});
                                tiles = update(oldTiles, {$splice: [[index, 1, tile]]});
                            }
                        }
                    });
                    return {tiles: tiles};
                });
            }
        });
    }
}