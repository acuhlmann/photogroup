import Logger from "js-logger";
import update from "immutability-helper";

export default class Peers {

    constructor(emitter, items) {

        this.items = items;
        emitter.on('peers', event => {

            if(event.type === 'add') {
                this.items = update(this.items, {$push: [event.item]});
            } else if(event.type === 'delete') {
                const index = this.items.findIndex(item => item.peerId === event.item);
                if(index > -1)
                    this.items = update(this.items, {$splice: [[index, 1]]});
            } else if(event.type === 'update') {
                const index = this.items.findIndex(item => item.peerId === event.item.peerId);
                if(index > -1)
                    this.items = update(this.items, {$splice: [[index, 1, event.item]]});
            }
        });
    }
}