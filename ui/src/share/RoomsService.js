
export default class RoomsService {
    constructor() {
        this.url = '/rooms';
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