/**
 * @emits RoomsService#urlChange
 * @type {array} latest server state of magnet urls
 */
export default class RoomsService {

    constructor(emitter) {
        this.emitter = emitter;
        this.url = '/rooms';
        this.listenToUrlChanges();
    }

    log(message) {
        this.emitter.emit('log', message);
    }

    listenToUrlChanges() {
        const scope = this;
        const source = new window.EventSource("/roomstream");
        source.addEventListener("urls", event => {
            scope.log('sse: '+JSON.stringify(event));

            const data = JSON.parse(event.data);
            scope.emitter.emit('urls', data.urls);
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
    }

    find() {
        return fetch(this.url)
            .then(response => {
                return response.json();
            })
            .then(json => {
                console.log('read ' + json);
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