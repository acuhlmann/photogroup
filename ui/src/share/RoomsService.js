import Logger from 'js-logger';

/**
 * @emits RoomsService#urlChange
 * @type {array} latest server state of magnet urls
 */
export default class RoomsService {

    constructor(emitter) {
        this.emitter = emitter;
        this.url = '/api/rooms';
        this.listenToUrlChanges();
    }

    listenToUrlChanges() {
        const scope = this;
        const source = new window.EventSource("/api/updates");
        source.addEventListener("updates", event => {
            Logger.info('sse urls: '+JSON.stringify(event));

            const data = JSON.parse(event.data);

            if(data.sseConnections) {
                scope.emitter.emit('sseConnections', data.sseConnections, data.ips);
            }

            if (data.urls) {
                scope.emitter.emit('urls', data.urls);
            }
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
                Logger.info('read ' + json);
                return json;
            });
    }

    share(magnetUri) {

        const data = {
            url: magnetUri
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
}