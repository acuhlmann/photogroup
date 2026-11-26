import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Logger from 'js-logger';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import FeedbackOutlined from '@mui/icons-material/FeedbackOutlined';

import { readMode } from '../uiMode';
import { buildReport, MAX_NOTE } from './buildReport';
import { sendReport, saveReport } from './sendReport';

// "Send a problem report", the same in every mode: in a room it is in the
// room menu, before a room it is a link at the end of the front page.

export const REPORT_TITLE = 'Send a problem report';
export const NOTE_LABEL = 'What went wrong?';
const NOTE_EXAMPLE = 'For example: My friend does not get my photos.';
const HOLDS = 'The report holds the app log and facts about this device.';
const HOLDS_ROOM = 'It also holds the names and IP addresses of the devices in this room.';
const HOLDS_PRIVATE_ROOM = 'It also holds the IP addresses of the devices in this room.';
const KEPT = 'It holds no photos. The server keeps it for 30 days.';
export const PRIVATE_NOTE = 'This room is private. The report does not include the names of photos, people or the room.';

/** What goes to the server, in short sentences. */
export function reportHoldsText({ inRoom = false, isPrivate = false } = {}) {
    return [HOLDS, inRoom && (isPrivate ? HOLDS_PRIVATE_ROOM : HOLDS_ROOM), KEPT, inRoom && isPrivate && PRIVATE_NOTE].filter(Boolean).join(' ');
}

export function sentText(id) {
    return `The report is sent. Its number is ${id}.`;
}

export default function ProblemReport({ master, open, onClose, inRoom = false, isPrivate = false, roomName = '' }) {
    const [note, setNote] = useState('');
    const [phase, setPhase] = useState('edit'); // edit | sending | sent
    const [sentId, setSentId] = useState('');
    const [error, setError] = useState('');
    const [savedAs, setSavedAs] = useState('');

    const report = () => buildReport({ master, note, mode: readMode(), inRoom, isPrivate, roomName });

    const reset = () => {
        setNote('');
        setPhase('edit');
        setSentId('');
        setError('');
        setSavedAs('');
    };

    const send = async (event) => {
        event.preventDefault();
        setPhase('sending');
        setError('');
        try {
            const { id } = await sendReport(report());
            Logger.info('problem report sent: ' + id);
            setSentId(id);
            setPhase('sent');
        } catch (err) {
            Logger.warn('problem report: ' + (err?.cause?.message || err?.message || err));
            setError(err?.message || String(err));
            setPhase('edit');
        }
    };

    const save = () => {
        try {
            setSavedAs(saveReport(report()));
        } catch (err) {
            Logger.warn('problem report file: ' + err);
            setError('Could not save the file.');
        }
    };

    const sending = phase === 'sending';

    return (
        <Dialog open={open} onClose={sending ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="problem-report-title"
            slotProps={{ transition: { onEnter: reset } }}>
            <form onSubmit={send}>
                <DialogTitle id="problem-report-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <FeedbackOutlined fontSize="small" aria-hidden="true" />
                    {REPORT_TITLE}
                </DialogTitle>
                <DialogContent>
                    {phase === 'sent' ? (
                        <Box role="status">
                            <Typography variant="body1" sx={{ mb: 1 }}>{sentText(sentId)}</Typography>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                Thank you. Give this number when you talk about the problem.
                            </Typography>
                        </Box>
                    ) : (
                        <>
                            <TextField
                                autoFocus
                                fullWidth
                                multiline
                                minRows={3}
                                margin="dense"
                                label={NOTE_LABEL}
                                placeholder={NOTE_EXAMPLE}
                                value={note}
                                onChange={event => setNote(event.target.value)}
                                slotProps={{ htmlInput: { maxLength: MAX_NOTE } }}
                                disabled={sending}
                            />
                            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                                {reportHoldsText({ inRoom, isPrivate })}
                            </Typography>
                            {error && <Alert severity="warning" sx={{ mt: 1.5 }}>{error}</Alert>}
                            {savedAs && (
                                <Typography variant="body2" role="status" sx={{ mt: 1.5 }}>
                                    Saved as {savedAs}.
                                </Typography>
                            )}
                        </>
                    )}
                </DialogContent>
                <DialogActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    {phase === 'sent' ? (
                        <Button onClick={onClose} variant="contained">Close</Button>
                    ) : (
                        <>
                            <Button onClick={save} disabled={sending} sx={{ mr: 'auto' }}>Save as a file</Button>
                            <Button onClick={onClose} disabled={sending}>Cancel</Button>
                            <Button type="submit" variant="contained" disabled={sending}>
                                {sending ? 'Sending…' : 'Send'}
                            </Button>
                        </>
                    )}
                </DialogActions>
            </form>
        </Dialog>
    );
}

ProblemReport.propTypes = {
    master: PropTypes.object,
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    inRoom: PropTypes.bool,
    isPrivate: PropTypes.bool,
    roomName: PropTypes.string,
};

/** The front page's link: before a room, there is no room menu. */
export function ProblemReportLink({ master }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button size="small" color="inherit" onClick={() => setOpen(true)}
                startIcon={<FeedbackOutlined fontSize="small" />}
                sx={{ color: 'text.secondary', textTransform: 'none', alignSelf: 'center' }}>
                {REPORT_TITLE}
            </Button>
            {open && <ProblemReport master={master} open onClose={() => setOpen(false)} />}
        </>
    );
}

ProblemReportLink.propTypes = {
    master: PropTypes.object,
};
