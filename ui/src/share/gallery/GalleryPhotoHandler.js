import { format, parse } from 'date-fns'
import update from "immutability-helper";
import { withOpenedName } from "./openSealed";

export default class GalleryPhotoHandler {

    constructor(view, emitter) {
        this.view = view;
        this.emitter = emitter;
    }

    sortPictures(photos, formatToken) {
        if(!photos) return;
        photos.sort((a, b) => {
            const dateA = parse(a.picDateTaken, formatToken, new Date());
            const dateB = parse(b.picDateTaken, formatToken, new Date());
            return dateB - dateA;
        });
    }

    /**
     * Subscribe to photo and owner changes and update the view's tiles.
     * Snapshots retain local fields absent from server items and seeded uploads
     * not confirmed before `requestedAt` (epoch milliseconds). Updates match by
     * infoHash or stable tileKey. Incoming photo objects may be mutated.
     */
    sync() {
        const onPhotos = event => {

            const formatToken = 'H:m MMM d y';
            if(event.type === 'all') {

                this.view.setTiles(state => {
                    const photos = event.item.map(item => {
                        const existing = state.find(tile => tile.infoHash === item.infoHash);
                        if (existing && existing !== item) {
                            item = withOpenedName(existing, item);
                            // Resuming re-syncs the room and may hand us a fresh
                            // blob URL for a photo already on screen; swapping
                            // the src re-decodes the image and flashes the tile.
                            if (existing.img && item.img !== existing.img) {
                                item.img = existing.img;
                                item.elem = existing.elem || item.elem;
                                item.loading = false;
                            }
                            // The server only knows the shared fields: keep the
                            // image, file and metadata this browser already has.
                            Object.keys(existing).forEach(key => {
                                if (item[key] === undefined) {
                                    item[key] = existing[key];
                                }
                            });
                        }
                        item.tileKey = item.tileKey || existing?.tileKey || item.infoHash;
                        // Don't override loading=false for photos already served from cache
                        if (item.loading === undefined) {
                            item.loading = !item.img;
                        }
                        return item;
                    });
                    // A snapshot can predate our own upload; don't drop it.
                    const pending = state.filter(tile => tile.seed
                        && !photos.some(item => item.infoHash === tile.infoHash)
                        && (!tile.sharedAt || !event.requestedAt || tile.sharedAt >= event.requestedAt));
                    const tiles = [...pending, ...photos];
                    this.sortPictures(tiles, formatToken);
                    return tiles;
                });

            } else if(event.type === 'add') {

                this.view.setTiles(state => {
                    const oldTiles = state;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        const index = tiles.findIndex(item => item.infoHash === photo.infoHash);
                        if(index < 0) {

                            const tile = photo;
                            tile.tileKey = tile.tileKey || tile.infoHash;
                            tile.loading = true;
                            if(!tile.picDateTaken && tile.file && tile.file.lastModified) {
                                tile.picDateTaken = format(tile.file.lastModified, formatToken);
                            }
                            tiles = update(tiles, {$unshift: [tile]});
                        }
                    });
                    this.sortPictures(tiles, formatToken);
                    return tiles;
                });

            } else if(event.type === 'delete') {

                this.view.setTiles(state => {
                    const oldTiles = state;
                    const index = oldTiles.findIndex(item => item.infoHash === event.item);
                    if(index > -1) {
                        this.emitter.emit('disconnectNode', event.item);
                        const tiles = update(oldTiles, {$splice: [[index, 1]]});
                        return tiles;
                    }
                    return oldTiles;
                });

            } else if(event.type === 'update') {

                this.view.setTiles(state => {
                    const oldTiles = state;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        // An upload's infoHash changes once it is hashed; its tileKey doesn't.
                        const index = tiles.findIndex(item => item.infoHash === photo.infoHash
                            || (photo.tileKey && item.tileKey === photo.tileKey));
                        if(index > -1) {
                            const newTile = update(tiles[index], {$merge: withOpenedName(tiles[index], photo)});
                            tiles = update(tiles, {$splice: [[index, 1, newTile]]});
                        }
                    });
                    return tiles;
                });

            } else if(event.type === 'addOwner') {

                this.view.setTiles(state => {
                    const oldTiles = state;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        const index = tiles.findIndex(item => item.infoHash === photo.infoHash);
                        if(index > -1) {
                            const oldOwners = tiles[index].owners;
                            const ownersIndex = oldOwners.findIndex(item => item.peerId === photo.peerId);
                            if(ownersIndex < 0) {
                                delete photo.infoHash;
                                const owners = update(oldOwners, {$push: [photo]});
                                const tile = update(tiles[index], {owners: {$set: owners}});
                                tiles = update(tiles, {$splice: [[index, 1, tile]]});
                            }
                        }
                    });
                    return tiles;
                });

            } else if(event.type === 'removeOwner') {

                this.view.setTiles(state => {
                    const oldTiles = state;
                    let tiles = oldTiles;
                    oldTiles.forEach((oldTile, tileIndex) => {
                        const ownerIndex = oldTile.owners.findIndex(owner => owner.peerId === event.item);
                        if(ownerIndex > -1) {
                            const owners = update(oldTile.owners, {$splice: [[ownerIndex, 1]]});
                            const tile = update(tiles[tileIndex], {owners: {$set: owners}});
                            tiles = update(tiles, {$splice: [[tileIndex, 1, tile]]});
                        }
                    });
                    return tiles;
                });

            } else if(event.type === 'updateOwner') {

                this.view.setTiles(state => {
                    const oldTiles = state;
                    let tiles = oldTiles;
                    event.item.forEach(photo => {
                        const index = tiles.findIndex(item => item.infoHash === photo.infoHash);
                        if(index > -1) {
                            const oldOwners = tiles[index].owners;
                            const ownersIndex = oldOwners.findIndex(item => item.peerId === photo.peerId);
                            if(ownersIndex > -1) {
                                delete photo.infoHash;
                                const owners = update(oldOwners, {$splice: [[ownersIndex, 1, photo]]});
                                const tile = update(tiles[index], {owners: {$set: owners}});
                                tiles = update(tiles, {$splice: [[index, 1, tile]]});
                            }
                        }
                    });
                    return tiles;
                });
            }
        };
        this.emitter.on('photos', onPhotos);
        return () => this.emitter.removeListener('photos', onPhotos);
    }
}
