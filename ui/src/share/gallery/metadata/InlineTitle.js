import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';

const TITLE_MAX = 200;

/**
 * A title edited where it is shown: click it (or "Add title") to type,
 * Enter or leaving the field saves, Escape cancels. Without `onSave` it is
 * plain text.
 */
function InlineTitle({ value, onSave }) {
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    const current = value || '';

    if (!onSave) {
        return value ? (
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
                {value}
            </Typography>
        ) : null;
    }

    const commit = async () => {
        if (draft === null || saving) return;
        const next = draft.trim();
        if (next === current) {
            setDraft(null);
            return;
        }
        setSaving(true);
        try {
            await onSave(next);
            setDraft(null);
        } catch {
            // The caller reports the error; keep the text so it can be retried.
        } finally {
            setSaving(false);
        }
    };

    if (draft !== null) {
        return (
            <InputBase
                autoFocus
                fullWidth
                value={draft}
                disabled={saving}
                placeholder="Title"
                inputProps={{ maxLength: TITLE_MAX, 'aria-label': 'Title' }}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={event => {
                    // Enter also confirms an input-method candidate; that must not save.
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                        event.preventDefault();
                        commit();
                    } else if (event.key === 'Escape') {
                        setDraft(null);
                    }
                }}
                sx={{
                    fontWeight: 600, fontSize: '1rem', lineHeight: 1.3, px: 0.75, py: 0.25,
                    borderRadius: 1, border: 1, borderColor: 'primary.main', bgcolor: 'background.default',
                }}
            />
        );
    }

    return (
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
            <Box
                component="button"
                type="button"
                aria-label={value ? `Edit title ${value}` : 'Add title'}
                onClick={() => setDraft(current)}
                sx={{
                    p: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left', cursor: 'text',
                    borderRadius: 1, color: value ? 'inherit' : 'text.secondary',
                    fontWeight: value ? 'inherit' : 400,
                    ...(value ? {} : { textDecoration: 'underline dotted', textUnderlineOffset: '4px' }),
                    '&:hover': { bgcolor: 'action.hover', color: value ? 'inherit' : 'primary.main' },
                }}
            >
                {value || 'Add title'}
            </Box>
        </Typography>
    );
}

InlineTitle.propTypes = {
    value: PropTypes.string,
    onSave: PropTypes.func,
};

export default InlineTitle;
