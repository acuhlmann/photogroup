import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Logger from 'js-logger';

export const NICKNAME_KEY = 'nickname';
export const MAX_NAME = 40;
export const NAME_ERROR = "Couldn't save that name. Try again.";

/**
 * Tell the room this person's new name, and keep it in this browser for the
 * next room. Throws when the room did not take it.
 */
export async function saveMyName(master, raw) {
    const name = String(raw || '').trim().slice(0, MAX_NAME);
    if (!name) throw new Error('empty name');
    // A rejected PUT comes back as nothing, so a falsy result is a failure.
    const peer = await master.service.updatePeer({ name });
    if (!peer) throw new Error('updatePeer returned no peer');
    // Keep the local record too, so a rejoin and the map agree.
    if (master.me) master.me.name = name;
    const mine = (master.peers?.items || []).find(item => item.peerId === master.client?.peerId);
    if (mine) mine.name = name;
    return name;
}

/**
 * The name field on this device's own node in geek mode, where everyone
 * else reads the name on the map and in the packet log. In every mode the
 * room menu also has "Your name"; both save through saveMyName().
 */
function PeerNameField({ master, hint, compact }) {
    const [value, setValue] = useState(() => localStorage.getItem(NICKNAME_KEY) || '');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const save = useCallback(async () => {
        const name = value.trim().slice(0, MAX_NAME);
        if (!name || saving) return;
        setSaving(true);
        setError('');
        try {
            await saveMyName(master, name);
            setValue(name);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (err) {
            Logger.warn('Could not save the name: ' + err);
            setError(NAME_ERROR);
        } finally {
            setSaving(false);
        }
    }, [value, saving, master]);

    return (
        <Box data-testid="peer-name" sx={{ py: 0.5 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                <TextField
                    label="Your name"
                    value={value}
                    onChange={event => setValue(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') save(); }}
                    onBlur={() => { if (value.trim() && value.trim() !== (localStorage.getItem(NICKNAME_KEY) || '')) save(); }}
                    placeholder="Ana"
                    slotProps={{ htmlInput: { maxLength: MAX_NAME, 'aria-label': 'Your name in this room' } }}
                    size="small"
                    fullWidth
                    disabled={saving}
                />
                {!compact && (
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={save}
                        disabled={saving || !value.trim()}
                        sx={{ textTransform: 'none', mb: 0.25, flex: 'none' }}
                    >
                        {saving ? 'Saving' : saved ? 'Saved' : 'Save'}
                    </Button>
                )}
            </Box>
            <Typography variant="caption" color={error ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
                {error || hint || 'Everyone in the room sees this name on the map and in the log.'}
            </Typography>
        </Box>
    );
}

PeerNameField.propTypes = {
    master: PropTypes.object.isRequired,
    hint: PropTypes.string,
    compact: PropTypes.bool,
};

export default PeerNameField;
