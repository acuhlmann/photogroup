/** Server copy limits, as server/PhotoRelay.js enforces them. */
export const MAX_PHOTO_BYTES = 100 * 1024 * 1024;
export const CHUNK_BYTES = 8 * 1024 * 1024;
// A small first chunk: the server tells the room who is uploading as soon
// as it lands, so others who have the photo don't start sending it too.
export const FIRST_CHUNK_BYTES = 512 * 1024;
