import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import StarRounded from '@mui/icons-material/StarRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import FileUtil from '../../util/FileUtil';
import { groupMetadataForDisplay, labelForMetadataKey } from './groupPhotoMetadata';

const monoLabelSx = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'text.secondary',
    lineHeight: 1.4,
};

const missingSx = { color: 'text.secondary', fontStyle: 'italic', fontWeight: 400 };

// Lightroom / Bridge colour labels
const LABEL_COLORS = {
    red: '#e5484d',
    yellow: '#f5b942',
    green: '#3dde8b',
    blue: '#3e8ef7',
    purple: '#9b6cf6',
};

function RatingStars({ value }) {
    const rating = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
    return (
        <Stack direction="row" spacing={0.1} aria-label={`${rating} out of 5 stars`} sx={{ color: 'primary.main' }}>
            {[0, 1, 2, 3, 4].map(i => (i < rating
                ? <StarRounded key={i} sx={{ fontSize: 22 }} />
                : <StarOutlineRounded key={i} sx={{ fontSize: 22, color: 'text.disabled' }} />))}
        </Stack>
    );
}

function RatingRow({ value, colorLabel }) {
    const swatch = colorLabel && LABEL_COLORS[String(colorLabel).toLowerCase()];
    return (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            {value === -1 ? (
                <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>Rejected</Typography>
            ) : value == null ? (
                <>
                    <RatingStars value={0} />
                    <Typography variant="body2" sx={missingSx}>Not rated</Typography>
                </>
            ) : (
                <>
                    <RatingStars value={value} />
                    <Box component="span" sx={{ ...monoLabelSx, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(value)}/5
                    </Box>
                </>
            )}
            {colorLabel && (
                <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
                    <Box sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '3px',
                        backgroundColor: swatch || 'text.secondary',
                    }} />
                    <Box component="span" sx={monoLabelSx}>{colorLabel}</Box>
                </Stack>
            )}
        </Stack>
    );
}

function MetadataHero({ highlights }) {
    if (!highlights.length) return null;
    const byKind = Object.fromEntries(highlights.map(item => [item.kind, item]));
    const { title, rating, description, keywords } = byKind;

    return (
        <Box
            component="section"
            aria-label="Title, rating and description"
            sx={{
                position: 'relative',
                mt: 1.5,
                p: 2,
                pl: 2.25,
                borderRadius: 2,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'var(--accent-soft)',
                overflow: 'hidden',
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    bgcolor: 'primary.main',
                },
            }}
        >
            <Typography component="div" sx={monoLabelSx}>Title</Typography>
            <Typography
                variant="h5"
                component="h2"
                sx={{ mt: 0.25, lineHeight: 1.25, wordBreak: 'break-word', ...(title.value ? {} : missingSx) }}
            >
                {title.value || 'Untitled'}
            </Typography>

            <Typography component="div" sx={{ ...monoLabelSx, mt: 1.75 }}>Rating</Typography>
            <Box sx={{ mt: 0.25 }}>
                <RatingRow value={rating.value} colorLabel={rating.colorLabel} />
            </Box>

            <Typography component="div" sx={{ ...monoLabelSx, mt: 1.75 }}>Description</Typography>
            <Typography
                variant="body1"
                sx={{ mt: 0.25, whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word', ...(description.value ? {} : missingSx) }}
            >
                {description.value || 'No description'}
            </Typography>

            {keywords && (
                <Stack direction="row" sx={{ mt: 1.5, flexWrap: 'wrap', gap: 0.75 }} aria-label="Keywords">
                    {keywords.value.map(word => (
                        <Box
                            key={word}
                            component="span"
                            sx={{
                                ...monoLabelSx,
                                textTransform: 'none',
                                letterSpacing: '0.02em',
                                fontSize: '0.7rem',
                                color: 'text.primary',
                                px: 0.9,
                                py: 0.3,
                                borderRadius: '4px',
                                border: 1,
                                borderColor: 'divider',
                                bgcolor: 'background.paper',
                            }}
                        >
                            {word}
                        </Box>
                    ))}
                </Stack>
            )}
        </Box>
    );
}

function MetadataValue({ item }) {
    const { key, value } = item;

    if (value && typeof value === 'object' && value.lat != null && value.long != null) {
        const lat = Number(value.lat).toFixed(5);
        const long = Number(value.long).toFixed(5);
        return (
            <a href={`https://www.google.com/maps?q=${lat},${long}`} target="_blank" rel="noopener noreferrer">
                {`${lat}, ${long}`}
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

function SectionHeading({ children, count }) {
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Box component="span" sx={monoLabelSx}>{children}</Box>
            {count != null && (
                <Box component="span" sx={{ ...monoLabelSx, color: 'text.disabled' }}>{count}</Box>
            )}
            <Box sx={{ flex: 1, borderTop: 1, borderColor: 'divider' }} />
        </Stack>
    );
}

function MetadataRows({ items }) {
    if (!items.length) return null;

    return (
        <Box
            component="dl"
            sx={{
                m: 0,
                display: 'grid',
                gridTemplateColumns: 'minmax(84px, 34%) 1fr',
                columnGap: 1.5,
            }}
        >
            {items.map(item => (
                <React.Fragment key={item.key}>
                    <Box component="dt" sx={{ ...monoLabelSx, py: 0.85, borderBottom: 1, borderColor: 'divider', wordBreak: 'break-word' }}>
                        {labelForMetadataKey(item.key)}
                    </Box>
                    <Typography
                        component="dd"
                        variant="body2"
                        sx={{ m: 0, py: 0.75, lineHeight: 1.45, borderBottom: 1, borderColor: 'divider', wordBreak: 'break-word' }}
                    >
                        <MetadataValue item={item} />
                    </Typography>
                </React.Fragment>
            ))}
        </Box>
    );
}

function FileNameEditor({ tile, fileName, onFileNameChange }) {
    const suffix = FileUtil.getFileSuffix(tile.fileName);

    return (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
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

function MediaMetadataPanel({ summary, tile, fileName, onFileNameChange }) {
    const grouped = useMemo(
        () => groupMetadataForDisplay(summary, tile),
        [summary, tile]
    );

    const showFileNameEditor = tile && onFileNameChange;
    const leadItems = grouped.lead.filter(item => item.key !== 'x-file name');

    return (
        <Box sx={{ mt: 1 }}>
            {grouped.highlights.length > 0 ? (
                <MetadataHero highlights={grouped.highlights} />
            ) : (
                <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                    {summary
                        ? 'No embedded metadata was found for this file.'
                        : 'Details appear once the file finishes loading.'}
                </Typography>
            )}

            {leadItems.length > 0 && (
                <Box sx={{ mt: 2.5 }}>
                    <SectionHeading>Details</SectionHeading>
                    <MetadataRows items={leadItems} />
                </Box>
            )}

            {grouped.more.length > 0 && (
                <Box component="details" open sx={{ mt: 2.5, '& > summary': { listStyle: 'none', cursor: 'pointer' }, '& > summary::-webkit-details-marker': { display: 'none' } }}>
                    <Box component="summary">
                        <SectionHeading count={grouped.more.length}>All metadata</SectionHeading>
                    </Box>
                    <MetadataRows items={grouped.more} />
                </Box>
            )}

            {showFileNameEditor && (
                <Box sx={{ mt: 2.5 }}>
                    <SectionHeading>File</SectionHeading>
                    <FileNameEditor tile={tile} fileName={fileName} onFileNameChange={onFileNameChange} />
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
