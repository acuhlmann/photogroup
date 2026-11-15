import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import { qrSymbol, drawSymbol } from './qrCodec';
import { useCodeCamera } from './cameraCodes';
import { CAMERA_ERROR } from './LightReceive';
import { readMode } from '../uiMode';

export const LINK_TITLE = 'Connect to a phone near you';
export const LINK_STEPS = {
    preparing: 'Making the code…',
    offer: 'Point the camera of one phone at the code on the other phone.',
    answer: 'Now point the camera of the other phone at this code.',
    connecting: 'Connecting…',
};
export const LINK_OTHER_PHONE = `To see the code of the other phone: open its room menu, then "${LINK_TITLE}".`;
export const LINK_HELP = 'No server is necessary. The two phones must be on the same Wi-Fi. If there is no Wi-Fi, turn on the hotspot of one phone and connect the other phone to it.';
export const LINK_STAYS = 'You can close this. The link stays open while the room is open on both phones.';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What a link does now, in one line. */
export function linkLine(link) {
    const percent = part => (part.total ? Math.floor(part.loaded / part.total * 100) : 0);
    if (link.sending) return `Sending ${link.sending.name || 'a photo'} · ${percent(link.sending)}% of ${FileUtil.formatBytes(link.sending.total)}`;
    if (link.receiving) return `Getting ${link.receiving.name || 'a photo'} · ${percent(link.receiving)}% of ${FileUtil.formatBytes(link.receiving.total)}`;
    if (!link.sent && !link.received) return 'No photo is missing on the two phones.';
    return `${plural(link.sent, 'photo')} sent · ${plural(link.received, 'photo')} received`;
}

/** The problems of a link, each as one sentence. */
export function linkNotes(link) {
    const notes = [];
    if (link.tooLarge) notes.push(`${plural(link.tooLarge, 'file')} ${link.tooLarge === 1 ? 'is' : 'are'} too large for a link.`);
    if (link.rejected) notes.push(`${plural(link.rejected, 'photo')} ${link.rejected === 1 ? 'was' : 'were'} not added.`);
    return notes;
}

const who = link => link.peer?.name || 'the other phone';

/**
 * Links this phone to another phone with two QR codes and no server. Then
 * each phone sends the room photos that the other phone does not have.
 */
