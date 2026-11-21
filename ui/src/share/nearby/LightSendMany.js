import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import { createLightSender, lightSendId } from './lightFrames';
import { qrSymbol, drawSymbol } from './qrCodec';
import { LIGHT_LEVELS, DEFAULT_LEVEL, sendTimeText } from './lightSpeed';
import { notePairing } from './pairingLog';
import { useCodeCamera } from './cameraCodes';
import { bytesInSize, canBeSmall, decodePick, fitsBundle, makeSmall, makeThumb, packBundle, packSheet, MAX_SHEET_ITEMS, SMALL_MAX_BYTES } from './lightBundle';
import { roomTag } from './notes';
import SizeChoice from './SizeChoice';

export const SEND_MANY_TITLE = 'Send photos by camera';
export const SEND_MANY_HELP = 'On the other phone: open PhotoGroup, then "Get photos by camera". Point its camera at these codes. No network is necessary.';
export const SHEET_STEP = 'Step 1 of 2: the other phone gets a preview of each photo.';
export const SHEET_PICK = 'Then the other person picks photos and a size, and holds that phone\'s code in front of this camera.';
export const PHOTOS_STEP = 'Step 2 of 2: the photos go to the other phone.';
export const NOTHING_TO_SEND = 'No photo is on this phone in full.';
export const TOO_LARGE_TOGETHER = 'These photos are too large together to send by camera. Send fewer photos.';

const CODES_FAILED = "Couldn't make a code. Trying again…";

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const level = LIGHT_LEVELS.find(each => each.id === DEFAULT_LEVEL);
const sum = values => values.reduce((total, value) => total + value, 0);

function posterBytes(poster) {
    try {
        const binary = atob(String(poster).split(',')[1] || '');
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out.length ? out : null;
    } catch {
        return null;
    }
}

/** Shows a stream as codes, one after the other, until `stream` changes. */
function useCodes({ canvasRef, stream, emitter, what }) {
    const [problem, setProblem] = useState('');
    useEffect(() => {
        if (!stream) return undefined;
        let sender;
        try {
            sender = createLightSender(stream.details, stream.file, level.frameBytes, stream.sendId);
        } catch (err) {
            Logger.warn('Making the codes failed: ' + (err?.message || err));
            setProblem(CODES_FAILED);
            return undefined;
        }
        let stopped = false;
        let timer = null;
        setProblem('');
        notePairing(emitter, {
            channel: 'light', direction: 'out', what, bytes: stream.file.length,
            detail: `${level.frameBytes} B codes · ${level.fps}/s`,
        });
        const step = async () => {
            const due = performance.now() + 1000 / level.fps;
            try {
                const symbol = await qrSymbol(sender.next());
                if (stopped) return;
                if (canvasRef.current) drawSymbol(canvasRef.current, symbol);
            } catch (err) {
                // As in LightSend: one failed code retries, it does not
                // leave the other phone stuck at its last percent.
                Logger.warn('Making a code failed: ' + (err?.message || err));
                if (!stopped) setProblem(CODES_FAILED);
                if (!stopped) timer = setTimeout(step, 600);
                return;
            }
            setProblem(before => (before === CODES_FAILED ? '' : before));
            if (!stopped) timer = setTimeout(step, Math.max(0, due - performance.now()));
        };
        step();
        let lock = null;
        navigator.wakeLock?.request('screen').then((held) => {
            if (stopped) held.release().catch(() => {});
            else lock = held;
        }).catch(() => {});
        return () => {
            stopped = true;
            clearTimeout(timer);
            lock?.release().catch(() => {});
        };
    }, [canvasRef, stream, emitter, what]);
    return problem;
}

/**
 * Shows some photos as codes for another phone's camera. First a preview of
 * each, so the person there can pick photos and a size. Then the picked
 * photos in that size: small (the default, fast) or full. One photo goes at
 * once, in the size chosen here.
 *
 * @param {object} props
 * @param {Array<{id: string, name: string, type: string, size: number, sealed?: boolean, poster?: string,
 *   about?: object, load: () => Promise<Blob|null>}>} props.items
 * @param {string} [props.room] the id of the room that the photos are in
 */
