/** Server copy limits, as server/PhotoRelay.js enforces them. */
export const MAX_PHOTO_BYTES = 100 * 1024 * 1024;
export const MAX_PHOTO_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));

/** What people are told about clips and the server backup, wherever they add files. */
export const CLIP_SIZE_NOTE = `Clips of any size. Up to ${MAX_PHOTO_MB} MB also get a backup on the server; `
    + 'bigger ones go straight from phone to phone.';
export const CHUNK_BYTES = 8 * 1024 * 1024;
// A small first chunk: the server tells the room who is uploading as soon
// as it lands, so others who have the photo don't start sending it too.
export const FIRST_CHUNK_BYTES = 512 * 1024;
// An uploader that has sent nothing for this long has likely frozen (its
// phone went to sleep); someone else who has the photo may carry on.
export const UPLOAD_LEASE_MS = 60 * 1000;
