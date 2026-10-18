import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import StarOutlined from '@mui/icons-material/StarOutlined';
import StarBorderOutlined from '@mui/icons-material/StarBorderOutlined';
import FileUtil from '../../util/FileUtil';
import { groupMetadataForDisplay, labelForMetadataKey } from './groupPhotoMetadata';

function RatingStars({ value, size = 'medium' }) {
    const rating = Math.max(0, Math.min(5, Number(value) || 0));
    const iconSx = size === 'large' ? { fontSize: 28 } : { fontSize: 18 };
    const stars = [];
    for (let i = 0; i < 5; i += 1) {
        stars.push(i < rating
            ? <StarOutlined key={i} sx={iconSx} color="primary" />
            : <StarBorderOutlined key={i} sx={iconSx} color="action" />);
    }
    return (
        <Stack direction="row" spacing={0.25} aria-label={`${rating} out of 5 stars`}>
            {stars}
        </Stack>
    );
}

function MetadataValue({ item }) {
    const { key, value } = item;

    if (key === 'Rating XMP') {
        return <RatingStars value={value} />;
    }

    if (value && typeof value === 'object' && value.lat != null && value.long != null) {
        const href = `https://www.google.com/maps/@${value.lat},${value.long},15z`;
        return (
            <a href={href} target="_blank" rel="noopener noreferrer">
                {`lat: ${value.lat}, long: ${value.long}`}
            </a>
        );
    }

    if (key === 'GPSAltitude') {
        const text = String(value);
        return <>{text.endsWith('m') ? text : `${text} m`}</>;
    }

    if (typeof value === 'object') {
        return <>{JSON.stringify(value)}</>;
    }

    return <>{String(value)}</>;
}

function MetadataRows({ items }) {
    if (!items.length) return null;

    return (
        <Box component="dl" sx={{ m: 0 }}>
            {items.map(item => (
                <Box key={item.key} sx={{ py: 1.1, borderBottom: 1, borderColor: 'divider' }}>
                    <Typography
                        component="dt"
                        variant="caption"
                        sx={{
                            color: 'text.secondary',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            fontSize: '0.65rem',
                        }}
                    >
                        {labelForMetadataKey(item.key)}
                    </Typography>
                    <Typography component="dd" variant="body2" sx={{ m: 0, mt: 0.35, lineHeight: 1.45 }}>
                        <MetadataValue item={item} />
                    </Typography>
                </Box>
            ))}
        </Box>
    );
}

function FileNameEditor({ tile, fileName, onFileNameChange }) {
    const suffix = FileUtil.getFileSuffix(tile.fileName);

    return (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            <TextField
                size="small"
                fullWidth
                label="File name"
                value={fileName}
                onChange={(event) => onFileNameChange(event.target.value)}
            />
            {suffix ? (
                <Typography variant="body2" sx={{ color: 'text.secondary', fontFamily: 'var(--font-mono)' }}>
                    {suffix}
                </Typography>
            ) : null}
        </Stack>
    );
}

function MetadataHighlights({ highlights }) {
    if (!highlights.length) return null;

    return (
        <Box
            sx={{
                mt: 2,
                p: 2,
                borderRadius: 2,
                bgcolor: 'action.hover',
                border: 1,
                borderColor: 'divider',
            }}
        >
            <Stack spacing={2}>
                {highlights.map(item => {
                    if (item.kind === 'title') {
                        return (
                            <Box key={item.id}>
                                <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.08em' }}>
                                    {item.label}
                                </Typography>
                                <Typography variant="h6" sx={{ mt: 0.5, fontWeight: 600, lineHeight: 1.3 }}>
                                    {item.value}
                                </Typography>
                            </Box>
                        );
                    }
                    if (item.kind === 'description') {
                        return (
                            <Box key={item.id}>
                                <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.08em' }}>
                                    {item.label}
                                </Typography>
                                <Typography variant="body1" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                    {item.value}
                                </Typography>
                            </Box>
                        );
                    }
                    if (item.kind === 'rating') {
                        return (
                            <Box key={item.id}>
                                <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.08em' }}>
                                    {item.label}
                                </Typography>
                                <Box sx={{ mt: 0.75 }}>
                                    <RatingStars value={item.value} size="large" />
                                </Box>
                            </Box>
                        );
                    }
                    return null;
                })}
            </Stack>
        </Box>
    );
}

function MediaMetadataPanel({ summary, tile, fileName, onFileNameChange }) {
    const grouped = useMemo(
        () => groupMetadataForDisplay(summary, tile),
        [summary, tile]
    );

    const showFileNameEditor = tile && onFileNameChange;
    const leadItems = grouped.lead.filter(item => item.key !== 'x-file name');

    if (!grouped.highlights.length && !leadItems.length && !grouped.more.length && !showFileNameEditor) {
        return (
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                {summary
                    ? 'No embedded metadata was found for this file.'
                    : 'Details appear once the file finishes loading.'}
            </Typography>
        );
    }

    return (
        <Box sx={{ mt: 1 }}>
            <MetadataHighlights highlights={grouped.highlights} />

            {showFileNameEditor && (
                <Box sx={{ mt: 2 }}>
                    <FileNameEditor tile={tile} fileName={fileName} onFileNameChange={onFileNameChange} />
                </Box>
            )}

            {leadItems.length > 0 && (
                <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5, color: 'text.secondary' }}>
                        Details
                    </Typography>
                    <MetadataRows items={leadItems} />
                </Box>
            )}

            {grouped.more.length > 0 && (
                <Box component="details" sx={{ mt: 2 }}>
                    <Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer', color: 'text.secondary' }}>
                        More metadata ({grouped.more.length})
                    </Typography>
                    <MetadataRows items={grouped.more} />
                </Box>
            )}
        </Box>
    );
}

MediaMetadataPanel.propTypes = {
    summary: PropTypes.array,
    tile: PropTypes.object.isRequired,
    fileName: PropTypes.string,
    onFileNameChange: PropTypes.func,
};

export default MediaMetadataPanel;