export default function LightSendMany({ emitter, items, room, onClose }) {
    const canvasRef = useRef(null);
    const videoRef = useRef(null);
    const listed = useMemo(() => items.slice(0, MAX_SHEET_ITEMS), [items]);
    const [sheet, setSheet] = useState(null);
    const [bundle, setBundle] = useState(null);
    const [picked, setPicked] = useState(null); // indexes, or null while the sheet shows
    const [size, setSize] = useState('small');
    const [problem, setProblem] = useState('');
    const tag = room ? roomTag(room) : undefined;
    const single = listed.length === 1;

    // The sheet: each photo's preview.
    useEffect(() => {
        if (single || !listed.length) return undefined;
        let gone = false;
        (async () => {
            const thumbs = [];
            for (const item of listed) {
                let thumb = item.poster && !item.sealed ? posterBytes(item.poster) : null;
                if (!thumb && !item.sealed) thumb = await makeThumb(await item.load().catch(() => null));
                if (gone) return;
                thumbs.push(thumb);
            }
            const packed = packSheet(listed.map((item, index) => ({ ...item, thumb: thumbs[index] })), { room: tag });
            // A stable name, so a receiver that read part of this sheet
            // before carries on when the sheet is shown again.
            setSheet({ ...packed, sendId: lightSendId(packed.details, packed.file) });
        })();
        return () => { gone = true; };
    }, [listed, single, tag]);

    const choose = useCallback((indexes, inSize) => {
        const valid = [...new Set(indexes)].filter(index => listed[index]);
        if (!valid.length) return;
        if (!fitsBundle(valid.map(index => bytesInSize(listed[index], inSize === 'small')))) {
            setProblem(TOO_LARGE_TOGETHER);
            return;
        }
        setProblem('');
        setSize(inSize);
        setPicked(valid);
    }, [listed]);

    // One photo goes at once, in small size: the person here can change it.
    useEffect(() => { if (single) choose([0], 'small'); }, [single, choose]);

    // The picked photos, in the size chosen.
    useEffect(() => {
        if (!picked) return undefined;
        let gone = false;
        setBundle(null);
        (async () => {
            const parts = [];
            for (const index of picked) {
                const item = listed[index];
                const blob = await item.load().catch(() => null);
                if (gone) return;
                if (!blob) continue;
                if (size === 'small' && canBeSmall(item) && item.size > SMALL_MAX_BYTES) {
                    const small = await makeSmall(blob);
                    if (gone) return;
                    if (small) {
                        parts.push({ ...item, bytes: small, small: true });
                        continue;
                    }
                    // This browser cannot read the file: it goes as it is, when it can.
                    if (!fitsBundle([item.size])) continue;
                }
                parts.push({ ...item, bytes: new Uint8Array(await blob.arrayBuffer()) });
            }
            if (gone) return;
            if (!parts.length) {
                setProblem(NOTHING_TO_SEND);
                return;
            }
            const packed = packBundle(parts, { room: tag });
            setBundle({
                ...packed, sendId: lightSendId(packed.details, packed.file), count: parts.length,
                small: parts.some(part => part.small),
            });
        })().catch((err) => {
            Logger.warn('Getting the photos ready failed: ' + (err?.message || err));
            if (!gone) setProblem(CODES_FAILED);
        });
        return () => { gone = true; };
    }, [picked, size, listed, tag]);

    // The other phone's choice, read by this phone's front camera.
    const sheetId = sheet?.sendId;
    const onBytes = useCallback((bytes) => {
        const pick = decodePick(bytes);
        if (pick && pick.sendId === sheetId) choose(pick.indexes, pick.small ? 'small' : 'full');
    }, [sheetId, choose]);
    const watching = !!sheet && !picked;
    const { failed: cameraFailed } = useCodeCamera({ videoRef, active: watching, onBytes, facing: 'user' });

    const stream = picked ? bundle : sheet;
    const codeProblem = useCodes({ canvasRef, stream, emitter, what: picked ? (bundle?.small ? 'photos in small size' : 'photos') : 'previews' });
    const shown = problem || codeProblem;
    const allFit = fitsBundle(listed.map(item => bytesInSize(item, size === 'small')));
    const pickedItems = picked ? picked.map(index => listed[index]) : [];
    const fullFits = fitsBundle(pickedItems.map(item => item.size));

    return (
        <Dialog open onClose={onClose} fullScreen aria-labelledby="light-many-title"
            slotProps={{ paper: { sx: { bgcolor: '#fff', color: '#111' } } }}>
            <DialogTitle id="light-many-title" sx={{ textAlign: 'center', px: 6, pb: 0.5 }}>{SEND_MANY_TITLE}</DialogTitle>
            <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8, color: '#111' }}>
                <CloseRounded />
            </IconButton>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.25, pt: 1 }}>
                {!listed.length ? (
                    <Typography role="alert" sx={{ py: 4, textAlign: 'center' }}>{NOTHING_TO_SEND}</Typography>
                ) : (
                    <>
                        {!single && (
                            <Typography variant="body1" role="status" data-testid="light-many-step" data-step={picked ? 'photos' : 'sheet'} sx={{ fontWeight: 600, textAlign: 'center' }}>
                                {picked ? PHOTOS_STEP : SHEET_STEP}
                            </Typography>
                        )}
                        {/* White around the code: a camera needs the quiet zone. */}
                        <Box sx={{ bgcolor: '#fff', p: '4vmin', width: 'min(96vw, 60vh)', aspectRatio: '1', flexShrink: 0, visibility: stream ? 'visible' : 'hidden' }}>
                            <canvas
                                ref={canvasRef}
                                data-testid="light-code"
                                data-kind={picked ? 'photos' : 'sheet'}
                                aria-label="Codes that carry the photos"
                                style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }}
                            />
                        </Box>
                        {shown && <Typography role="alert" variant="body2" sx={{ color: '#b00020', textAlign: 'center' }}>{shown}</Typography>}
                        <Typography variant="body2" role="status" sx={{ fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                            {!stream && !shown && 'Getting the photos ready…'}
                            {stream && !picked && `${plural(listed.length, 'preview')} · ${sendTimeText(stream.file.length, level)}`}
                            {/* The bytes and the time are on the size choice below. */}
                            {stream && picked && `${plural(bundle.count, 'photo')} in ${bundle.small ? 'small' : 'full'} size`}
                        </Typography>
                        {picked && (
                            <SizeChoice
                                light level={level} value={pickedItems.some(canBeSmall) ? size : 'full'}
                                // What is on screen now is known exactly; the other size is about.
                                smallUpTo={!(bundle && size === 'small')}
                                smallBytes={bundle && size === 'small' ? bundle.file.length : sum(pickedItems.map(item => bytesInSize(item, true)))}
                                fullBytes={bundle && size === 'full' ? bundle.file.length : sum(pickedItems.map(item => item.size))}
                                onlyFull={!pickedItems.some(canBeSmall)}
                                onlySmall={!fullFits}
                                onChange={next => choose(picked, next)}
                            />
                        )}
                        {!picked && !single && (
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                                {!cameraFailed && (
                                    <Box sx={{ width: 96, height: 96, borderRadius: 2, overflow: 'hidden', bgcolor: '#000', flexShrink: 0 }}>
                                        <video ref={videoRef} muted playsInline aria-label="This phone's camera" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                    </Box>
                                )}
                                <Stack spacing={0.75} sx={{ alignItems: 'flex-start', maxWidth: 260 }}>
                                    <Typography variant="body2" sx={{ color: '#444' }}>{SHEET_PICK}</Typography>
                                    {allFit && (
                                        <Button size="small" variant="outlined" onClick={() => choose(listed.map((item, index) => index), size)} sx={{ textTransform: 'none', color: '#111', borderColor: '#888' }}>
                                            {`Send all ${listed.length} photos`}
                                        </Button>
                                    )}
                                </Stack>
                            </Stack>
                        )}
                        {picked && !single && (
                            <Button size="small" onClick={() => { setPicked(null); setProblem(''); }} sx={{ textTransform: 'none', color: '#111' }}>
                                Show the previews again
                            </Button>
                        )}
                        <Typography variant="body2" sx={{ color: '#444', textAlign: 'center', maxWidth: 420 }}>{SEND_MANY_HELP}</Typography>
                        {items.length > listed.length && (
                            <Typography variant="caption" sx={{ color: '#555', textAlign: 'center' }}>
                                {`Only the first ${listed.length} photos are shown.`}
                            </Typography>
                        )}
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

LightSendMany.propTypes = {
    emitter: PropTypes.object,
    items: PropTypes.array.isRequired,
    room: PropTypes.string,
    onClose: PropTypes.func.isRequired,
};

/**
 * The files that a person picked on the front page, as photos to send. A
 * file too large to go in full can still go in small size.
 */
export function itemsOfFiles(files) {
    return [...files].filter(file => fitsBundle([file.size]) || canBeSmall({ type: file.type })).map((file, index) => ({
        id: `file-${index}-${file.size}`, name: file.name || 'photo', type: file.type || '', size: file.size,
        load: async () => file,
    }));
}

/** The photos of the open room that are on this phone in full. */
export function RoomLightSend({ master, onClose }) {
    const [items, setItems] = useState(null);

    useEffect(() => {
        let gone = false;
        (async () => {
            const ids = await master.heldPhotoIds();
            const found = [];
            for (const id of ids) {
                const photo = master.roomPhotos.get(id);
                const blob = await master.findPhotoBytes(id).catch(() => null);
                if (!photo || !blob) continue;
                if (!fitsBundle([blob.size]) && !canBeSmall({ type: photo.fileType || blob.type, sealed: !!photo.secure })) continue;
                const about = master.offlineRoom?.describe(id) || null;
                found.push({
                    id, name: photo.fileName || 'photo', type: photo.fileType || '', size: blob.size, sealed: !!photo.secure,
                    poster: about?.poster,
                    // The small picture goes on the sheet, not again with each photo.
                    about: about ? { ...about, poster: undefined } : undefined,
                    load: async () => new Blob([blob], { type: photo.fileType || blob.type || '' }),
                });
            }
            if (!gone) setItems(found);
        })().catch((err) => {
            Logger.warn('Reading the photos for the camera transfer failed: ' + (err?.message || err));
            if (!gone) setItems([]);
        });
        return () => { gone = true; };
    }, [master]);

    if (!items) return null;
    return <LightSendMany emitter={master.emitter} items={items} room={master.service.id} onClose={onClose} />;
}

RoomLightSend.propTypes = {
    master: PropTypes.object.isRequired,
    onClose: PropTypes.func.isRequired,
};
