// Kept apart from lightBundle.js, so the room code can name a photo in
// small size without loading the camera transfer code.

/** The file name of a photo in small size: "beach.heic" becomes "beach (small).jpg". */
export function smallName(name) {
    const base = String(name || 'photo').replace(/\.[^./\\]{1,8}$/, '');
    return `${base} (small).jpg`;
}
