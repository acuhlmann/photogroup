import RoomsService from "./RoomsService";
import GalleryModel from "./GalleryModel";

import IdbKvStore from 'idb-kv-store';
//TODO: fails in create-create-app build
//import parsetorrent from 'parse-torrent';
import EventEmitter from 'eventemitter3';
import TorrentAddition from "./TorrentAddition";
import TorrentDeletion from "./TorrentDeletion";

export default class TorrentMaster {

    constructor() {
        this.emitter = new EventEmitter();
        this.service = new RoomsService();

        this.gallery = new GalleryModel(this.log.bind(this), this);

        const WebTorrent = window.WebTorrent;
        this.client = new WebTorrent({
            tracker: true,
            dht: true,
            webSeeds: true
        });
        this.torrentsDb = new IdbKvStore('torrents');
        this.torrentAddition = new TorrentAddition(this.service, this.client, this.torrentsDb,
            this.gallery, this.emitter);

        this.torrentDeletion = new TorrentDeletion(this.service, this.torrentsDb, this.emitter);

        const scope = this;
        this.client.on('error', err => {
            scope.log('client.error '+err)
        });
        this.client.on('torrent', torrent => {
            scope.log('client.torrent '+torrent.infoHash)
        });

        this.findExistingContent();
    }

    log(message) {
        this.emitter.emit('log', message);
    }

    findExistingContent() {
        const scope = this;
        const source = new window.EventSource("/roomstream");
        source.addEventListener("urls", event => {
            scope.log('sse: '+JSON.stringify(event));

            const data = JSON.parse(event.data);
            scope.syncWithServerUrls(data.urls);
        }, false);

        source.addEventListener('open', e => {
            scope.log("Connection was opened")
        }, false);

        source.addEventListener('error', e => {
            scope.log('sse error: ' + JSON.stringify(e))
            if (e.readyState === EventSource.CLOSED) {
                scope.log("Connection was closed")
            }
        }, false);

        source.onerror = e => {
            scope.log('sse error: ' + JSON.stringify(e))
        };

        return this.resurrectAllTorrents().then(values => {
            scope.log('done with resurrectAllTorrents ' + values);
            return scope.service.find();
        }).then(response => {

            scope.log('current server sent Urls: ' + response);
            return scope.syncWithServerUrls(response);
        });
    }

    syncWithServerUrls(urls) {
        const scope = this;
        this.log('urls.length: '+urls.length);

        this.client.torrents.forEach(torrent => {
            if(!urls.includes(torrent.magnetURI)) {
                scope.torrentDeletion.deleteTorrent(torrent).then(magnetURI => {
                    return scope.gallery.performDeleteTile(magnetURI);
                });
            }
        });

        urls.forEach(url => {
            const metadata = window.parsetorrent(url);
            if(!scope.client.get(metadata.infoHash)) {
                scope.log('found url');
                scope.add(url);
            }
        });
    }

    add(torrentId) {
        return this.torrentAddition.add(torrentId);
    }

    seed(files) {
        return this.torrentAddition.seed(files);
    }

    //more on the approach: https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
    resurrectAllTorrents() {
        //Iterates through all metadata from metadata store and attempts to resurrect them!
        const scope = this;

        return new Promise((resolve, reject) => {

            const loopResolver = new Function();
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
                scope.log('resurrectAllTorrents ' + values);
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
                    scope.add(metadata).then(torrent => {

                        resolve(torrent);

                    }, error => {
                        const msg = 'error, failed to resurrect ' + JSON.stringify(arguments);
                        scope.log(msg);
                        reject(msg);
                    });
                }

            } else {
                reject(false);
            }
        });
    }

}