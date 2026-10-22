/** Server copy limits, as server/PhotoRelay.js enforces them. */
export const MAX_PHOTO_BYTES = 100 * 1024 * 1024;
export const CHUNK_BYTES = 8 * 1024 * 1024;
// A small first chunk: the server tells the room who is uploading as soon
// as it lands, so others who have the photo don't start sending it too.
export const FIRST_CHUNK_BYTES = 512 * 1024;
// An uploader that has sent nothing for this long has likely frozen (its
// phone went to sleep); someone else who has the photo may carry on.
export const UPLOAD_LEASE_MS = 60 * 1000;
