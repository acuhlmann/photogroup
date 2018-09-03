import Logger from 'js-logger';

import IdbKvStore from 'idb-kv-store';
//TODO: fails in create-create-app build
//import parsetorrent from 'parse-torrent';
import TorrentAddition from "./TorrentAddition";
import TorrentDeletion from "./TorrentDeletion";

/**
 * @emits TorrentMaster#deleted
 * @type {string} magnetURI
 */
export default class TorrentMaster {

    constructor(service, emitter) {

        const scope = this;
        this.numPeers = 0;

        this.service = service;
        this.service.emitter.on('urls', urls => {
            scope.syncUiWithServerUrls(urls);
        });
        this.emitter = emitter;

        const client = this.setupWebtorrentClient();

        this.torrentAddition = new TorrentAddition(this.service, client,
            this.torrentsDb, this.emitter);
        this.torrentDeletion = new TorrentDeletion(this.service, this.torrentsDb, this.emitter);

        this.findExistingContent();
    }

    setupWebtorrentClient() {

        const WebTorrent = window.WebTorrent;
        const client = this.client = new WebTorrent({
            //maxConns: 3,
            tracker: true,
            dht: true,
            webSeeds: true
        });
        const scope = this;
        client.on('error', err => {
            Logger.error('client.error '+err);
        });
        client.on('torrent', torrent => {
            Logger.info('client.torrent numPeers '+ torrent.numPeers + ' infoHash ' + torrent.infoHash);
            scope.numPeers = torrent.numPeers;
            scope.emitter.emit('update');
        });

        this.torrentsDb = new IdbKvStore('torrents');

        return client;
    }

    findExistingContent() {

        const scope = this;
        return this.resurrectLocallySavedTorrents().then(values => {
            Logger.info('done with resurrectAllTorrents ' + values);
            return scope.service.find();
        }).then(response => {

            Logger.info('current server sent Urls: ' + response);
            return scope.syncUiWithServerUrls(response);
        });
    }

    syncUiWithServerUrls(urls) {
        const scope = this;
        Logger.debug('urls.length: '+urls.length);

        this.client.torrents.forEach(torrent => {
            if(!urls.includes(torrent.magnetURI)) {
                scope.torrentDeletion.deleteTorrent(torrent).then(magnetURI => {
                    return this.emitter.emit('deleted', magnetURI);
                });
            }
        });

        urls.forEach(url => {
            const metadata = window.parsetorrent(url);
            if(!scope.client.get(metadata.infoHash)) {
                Logger.debug('new url found on server');
                scope.torrentAddition.add(url);
            }
        });
    }

    //more on the approach: https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
    resurrectLocallySavedTorrents() {
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
                        allPendingTorrents.push(scope.resurrectTorrent(cursor.value));
                        loopResolver(true);
                    }
                    cursor.continue()
                } else {
                    resolve();
                }
            });

            Promise.all(allPendingTorrents).then(values => {
                Logger.info('resurrectAllTorrents ' + values);
                values.shift();
                resolve(values);
            });
        });
    }

    resurrectTorrent(metadata){
        const scope = this;

        return new Promise((resolve, reject) => {

            if(typeof metadata === 'object' && metadata != null){
                if(scope.client.get(metadata.infoHash)) {

                    resolve(metadata);

                } else {
                    scope.torrentAddition.add(metadata).then(torrent => {

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