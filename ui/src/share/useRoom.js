import { useEffect, useState } from 'react';
import Logger from 'js-logger';
import { findRoom, nameRoom, roomLabel, visitRoom } from './recentRooms';
import { markPrivate, PRIVATE_NO_KEY, roomCryptoKey, roomKeyText } from './privateRoom';
import { isSealedText, openText } from './security/roomKey';

const PRIVATE_ROOM = 'Private room';

/** A private room's name is sealed on the server; open it with the key. */
async function readName(settings) {
    const name = settings?.name || '';
    if (!isSealedText(name)) return name;
    const key = await roomCryptoKey();
    if (!key) return '';
    try {
        return await openText(key, name);
    } catch (err) {
        Logger.warn('room name: ' + err);
        return '';
    }
}

/**
 * The room this page is in: its name (set by anyone in the room, '' when
 * none), what to call it, and whether it is private and this page lacks its
 * key. Notes each visit in this browser's room list and puts the name in the
 * tab title.
 */
export default function useRoom(master, inRoom) {
    const [name, setName] = useState(() => findRoom(master.service.id)?.name || '');
    const [isPrivate, setPrivate] = useState(() => !!roomKeyText());
    const [, setVisits] = useState(0);

    useEffect(() => {
        let warned = false;
        const handleSettings = async settings => {
            markPrivate(settings?.private);
            setPrivate(!!settings?.private || !!roomKeyText());
            if (settings?.private && !roomKeyText() && !warned) {
                warned = true;
                master.emitter.emit('showError', PRIVATE_NO_KEY);
            }
            const next = await readName(settings);
            nameRoom(master.service.id, next);
            setName(next);
        };
        const handleReady = () => {
            visitRoom(master.service.id, Date.now(), roomKeyText());
            setName(findRoom(master.service.id)?.name || '');
            setVisits(count => count + 1);
        };
        master.emitter.on('roomSettings', handleSettings);
        master.emitter.on('readyToUpload', handleReady);
        return () => {
            master.emitter.removeListener('roomSettings', handleSettings);
            master.emitter.removeListener('readyToUpload', handleReady);
        };
    }, [master]);

    useEffect(() => {
        document.title = inRoom && name ? `${name} · PhotoGroup` : 'PhotoGroup';
    }, [inRoom, name]);

    const missingKey = isPrivate && !roomKeyText();
    const label = missingKey ? PRIVATE_ROOM : roomLabel({ ...findRoom(master.service.id), name });
    return { name, label, isPrivate, missingKey };
}
