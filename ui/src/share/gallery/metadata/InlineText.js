import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';

const KINDS = {
    title: {
        label: 'Title', add: 'Add title', maxLength: 200, multiline: false,
        textSx: { fontWeight: 600, lineHeight: 1.3 }, variant: 'subtitle1', component: 'h3',
    },
    description: {
        label: 'Description', add: 'Add description', maxLength: 4000, multiline: true,
        textSx: { color: 'text.secondary', lineHeight: 1.45 }, variant: 'body2', component: 'p',
        // Long descriptions show two lines on a tile; the viewer has the rest.
        clampSx: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
    },
};

/**
 * A title or description edited where it is shown: click it (or "Add …")
 * to type, Enter or leaving the field saves (Shift+Enter starts a new line
 * in a description), Escape cancels. Without `onSave` it is plain text.
 */
function InlineText({ kind = 'title', value, onSave, sx }) {
    const [draft, setDraft] = useState(null);
    const [saving, setSaving] = useState(false);
    const current = value || '';
    const config = KINDS[kind];
    const textSx = { wordBreak: 'break-word', whiteSpace: config.multiline ? 'pre-wrap' : 'normal', ...config.textSx, ...sx };

    if (!onSave) {
        return value ? (
            <Typography variant={config.variant} component={config.component} sx={{ ...textSx, ...config.clampSx }}>
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
                multiline={config.multiline}
                maxRows={config.multiline ? 8 : undefined}
                value={draft}
                disabled={saving}
                placeholder={config.label}
                inputProps={{ maxLength: config.maxLength, 'aria-label': config.label }}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={event => {
                    // Enter also confirms an input-method candidate; that must not save.
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                        event.preventDefault();
                        commit();
                    } else if (event.key === 'Escape') {
                        setDraft(null);
                    }
                }}
                sx={{
                    ...config.textSx, ...sx, fontSize: config.multiline ? '0.875rem' : '1rem', px: 0.75, py: 0.25,
                    borderRadius: 1, border: 1, borderColor: 'primary.main', bgcolor: 'background.default',
                }}
            />
        );
    }

    return (
        <Typography variant={config.variant} component={config.component} sx={textSx}>
            <Box
                component="button"
                type="button"
                aria-label={value ? `Edit ${kind} ${value}` : config.add}
                onClick={() => setDraft(current)}
                sx={{
                    p: 0, border: 0, background: 'none', font: 'inherit', textAlign: 'left', cursor: 'text',
                    borderRadius: 1, color: value ? 'inherit' : 'text.secondary', whiteSpace: 'inherit',
                    fontWeight: value ? 'inherit' : 400,
                    ...(value ? config.clampSx : { textDecoration: 'underline dotted', textUnderlineOffset: '4px' }),
                    '&:hover': { bgcolor: 'action.hover', color: value ? 'inherit' : 'primary.main' },
                }}
            >
                {value || config.add}
            </Box>
        </Typography>
    );
}

InlineText.propTypes = {
    kind: PropTypes.oneOf(['title', 'description']),
    value: PropTypes.string,
    onSave: PropTypes.func,
    sx: PropTypes.object,
};

export default InlineText;
