import Logger from 'js-logger';

import IdbKvStore from 'idb-kv-store';
//TODO: fails in create-create-app build
//import parsetorrent from 'parse-torrent';
import idb from 'indexeddb-chunk-store';
import TorrentAddition from "./TorrentAddition";
import TorrentDeletion from "./TorrentDeletion";
import TorrentCreator from "./TorrentCreator";

/**
 * @emits TorrentMaster#deleted
 * @type {string} magnetURI
 */
export default class TorrentMaster {

    constructor(service, emitter) {

        const scope = this;
        this.numPeers = 0;

        this.service = service;
        this.service.master = this;
        this.service.emitter.on('urls', urls => {
            scope.syncUiWithServerUrls(urls);
            //scope.urls = urls;
        });
        emitter.on('webPeers', peers => {

            if(!scope.client || !scope.client.peerId || !peers) return;

            const peerId = scope.client.peerId;
            scope.me = peers.find(peer => peer.peerId === peerId);
        });
        this.emitter = emitter;

        this.torrentsDb = new IdbKvStore('torrents');
        this.torrentAddition = new TorrentAddition(this.service, this.torrentsDb, this.emitter, this);
        this.torrentDeletion = new TorrentDeletion(this.service, this.torrentsDb, this.emitter);

        this.creator = new TorrentCreator(service, emitter, this, this.torrentAddition);
        this.creator.start();
        TorrentCreator.setupAnnounceUrls();
    }

    get client() {
        return this.creator.client;
    }

    addSeedOrGetTorrent(addOrSeed, uri, callback) {

        const torrent = this.client[addOrSeed](uri, { 'announce': window.WEBTORRENT_ANNOUNCE, 'store': idb }, callback);
        Logger.info('addSeedOrGetTorrent ' + torrent.infoHash);

        const scope = this;
        torrent.on('metadata', () => scope.torrentAddition.metadata(torrent));
        torrent.on('infoHash', hash => scope.torrentAddition.infoHash(torrent, hash));
        torrent.on('noPeers', announceType => scope.torrentAddition.noPeers(torrent, announceType));
        torrent.on('warning', err => scope.torrentAddition.warning(torrent, err));
        torrent.on('wire', (wire, addr) => scope.torrentAddition.wire(wire, addr));

        this.emitter.emit('update', torrent);

        return torrent;
    }

    findExistingContent(roomPromise) {


        const self = this;

        /*return this.resurrectLocallySavedTorrents(this.urls).then(values => {
            Logger.info('done with resurrectAllTorrents ' + values);
            //if(values) {
            //    Logger.info('done with resurrectAllTorrents ' + values);
            //}
            return roomPromise.call(self.service);
        });*/

        return roomPromise.call(this.service)
            .then(response => {

                if(!response) return;

                let foundAnyMissing;
                let msg = response.urls.length + '\n';
                response.urls.forEach(item => {
                    item.sharedBy = item.sharedBy || {};

                    if(this.fillMissingOwners(item)) {
                        foundAnyMissing = true;
                    }

                    msg += item.hash + ' '  + item.secure + ' ' + item.sharedBy.originPlatform + ' ' + item.sharedBy.ips + '\n';
                });
                Logger.info('current server sent Urls: ' + msg);

                this.hasPeer = true;

                if(!foundAnyMissing) {
                    self.emitter.emit('urls', response.urls);
                }
                return response.urls;
            })
        //TODO: make caching of local images work again, so that a refresh resurrects an image from client,
        // not reliant on other peers
            /*.then(urls => this.resurrectLocallySavedTorrents(urls))
            .then(values => {
                Logger.info('done with resurrectAllTorrents ' + values);
            });*/
    }

    fillMissingOwners(item) {
        let foundAnyMissing;
        //check for missing owners - can happen after re-connections.
        const peerId = this.client.peerId;
        const torrent = this.client.get(item.hash);
        const isOwner = torrent && torrent.files.length > 0;
        if(isOwner) {
            const found = item.owners.find(owner => owner.peerId === peerId);
            if(!found) {
                foundAnyMissing = true;
                this.service.addOwner(item.hash, peerId);
            }
        }
        return foundAnyMissing
    }

    syncUiWithServerUrls(urls) {
        const scope = this;
        Logger.debug('urls.length: '+urls.length);

        if(!this.hasPeer) {
            return;
        }

        this.client.torrents.forEach(torrent => {
            const urlItem = this.findUrl(urls, torrent.infoHash);
            if(!urlItem) {
                scope.torrentDeletion.deleteTorrent(torrent).then(infoHash => {
                    return this.emitter.emit('deleted', infoHash);
                });
            }
        });

        urls.forEach(item => {
            //const metadata = window.parsetorrent(item.url);
            const torrent = scope.client.get(item.hash);
            if(!torrent) {
                Logger.debug('new url found on server');

                scope.torrentAddition.add(item.url, item.secure, item.sharedBy ? item.sharedBy : {});
            }

            if(torrent && torrent.files && torrent.files.length < 1 && item.owners.find(owner => owner.peerId === this.client.peerId)) {
                this.service.removeOwner(item.hash, this.client.peerId)
            }
        });
    }

    findUrl(urls, hash) {
        const index = urls.findIndex(item => item.hash === hash);
        let foundItem = null;
        if(index => 0) {
            foundItem = urls[index];
        }
        return foundItem;
    }

    //more on the approach: https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
    resurrectLocallySavedTorrents(urls) {
        //Iterates through all metadata from metadata store and attempts to resurrect them!
        const scope = this;

        return new Promise((resolve, reject) => {

            const loopResolver = value => {};
            const loopPromise = new Promise(loopResolver);

            const allPendingTorrents = [loopPromise];
            scope.torrentsDb.iterator((err, cursor) => {
                if(err) {
                    reject(err);
                }
                if(cursor) {
                    if(typeof cursor.value === 'object'){
                        allPendingTorrents.push(scope.resurrectTorrent(cursor.value, urls));
                        loopResolver(true);
                    }
                    cursor.continue()
                } else {
                    resolve(allPendingTorrents);
                }
            });

            Promise.all(allPendingTorrents).then(values => {
                Logger.info('resurrectAllTorrents ' + values);
                values.shift();
                resolve(values);
            });
        });
    }

    resurrectTorrent(metadata, urls){
        const scope = this;

        return new Promise((resolve, reject) => {

            if(typeof metadata === 'object' && metadata != null) {
                if(scope.client.get(metadata.infoHash)) {

                    Logger.info('resurrectTorrent.client.get ' + metadata.name);
                    resolve(metadata);

                } else {

                    const url = urls.find(item => item.hash === metadata.infoHash);
                    scope.torrentAddition.add(metadata, false, url.sharedBy).then(torrent => {

                        Logger.info('resurrectTorrent.add ' + torrent.infoHash);
                        resolve(torrent);

                    }, error => {
                        const msg = 'error, failed to resurrect ' + JSON.stringify(arguments);
                        Logger.error(msg);
                        reject(msg);
                    });
                }

            } else {
                reject(false);
            }
        });
    }

}