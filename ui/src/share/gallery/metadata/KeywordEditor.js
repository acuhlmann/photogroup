import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import InputBase from '@mui/material/InputBase';
import CloseRounded from '@mui/icons-material/CloseRounded';
import AddRounded from '@mui/icons-material/AddRounded';

const MAX_KEYWORD_LENGTH = 50;

const chipSx = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    letterSpacing: '0.02em',
    color: 'text.primary',
    lineHeight: 1.4,
    pl: 0.9,
    py: 0.3,
    borderRadius: '4px',
    border: 1,
    borderColor: 'divider',
    bgcolor: 'background.paper',
    display: 'inline-flex',
    alignItems: 'center',
};

/**
 * Keywords as chips. With `onChange`, each chip can be removed and new ones
 * added (Enter or comma adds, several at once when pasted with commas);
 * every change saves the whole list. Without it, the chips are read-only.
 */
function KeywordEditor({ words, onChange, sx }) {
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    // The list as of the last change, so typing on while a save is under way adds to it.
    // An older list arriving from the room mid-save must not undo a newer local change.
    const latest = useRef(words);
    const pending = useRef(0);
    useEffect(() => {
        if (!pending.current) latest.current = words;
    }, [words]);
    const editable = typeof onChange === 'function';
    if (!editable && !words.length) return null;

    const save = async (next) => {
        latest.current = next;
        pending.current += 1;
        setSaving(true);
        try {
            await onChange(next);
            return true;
        } catch {
            return false; // the caller reports it
        } finally {
            pending.current -= 1;
            if (!pending.current) setSaving(false);
        }
    };

    /** Add what was typed; a comma keeps the field open for the next keyword. */
    const add = async (keepEditing = false) => {
        const current = latest.current;
        const fresh = String(draft || '').split(',').map(word => word.trim()).filter(Boolean)
            .filter(word => !current.some(existing => existing.toLowerCase() === word.toLowerCase()));
        if (!fresh.length) {
            setDraft(keepEditing ? '' : null);
            return;
        }
        const typed = draft;
        if (keepEditing) setDraft('');
        if (await save([...current, ...fresh])) {
            if (!keepEditing) setDraft(null);
        } else if (keepEditing) {
            setDraft(previous => (previous ? `${typed}, ${previous}` : typed));
        }
    };

    return (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, alignItems: 'center', ...sx }} aria-label="Keywords">
            {words.map(word => (
                <Box key={word} component="span" sx={{ ...chipSx, pr: editable ? 0.2 : 0.9 }}>
                    {word}
                    {editable && (
                        <Box component="button" type="button" aria-label={`Remove keyword ${word}`} disabled={saving}
                            onClick={() => save(words.filter(other => other !== word))}
                            sx={{
                                display: 'inline-flex', p: 0.1, ml: 0.3, border: 0, borderRadius: '3px', background: 'none',
                                color: 'text.secondary', cursor: 'pointer', '&:hover': { color: 'error.main', bgcolor: 'action.hover' },
                            }}>
                            <CloseRounded sx={{ fontSize: 13 }} />
                        </Box>
                    )}
                </Box>
            ))}
            {editable && (draft !== null ? (
                <InputBase
                    autoFocus
                    value={draft}
                    placeholder="keyword"
                    inputProps={{ 'aria-label': 'New keyword', maxLength: MAX_KEYWORD_LENGTH * 4 }}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={() => {
                        if (draft && draft.trim()) add();
                        else if (!saving) setDraft(null);
                    }}
                    onKeyDown={event => {
                        if ((event.key === 'Enter' || event.key === ',') && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                            event.preventDefault();
                            add(event.key === ',');
                        } else if (event.key === 'Escape') {
                            setDraft(null);
                        }
                    }}
                    sx={{ ...chipSx, px: 0.75, width: 120, borderColor: 'primary.main', '& input': { p: 0 } }}
                />
            ) : (
                <Box component="button" type="button" aria-label="Add keyword" onClick={() => setDraft('')}
                    sx={{
                        ...chipSx, pr: 0.9, pl: 0.6, cursor: 'pointer', borderStyle: 'dashed', color: 'text.secondary',
                        '&:hover': { color: 'primary.main', borderColor: 'primary.main' },
                    }}>
                    <AddRounded sx={{ fontSize: 14, mr: 0.2 }} />
                    {words.length ? 'keyword' : 'Add keywords'}
                </Box>
            ))}
        </Stack>
    );
}

KeywordEditor.propTypes = {
    words: PropTypes.arrayOf(PropTypes.string).isRequired,
    onChange: PropTypes.func,
    sx: PropTypes.object,
};

export default KeywordEditor;
