import { keyForNewRoom, markPrivate, roomKeyText, setKeyInAddress } from './privateRoom';

/**
 * Create a room, put it in the address bar, and tell the page it is ready
 * for photos. With "Private room" on, the room gets a key in the address.
 */
export async function createRoom(master) {
    master.emitter.emit('openRoomStart');

    try {
        const key = keyForNewRoom();
        await master.findExistingContent(master.service.createRoom, true);
        master.service.changeUrl('room', master.service.id);
        // Also drops a key left over from another room.
        setKeyInAddress(key);
        if (key) {
            markPrivate(true);
            const makePrivate = async () => master.emitter.emit('roomSettings', await master.service.updateRoomSettings({ private: true }));
            // With no server, the room is private on this phone now. The
            // server learns it when it answers (see nearby/offlineRoom.js).
            if (!master.offlineRoom?.away) await makePrivate();
        }

        master.emitter.emit('openRoomEnd');
        master.emitter.emit('readyToUpload');
    } catch (error) {
        console.error('Failed to create room:', error);
        master.emitter.emit('roomCreationError', error);
        master.emitter.emit('openRoomEnd');

        if (error.message && error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            master.emitter.emit('showError', 'Cannot connect to the server. Make sure the backend server runs on port 8081.');
        } else {
            master.emitter.emit('showError', `Failed to create room: ${error.message || 'Unknown error'}`);
        }
    }
}

/**
 * Join the room of a code this phone got from another phone: scanned,
 * heard, or tapped.
 */
export async function joinRoomByCode(master, { room, key = null }) {
    const before = { id: master.service.id, hasRoom: master.service.hasRoom, key: roomKeyText() };
    master.service.id = room;
    master.service.hasRoom = true;
    // A private room's key, before the room's photos arrive.
    setKeyInAddress(key);
    await master.findExistingContent(async function joinOrGoBack() {
        try {
            return await master.service.joinRoom.call(this);
        } catch (err) {
            // No such room, or no connection: this page is still where it was.
            master.service.id = before.id;
            master.service.hasRoom = before.hasRoom;
            setKeyInAddress(before.key);
            throw err;
        }
    });
    master.service.changeUrl('room', master.service.id);
    master.emitter.emit('hideFrontView');
    master.emitter.emit('readyToUpload');
}
