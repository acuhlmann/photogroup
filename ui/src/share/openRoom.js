import { keyForNewRoom, markPrivate, setKeyInAddress } from './privateRoom';

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
            master.emitter.emit('roomSettings', await master.service.updateRoomSettings({ private: true }));
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
    master.service.id = room;
    master.service.hasRoom = true;
    // A private room's key, before the room's photos arrive.
    setKeyInAddress(key);
    await master.findExistingContent(master.service.joinRoom);
    master.service.changeUrl('room', master.service.id);
    master.emitter.emit('hideFrontView');
    master.emitter.emit('readyToUpload');
}
