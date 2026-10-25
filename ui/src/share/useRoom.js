import { useEffect, useState } from 'react';
import { findRoom, nameRoom, roomLabel, visitRoom } from './recentRooms';

/**
 * The room this page is in: its name (set by anyone in the room, '' when
 * none) and what to call it. Notes each visit in this browser's room list
 * and puts the name in the tab title.
 */
export default function useRoom(master, inRoom) {
    const [name, setName] = useState(() => findRoom(master.service.id)?.name || '');
    const [, setVisits] = useState(0);

    useEffect(() => {
        const handleSettings = settings => {
            const next = settings?.name || '';
            nameRoom(master.service.id, next);
            setName(next);
        };
        const handleReady = () => {
            visitRoom(master.service.id);
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

    return { name, label: roomLabel({ ...findRoom(master.service.id), name }) };
}