export default function DirectLinkDialog({ master, open, onClose }) {
    const links = master.nearbyLinks;
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const [view, setView] = useState(() => links.snapshot());
    const [held, setHeld] = useState(() => master.nearbyNotes?.count() || 0);

    useEffect(() => {
        const onLinks = snapshot => setView(snapshot);
        const onHeld = count => setHeld(count);
        master.emitter.on('directLink', onLinks);
        master.emitter.on('heldChanges', onHeld);
        setView(links.snapshot());
        return () => {
            master.emitter.removeListener('directLink', onLinks);
            master.emitter.removeListener('heldChanges', onHeld);
        };
    }, [master, links]);

    const openLinks = view.links.filter(link => link.status === 'open' || link.status === 'starting');
    const closedLinks = view.links.filter(link => link.status === 'closed');
    const [another, setAnother] = useState(false);
    // The exchange of codes runs while no link is open, or for one more phone.
    const exchanging = open && (openLinks.length === 0 || another);
    const shake = exchanging ? view.handshake : null;

    const onBytes = useCallback(bytes => links.read(bytes), [links]);
    const { failed: cameraFailed, running } = useCodeCamera({ videoRef, active: exchanging, onBytes });

    // The code is made when the camera runs: a browser tells a page its
    // local address only then, and the other phone needs that address.
    useEffect(() => {
        if (!exchanging || !running) return undefined;
        links.begin().catch(err => Logger.warn('Starting a link failed: ' + (err?.message || err)));
        return () => links.cancel();
    }, [exchanging, running, links]);

    // A new link is open: the exchange for "one more phone" is over.
    const linkCount = openLinks.length;
    useEffect(() => { setAnother(false); }, [linkCount]);

    const code = shake?.code || null;
    useEffect(() => {
        if (!code) return undefined;
        let gone = false;
        qrSymbol(code).then((symbol) => {
            if (!gone && canvasRef.current) drawSymbol(canvasRef.current, symbol);
        }).catch(err => Logger.warn('Making a code failed: ' + (err?.message || err)));
        return () => { gone = true; };
    }, [code]);

    const step = shake?.step || 'preparing';
    // How the phones reach each other is for geek mode.
    const showPath = readMode() === 'geek';

    return (
        <Dialog open={open} onClose={onClose} fullScreen aria-labelledby="direct-link-title">
            <DialogTitle id="direct-link-title" sx={{ textAlign: 'center', px: 6, pb: 0.5 }}>{LINK_TITLE}</DialogTitle>
            <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
                <CloseRounded />
            </IconButton>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, pt: 1 }}>
                {openLinks.map(link => (
                    <Stack key={link.id} data-testid="direct-link" spacing={0.5} sx={{ alignItems: 'center', textAlign: 'center', width: '100%', maxWidth: 420 }}>
                        <Typography variant="body1" role="status" sx={{ fontWeight: 600 }}>
                            {link.status === 'open' ? `Connected to ${who(link)}.` : 'Connecting…'}
                        </Typography>
                        {(link.sending || link.receiving) && (
                            <Box sx={{ width: '100%' }}>
                                <LinearProgress
                                    variant="determinate" aria-label="Photo progress" sx={{ height: 8, borderRadius: 4 }}
                                    value={Math.floor(((link.sending || link.receiving).loaded / Math.max((link.sending || link.receiving).total, 1)) * 100)}
                                />
                            </Box>
                        )}
                        {link.status === 'open' && (
                            <Typography variant="body2" data-testid="direct-link-line" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {linkLine(link)}
                            </Typography>
                        )}
                        {linkNotes(link).map(note => (
                            <Typography key={note} variant="body2" sx={{ color: 'text.secondary' }}>{note}</Typography>
                        ))}
                        {link.path && showPath && (
                            <Typography variant="caption" data-testid="direct-link-path" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                                {link.path}
                            </Typography>
                        )}
                        <Button size="small" onClick={() => links.close(link.id)} sx={{ textTransform: 'none' }}>Disconnect</Button>
                    </Stack>
                ))}
                {!exchanging && openLinks.length > 0 && (
                    <>
                        {held > 0 && (
                            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 420 }}>
                                {`${plural(held, 'change')} of yours ${held === 1 ? 'waits' : 'wait'} for the server. The other phone has ${held === 1 ? 'it' : 'them'} now.`}
                            </Typography>
                        )}
                        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 420 }}>{LINK_STAYS}</Typography>
                        <Button variant="outlined" size="small" onClick={() => setAnother(true)} sx={{ textTransform: 'none' }}>
                            Connect one more phone
                        </Button>
                    </>
                )}
                {exchanging && (cameraFailed ? (
                    <Typography role="alert" sx={{ py: 4, textAlign: 'center' }}>{CAMERA_ERROR}</Typography>
                ) : (
                    <>
                        {closedLinks.length > 0 && openLinks.length === 0 && (
                            <Typography variant="body2" role="status" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                                {`The link to ${who(closedLinks[closedLinks.length - 1])} is closed.`}
                            </Typography>
                        )}
                        <Typography variant="body1" role="status" data-testid="link-step" data-step={step} sx={{ fontWeight: 600, textAlign: 'center', maxWidth: 420 }}>
                            {step === 'problem' ? '' : LINK_STEPS[step] || LINK_STEPS.preparing}
                        </Typography>
                        {step === 'offer' && (
                            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 420 }}>{LINK_OTHER_PHONE}</Typography>
                        )}
                        {shake?.problem && (
                            <Typography variant="body2" role="alert" sx={{ color: 'error.main', textAlign: 'center', maxWidth: 420 }}>
                                {shake.problem}
                            </Typography>
                        )}
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                            {/* White around the code: a camera needs the quiet zone. */}
                            <Box sx={{ bgcolor: '#fff', p: '3vmin', width: 'min(80vw, 38vh)', aspectRatio: '1', flexShrink: 0, borderRadius: 2, visibility: code ? 'visible' : 'hidden' }}>
                                <canvas
                                    ref={canvasRef}
                                    data-testid="link-code"
                                    data-kind={step === 'answer' ? 'answer' : 'offer'}
                                    aria-label="Code for the other phone"
                                    style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block' }}
                                />
                            </Box>
                            <Box sx={{ width: 'min(44vw, 20vh)', aspectRatio: '1', borderRadius: 2, overflow: 'hidden', bgcolor: '#000', flexShrink: 0 }}>
                                <video ref={videoRef} muted playsInline aria-label="This phone's camera" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            </Box>
                        </Stack>
                        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 420 }}>{LINK_HELP}</Typography>
                        {another && (
                            <Button size="small" onClick={() => setAnother(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
                        )}
                    </>
                ))}
            </DialogContent>
        </Dialog>
    );
}

DirectLinkDialog.propTypes = {
    master: PropTypes.object.isRequired,
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
};
