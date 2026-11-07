import { tileFacts } from './arrangeTiles';

/**
 * One line under a photo shown full screen in photographer mode: its title
 * (else the file name), camera and exposure, for example
 * "Harbour at dusk · Fujifilm X-T5 · ƒ/2.8 · 1/250 s · ISO 400 · 35 mm".
 */
export function photoCaption(tile, master) {
    if (!tile) return '';
    const facts = tileFacts(tile, master);
    return [facts.title || tile.fileName, facts.camera, facts.exposure].filter(Boolean).join(' · ');
}
