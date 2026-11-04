import { EventEmitter } from 'events';
import IdbKvStore from 'idb-kv-store';
import Logger from 'js-logger';

/**
 * An idb-kv-store that opens its database again after the browser closes it.
 *
 * Safari on iPhone can close an IndexedDB connection by itself (seen
 * 1.3 seconds after it opened). An IdbKvStore is then dead for good: every
 * call throws "Database is closed". Opening a room read the saved torrents
 * from it, failed, and the room never added its photos, so the phone never
 * connected to anybody. This store opens a new connection on the next call
 * after a close. Emits 'open', 'close' and 'error' for each connection.
 */
export default class ReopeningKvStore extends EventEmitter {

    constructor(name, { open = storeName => new IdbKvStore(storeName) } = {}) {
        super();
        this.name = name;
        this._open = open;
        this._inner = null;
        this.opens = 0;
        this._store();
    }

    _store() {
        if (this._inner && !this._inner._closed) return this._inner;
        const inner = this._open(this.name);
        if (this.opens > 0) Logger.info(this.name + ' store: opened again after it was closed');
        this.opens++;
        this._inner = inner;
        inner.on('open', () => this.emit('open'));
        inner.on('error', err => {
            // An EventEmitter throws on an 'error' nobody listens to.
            if (this.listenerCount('error') > 0) this.emit('error', err);
            else Logger.warn(this.name + ' store error: ' + (err?.message || err));
        });
        inner.on('close', () => {
            if (this._inner === inner) this._inner = null;
            this.emit('close');
        });
        return inner;
    }

    transaction(mode, onfinish) { return this._store().transaction(mode, onfinish); }
    get(key, cb) { return this._store().get(key, cb); }
    getMultiple(keys, cb) { return this._store().getMultiple(keys, cb); }
    set(key, value, cb) { return this._store().set(key, value, cb); }
    add(key, value, cb) { return this._store().add(key, value, cb); }
    remove(key, cb) { return this._store().remove(key, cb); }
    clear(cb) { return this._store().clear(cb); }
    count(range, cb) { return this._store().count(range, cb); }
    keys(range, cb) { return this._store().keys(range, cb); }
    values(range, cb) { return this._store().values(range, cb); }
    json(range, cb) { return this._store().json(range, cb); }
    iterator(range, next) { return this._store().iterator(range, next); }

    close() {
        const inner = this._inner;
        this._inner = null;
        inner?.close();
    }
}
