import Logger from 'js-logger';

/**
 * @emits RoomsService#urlChange
 * @type {array} latest server state of magnet urls
 */
export default class RoomsService {

    constructor(emitter) {
        this.emitter = emitter;
        this.url = '/api/rooms/1';
        this.listenToUrlChanges();
    }

    listenToUrlChanges() {
        const scope = this;
        const source = new window.EventSource("/api/updates");
        source.addEventListener("sseConnections", event => {

            const data = JSON.parse(event.data);
            Logger.info('sse sseConnections: '+JSON.stringify(data));

            scope.emitter.emit('sseConnections', data.sseConnections, data.ips);
        }, false);

        source.addEventListener("urls", event => {

            const data = JSON.parse(event.data);

            data.urls.forEach(item => {
                const parsed = window.parsetorrent(item.url);
                const key = parsed.infoHash;
                Logger.info('sse urls: '+key + ' ' + data.secure);
            });

            scope.emitter.emit('urls', data.urls);
        }, false);

        source.addEventListener("discoveryMessage", event => {

            const data = JSON.parse(event.data);

            Logger.warn('sse discoveryMessage: '+data);
        }, false);


        source.addEventListener('open', e => {
            Logger.info('Connection was opened');
        }, false);

        source.addEventListener('error', e => {
            Logger.error('sse error: ' + JSON.stringify(e))
            if (e.readyState === EventSource.CLOSED) {
                Logger.error('Connection was closed');
            }
        }, false);

        source.onerror = e => {
            Logger.error('sse error: ' + JSON.stringify(e));
        };
    }

    find() {

        return fetch(this.url)
            .then(response => {
                return response.json();
            })
            .then(json => {
                Logger.debug('read ' + JSON.stringify(json));
                return json;
            });
    }

    share(magnetUri, secure) {

        const data = {
            url: magnetUri,
            secure: secure
        };
        return fetch(this.url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }).then(response => {
                return response.json();
        });
    }

    delete(magnetUri) {

        const data = {
            url: magnetUri
        };
        return fetch(this.url, {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }).then(response => {
            return response.json();
        });
    }

    static deleteAll() {

        return fetch('/api/rooms', {
            method: 'DELETE',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        }).then(response => {
            return response.json();
        });
    }

    static getAll() {

        return fetch('/api/rooms', {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
        }).then(response => {
            return response.json();
        });
    }
}