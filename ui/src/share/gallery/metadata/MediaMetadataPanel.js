import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import EditRounded from '@mui/icons-material/EditRounded';
import { formatDistanceToNow } from 'date-fns';
import StarRounded from '@mui/icons-material/StarRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import PersonRounded from '@mui/icons-material/PersonRounded';
import PlaceRounded from '@mui/icons-material/PlaceRounded';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import CameraRounded from '@mui/icons-material/CameraRounded';
import ShutterSpeedRounded from '@mui/icons-material/ShutterSpeedRounded';
import AspectRatioRounded from '@mui/icons-material/AspectRatioRounded';
import TerrainRounded from '@mui/icons-material/TerrainRounded';
import BrushRounded from '@mui/icons-material/BrushRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import AlbumRounded from '@mui/icons-material/AlbumRounded';
import MusicNoteRounded from '@mui/icons-material/MusicNoteRounded';
import LocalOfferRounded from '@mui/icons-material/LocalOfferRounded';
import MemoryRounded from '@mui/icons-material/MemoryRounded';
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import FileUtil from '../../util/FileUtil';
import { groupMetadataForDisplay, humanizeMetadataValue, labelForMetadataKey } from './groupPhotoMetadata';

const monoLabelSx = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'text.secondary',
    lineHeight: 1.4,
};

// Lightroom / Bridge colour labels
const LABEL_COLORS = {
    red: '#e5484d',
    yellow: '#f5b942',
    green: '#3dde8b',
    blue: '#3e8ef7',
    purple: '#9b6cf6',
};

/** Render five stars with the rating rounded and clamped to 0–5; size is in pixels. */
export function RatingStars({ value, size = 22 }) {
    const rating = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
    return (
        <Stack direction="row" spacing={0.1} role="img" aria-label={`${rating} out of 5 stars`} sx={{ color: 'primary.main' }}>
            {[0, 1, 2, 3, 4].map(i => (i < rating
                ? <StarRounded key={i} sx={{ fontSize: size }} />
                : <StarOutlineRounded key={i} sx={{ fontSize: size, color: 'text.disabled' }} />))}
        </Stack>
    );
}

/** Show a label and swatch, using a neutral swatch for unknown labels; omit falsy values. */
export function ColorLabel({ value }) {
    if (!value) return null;
    const swatch = LABEL_COLORS[String(value).toLowerCase()];
    return (
        <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '3px', backgroundColor: swatch || 'text.secondary' }} />
            <Box component="span" sx={monoLabelSx}>{value}</Box>
        </Stack>
    );
}

/** Show a rating (-1 means rejected) and optional color label; omit a nullish rating. */
function RatingRow({ value, colorLabel }) {
    return (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            {value === -1 ? (
                <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 600 }}>Rejected</Typography>
            ) : value != null && (
                <>
                    <RatingStars value={value} />
                    <Box component="span" sx={{ ...monoLabelSx, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(value)}/5
                    </Box>
                </>
            )}
            <ColorLabel value={colorLabel} />
        </Stack>
    );
}

