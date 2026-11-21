import React from 'react';
import PropTypes from 'prop-types';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import FileUtil from '../util/FileUtil';
import { sendTimeText } from './lightSpeed';

export const SMALL_SIZE = 'Small size';
export const FULL_SIZE = 'Full size';
export const SIZE_HELP = 'Small size fills a phone screen and comes fast. For a video, small size is one photo from it. Get the full size later if you need it.';
export const ONLY_FULL = 'A private photo goes only in full size.';
export const ONLY_SMALL = 'Too large for full size by camera.';

/** "120 kB · about 40 seconds" ("up to 120 kB" when it is the most), or what stops that size. */
function sizeLine(bytes, level, why, upTo) {
    if (why) return why;
    if (bytes == null) return '…';
    return `${upTo ? 'up to ' : ''}${FileUtil.formatBytes(bytes)} · ${sendTimeText(bytes, level)}`;
}

/**
 * The size that photos go in by camera: small (fast) or full (slow), each
 * with its bytes and about how long the camera takes for them.
 */
export default function SizeChoice({ value, onChange, smallBytes, fullBytes, smallUpTo, level, onlyFull, onlySmall, light }) {
    const color = light ? '#111' : undefined;
    const option = (id, label, bytes, why, upTo = false) => (
        <ToggleButton
            value={id} disabled={!!why} data-testid={`size-${id}`}
            aria-label={`${label}, ${sizeLine(bytes, level, why, upTo)}`}
            sx={{
                textTransform: 'none', color, flex: 1, minWidth: 0, py: 0.75, px: 1.25, lineHeight: 1.25,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                ...(light ? { borderColor: '#999', '&.Mui-selected': { bgcolor: '#e3ecfa', color: '#0b3a82' } } : {}),
            }}
        >
            <span style={{ fontWeight: 600 }}>{label}</span>
            <Typography component="span" variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', color: 'inherit', opacity: 0.85 }}>
                {sizeLine(bytes, level, why, upTo)}
            </Typography>
        </ToggleButton>
    );
    return (
        <Stack spacing={0.5} sx={{ alignItems: 'center', width: '100%', maxWidth: 420 }}>
            <ToggleButtonGroup
                exclusive size="small" value={value} aria-label="Size" fullWidth color="primary"
                onChange={(event, next) => { if (next) onChange(next); }}
            >
                {option('small', SMALL_SIZE, smallBytes, onlyFull ? ONLY_FULL : null, smallUpTo)}
                {option('full', FULL_SIZE, fullBytes, onlySmall ? ONLY_SMALL : null)}
            </ToggleButtonGroup>
            <Typography variant="caption" sx={{ color: light ? '#555' : 'text.secondary', textAlign: 'center' }}>
                {SIZE_HELP}
            </Typography>
        </Stack>
    );
}

SizeChoice.propTypes = {
    value: PropTypes.oneOf(['small', 'full']).isRequired,
    onChange: PropTypes.func.isRequired,
    smallBytes: PropTypes.number,
    fullBytes: PropTypes.number,
    /** smallBytes is the most that the photos are in small size, before they are made */
    smallUpTo: PropTypes.bool,
    level: PropTypes.object.isRequired,
    onlyFull: PropTypes.bool,
    onlySmall: PropTypes.bool,
    light: PropTypes.bool,
};