/** Display keywords as chips, with optional container style overrides. */
export function KeywordChips({ words, sx }) {
    return (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, ...sx }} aria-label="Keywords">
            {words.map(word => (
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
    );
}

/** Only what is set: a missing title or rating is listed quietly at the end instead. */
function MetadataHero({ highlights, onEdit }) {
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
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
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
            {onEdit && (
                <IconButton
                    size="small"
                    aria-label="Edit title, description and rating"
                    onClick={() => onEdit()}
                    sx={{ position: 'absolute', top: 6, right: 6, color: 'text.secondary' }}
                >
                    <EditRounded fontSize="small" />
                </IconButton>
            )}
            {title && (
                <Typography variant="h5" component="h2" sx={{ lineHeight: 1.25, wordBreak: 'break-word', pr: onEdit ? 4 : 0 }}>
                    {title.value}
                </Typography>
            )}
            {rating && <RatingRow value={rating.value} colorLabel={rating.colorLabel} />}
            {description && (
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word' }}>
                    {description.value}
                </Typography>
            )}
            {keywords && <KeywordChips words={keywords.value} sx={{ mt: 0.5 }} />}
        </Box>
    );
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;

/** Tap a star to rate; tap the current rating again to clear it. */
function StarPicker({ value, onChange }) {
    const rating = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
    return (
        <Stack direction="row" spacing={0.25} role="group" aria-label="Rating" sx={{ alignItems: 'center' }}>
            {[1, 2, 3, 4, 5].map(stars => (
                <IconButton
                    key={stars}
                    size="small"
                    aria-label={`${stars} star${stars > 1 ? 's' : ''}`}
                    aria-pressed={rating === stars}
                    onClick={() => onChange(rating === stars ? 0 : stars)}
                    sx={{ p: 0.25, color: stars <= rating ? 'primary.main' : 'text.disabled' }}
                >
                    {stars <= rating ? <StarRounded sx={{ fontSize: 28 }} /> : <StarOutlineRounded sx={{ fontSize: 28 }} />}
                </IconButton>
            ))}
            <Box component="span" sx={{ ...monoLabelSx, ml: 1, color: rating ? 'text.primary' : 'text.disabled' }}>
                {rating ? `${rating}/5` : 'Not rated'}
            </Box>
        </Stack>
    );
}

/** Title, description and rating, shared with everyone in the room on save. */
function DetailsEditor({ values, focus, onSave, onCancel }) {
    const [title, setTitle] = useState(values.title || '');
    const [description, setDescription] = useState(values.description || '');
    const [rating, setRating] = useState(values.rating > 0 ? values.rating : 0);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    /** Save only changed fields, closing on success or no changes and displaying save failures. */
    const save = async () => {
        // Send only what changed, so two people editing different fields
        // of the same photo don't overwrite each other.
        const changes = {};
        if (title.trim() !== (values.title || '')) changes.title = title.trim();
        if (description.trim() !== (values.description || '')) changes.description = description.trim();
        if (rating !== (values.rating > 0 ? values.rating : 0)) changes.rating = rating;
        if (Object.keys(changes).length === 0) {
            onCancel();
            return;
        }
        setSaving(true);
        setError('');
        try {
            await onSave(changes);
            onCancel();
        } catch (err) {
            setError(err && err.status === 404
                ? 'This photo is still being shared. Try again in a moment.'
                : (err && err.message) || 'Could not save. Try again.');
            setSaving(false);
        }
    };

    return (
        <Box
            component="form"
            aria-label="Edit title, description and rating"
            onSubmit={event => { event.preventDefault(); save(); }}
            sx={{
                mt: 1.5, p: 2, borderRadius: 2, border: 1, borderColor: 'primary.main',
                bgcolor: 'var(--accent-soft)', display: 'flex', flexDirection: 'column', gap: 1.5,
            }}
        >
            <TextField
                label="Title"
                size="small"
                fullWidth
                autoFocus={focus !== 'description' && focus !== 'rating'}
                value={title}
                onChange={event => setTitle(event.target.value)}
                inputProps={{ maxLength: TITLE_MAX }}
            />
            <TextField
                label="Description"
                size="small"
                fullWidth
                multiline
                minRows={2}
                maxRows={8}
                autoFocus={focus === 'description'}
                value={description}
                onChange={event => setDescription(event.target.value)}
                inputProps={{ maxLength: DESCRIPTION_MAX }}
            />
            <StarPicker value={rating} onChange={setRating} />
            {error && (
                <Typography variant="body2" role="alert" sx={{ color: 'error.main' }}>{error}</Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button type="submit" variant="contained" size="small" disabled={saving}>
                    {saving ? 'Saving…' : 'Save for everyone'}
                </Button>
                <Button size="small" onClick={onCancel} disabled={saving}>Cancel</Button>
            </Stack>
        </Box>
    );
}

/** "Chrome on Android" from a platform.js description, for people without a nickname. */
export function shortPlatform(platform) {
    const text = String(platform || '');
    const browser = (text.match(/^[A-Za-z]+/) || [''])[0];
    const os = (text.match(/\b(Android|iOS|iPadOS|Windows|OS X|macOS|Chrome OS|Linux)\b/) || [''])[0]
        .replace('OS X', 'macOS');
    if (browser && os) return `${browser} on ${os}`;
    return browser;
}

/** Prefer "you" for the local editor, then a nickname, platform name, or "someone". */
function editorName(editedBy, myPeerId) {
    if (myPeerId && editedBy.peerId === myPeerId) return 'you';
    return editedBy.name || shortPlatform(editedBy.platform) || 'someone';
}

/** Show editor attribution with a relative timestamp when valid; omit absent editors. */
function EditedBy({ editedBy, editedAt, myPeerId }) {
    if (!editedBy) return null;
    let when = '';
    try {
        when = editedAt ? formatDistanceToNow(new Date(editedAt), { addSuffix: true }) : '';
    } catch {
        when = '';
    }
    return (
        <Typography variant="caption" data-testid="details-edited-by" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
            Edited by {editorName(editedBy, myPeerId)}{when ? ` · ${when}` : ''}
        </Typography>
    );
}

const EDITABLE_MISSING = { Title: 'title', Description: 'description', Rating: 'rating' };

const DETAIL_ICONS = {
    'DateTimeOriginal': EventRounded,
    'Creator XMP': PersonRounded,
    'x-Location': PlaceRounded,
    'x-Camera': PhotoCameraRounded,
    'LensModel': CameraRounded,
    'x-Settings': ShutterSpeedRounded,
    'x-Pixel Size': AspectRatioRounded,
    'GPSAltitude': TerrainRounded,
    'x-CreatorTool': BrushRounded,
    'Software': BrushRounded,
    'x-Last Save with': BrushRounded,
    'x-Last Save at': EventRounded,
    'media.artist': PersonRounded,
    'media.album': AlbumRounded,
    'media.genre': LocalOfferRounded,
    'media.year': EventRounded,
    'media.track': MusicNoteRounded,
    'format.duration': ScheduleRounded,
    'format.codec': MemoryRounded,
    'format.container': MemoryRounded,
    'format.bitrate': GraphicEqRounded,
    'format.sampleRate': GraphicEqRounded,
};

const chipSx = {
    ...monoLabelSx,
    textTransform: 'none',
    letterSpacing: '0.02em',
    fontSize: '0.72rem',
    color: 'text.primary',
    px: 0.8,
    py: 0.25,
    borderRadius: '4px',
    bgcolor: 'var(--accent-soft)',
    fontVariantNumeric: 'tabular-nums',
};

/**
 * Render a value as text, exposure chips, or a map link for decimal coordinates.
 * Optional altitude is in meters and is appended only to a location value.
 */
function MetadataValue({ item, altitude }) {
    const { key, value } = item;

    if (value && typeof value === 'object' && value.lat != null && value.long != null) {
        const lat = Number(value.lat);
        const long = Number(value.long);
        const text = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(long).toFixed(4)}° ${long >= 0 ? 'E' : 'W'}`;
        return (
            <>
                <a href={`https://www.google.com/maps?q=${lat.toFixed(5)},${long.toFixed(5)}`} target="_blank" rel="noopener noreferrer">
                    {text}
                </a>
                {altitude != null && (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                        {' · '}{humanizeMetadataValue('GPSAltitude', altitude)}
                    </Box>
                )}
            </>
        );
    }

    // "ƒ/1.8 · 1/125 s · ISO 100 · 26 mm" reads best as a row of chips.
    if (key === 'x-Settings') {
        return (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {String(value).split(/\s*·\s*|,\s*/).filter(Boolean).map(part => (
                    <Box key={part} component="span" sx={chipSx}>{part}</Box>
                ))}
            </Stack>
        );
    }

    if (typeof value === 'object') {
        return <>{JSON.stringify(value)}</>;
    }

    return <>{humanizeMetadataValue(key, value)}</>;
}

/** The fields people look for, each with an icon so the list scans at a glance. */
function DetailRows({ items }) {
    if (!items.length) return null;
    const altitude = items.find(item => item.key === 'GPSAltitude')?.value;
    const hasLocation = items.some(item => item.key === 'x-Location');
    const rows = hasLocation ? items.filter(item => item.key !== 'GPSAltitude') : items;

    return (
        <Box component="dl" sx={{ m: 0, display: 'flex', flexDirection: 'column' }}>
            {rows.map(item => {
                const Icon = DETAIL_ICONS[item.key] || InfoOutlined;
                return (
                    <Box key={item.key} sx={{
                        display: 'grid',
                        gridTemplateColumns: '20px minmax(0, 1fr)',
                        columnGap: 1.25,
                        alignItems: 'start',
                        py: 0.9,
                        borderBottom: 1,
                        borderColor: 'divider',
                    }}>
                        <Icon aria-hidden="true" sx={{ fontSize: 18, color: 'primary.main', mt: '2px' }} />
                        <Box sx={{ minWidth: 0 }}>
                            <Box component="dt" sx={{ ...monoLabelSx, fontSize: '0.6rem' }}>
                                {labelForMetadataKey(item.key)}
                            </Box>
                            <Typography component="dd" variant="body2" sx={{ m: 0, mt: 0.25, lineHeight: 1.45, wordBreak: 'break-word' }}>
                                <MetadataValue item={item} altitude={hasLocation ? altitude : undefined} />
                            </Typography>
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}

/** Show a heading, optional count, and a chevron when used in a collapsible section. */
function SectionHeading({ children, count, collapsible }) {
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Box component="span" sx={monoLabelSx}>{children}</Box>
            {count != null && (
                <Box component="span" sx={{ ...monoLabelSx, color: 'text.disabled' }}>{count}</Box>
            )}
            <Box sx={{ flex: 1, borderTop: 1, borderColor: 'divider' }} />
            {collapsible && (
                <ExpandMoreRounded className="section-chevron" aria-hidden="true"
                    sx={{ fontSize: 18, color: 'text.secondary', transition: 'transform 140ms' }} />
            )}
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

/**
 * Display metadata highlights, details, collapsed extra fields, and missing-field labels.
 * A falsy summary means details are still loading; an empty array means none were found.
 * Providing `onFileNameChange` enables editing the file name without its suffix.
 */
function MediaMetadataPanel({ summary, tile, fileName, onFileNameChange, onSaveDetails, myPeerId }) {
    const grouped = useMemo(
        () => groupMetadataForDisplay(summary, tile),
        [summary, tile]
    );
    // null, or the field to focus when the editor opens.
    const [editing, setEditing] = useState(null);
    const infoHashRef = useRef(tile?.infoHash);
    useEffect(() => {
        if (infoHashRef.current !== tile?.infoHash) {
            infoHashRef.current = tile?.infoHash;
            setEditing(null);
        }
    }, [tile?.infoHash]);

    const canEdit = typeof onSaveDetails === 'function';
    const showFileNameEditor = tile && onFileNameChange;
    const leadItems = grouped.lead.filter(item => item.key !== 'x-file name');
    const hasAnything = grouped.highlights.length > 0 || leadItems.length > 0 || grouped.more.length > 0;
    const hasCatalog = grouped.highlights.length > 0;

    return (
        <Box sx={{ mt: 1 }}>
            {editing ? (
                <DetailsEditor
                    values={grouped.values || {}}
                    focus={editing}
                    onSave={onSaveDetails}
                    onCancel={() => setEditing(null)}
                />
            ) : (
                <>
                    <MetadataHero highlights={grouped.highlights} onEdit={canEdit ? () => setEditing('title') : null} />
                    {canEdit && !hasCatalog && (
                        <Button
                            size="small"
                            startIcon={<EditRounded fontSize="small" />}
                            onClick={() => setEditing('title')}
                            sx={{ mt: 1.5, borderStyle: 'dashed', borderWidth: 1, borderColor: 'divider', color: 'text.secondary', px: 1.5 }}
                            variant="outlined"
                        >
                            Add a title, description or rating
                        </Button>
                    )}
                    <EditedBy editedBy={grouped.editedBy} editedAt={grouped.editedAt} myPeerId={myPeerId} />
                </>
            )}

            {!hasAnything && !canEdit && (
                <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                    {summary
                        ? 'No embedded metadata was found for this file.'
                        : 'Details appear once the file finishes loading.'}
                </Typography>
            )}

            {leadItems.length > 0 && (
                <Box sx={{ mt: 2.5 }}>
                    <SectionHeading>Details</SectionHeading>
                    <DetailRows items={leadItems} />
                </Box>
            )}

            {grouped.more.length > 0 && (
                <Box component="details" sx={{
                    mt: 2.5,
                    '& > summary': { listStyle: 'none', cursor: 'pointer' },
                    '& > summary::-webkit-details-marker': { display: 'none' },
                    '&[open] .section-chevron': { transform: 'rotate(180deg)' },
                }}>
                    <Box component="summary">
                        <SectionHeading count={grouped.more.length} collapsible>All metadata</SectionHeading>
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

            {summary && grouped.missing.length > 0 && (
                <Typography
                    variant="caption"
                    data-testid="metadata-missing"
                    sx={{ display: 'block', mt: 2.5, color: 'text.disabled', lineHeight: 1.5 }}
                >
                    <Box component="span" sx={{ ...monoLabelSx, color: 'text.disabled', mr: 0.75 }}>Not set</Box>
                    {grouped.missing.map((label, index) => (
                        <React.Fragment key={label}>
                            {index > 0 && ' · '}
                            {canEdit && EDITABLE_MISSING[label] && !editing ? (
                                <Box
                                    component="button"
                                    type="button"
                                    onClick={() => setEditing(EDITABLE_MISSING[label])}
                                    sx={{
                                        p: 0, border: 0, background: 'none', font: 'inherit', color: 'inherit',
                                        cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: '3px',
                                        '&:hover': { color: 'primary.main' },
                                    }}
                                >
                                    {label}
                                </Box>
                            ) : label}
                        </React.Fragment>
                    ))}
                </Typography>
            )}
        </Box>
    );
}

MediaMetadataPanel.propTypes = {
    summary: PropTypes.array,
    tile: PropTypes.object.isRequired,
    fileName: PropTypes.string,
    onFileNameChange: PropTypes.func,
    onSaveDetails: PropTypes.func,
    myPeerId: PropTypes.string,
};

export default MediaMetadataPanel;
