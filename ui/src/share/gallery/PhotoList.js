import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloudDownloadRounded from '@mui/icons-material/CloudDownloadRounded';
import DeleteRounded from '@mui/icons-material/DeleteRounded';
import FullscreenRounded from '@mui/icons-material/FullscreenRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import AudiotrackRounded from '@mui/icons-material/AudiotrackRounded';
import { format } from 'date-fns';
import Logger from 'js-logger';
import RenderContent from './RenderContent';
import PhotoDetails from './PhotoDetails';
import TileErrorBoundary from './TileErrorBoundary';
import LoadingTile from './LoadingTile';
import { RatingStars } from './metadata/MediaMetadataPanel';
import { saveLabel } from './savePhoto';
import { saveToDevice } from './saveToDevice';
import { canReadTorrentFile } from './saveRoom';
import { removeLabel } from './removeLabel';
import { keyOf, useArriving, usePreview } from './mediaView';
import { alreadyHave, HAVE_LABELS, useHaveChanges } from './alreadyHave';
import { peerLabel } from '../topology/presence';

const mono = { fontFamily: 'var(--font-mono)', fontSize: '0.75rem' };
const muted = { color: 'text.secondary' };

/** "Sat 26 Oct 2026", the heading over one day's photos when they are sorted by date taken. */
export function dayLabel(takenAt) {
    return takenAt == null ? 'No date taken' : format(new Date(takenAt), 'EEE d MMM yyyy');
}

/** "26 Oct 2026, 18:42", or empty when the file has no date taken. */
export function takenLabel(takenAt) {
    return takenAt == null ? '' : format(new Date(takenAt), 'd MMM yyyy, HH:mm');
}

/** Who put the photo in the room: "You", their name, or their device. */
export function sharerLabel(tile, master) {
    const myPeerId = master.client && master.client.peerId;
    if (!tile.peerId) return '';
    if (tile.peerId === myPeerId) return 'You';
    const items = (master.peers && master.peers.items) || [];
    const peer = items.find(item => item.peerId === tile.peerId);
    return peer ? peerLabel(peer) : '';
}

/**
 * Split rows into days when they are sorted by date taken, so a trip reads
 * day by day. Other sorts give one group without a heading.
 */
export function groupByDay(tiles, facts, sort) {
    if (sort !== 'taken-desc' && sort !== 'taken-asc') return [{ label: null, tiles }];
    const groups = [];
    tiles.forEach(tile => {
        const label = dayLabel(facts.get(tile)?.takenAt ?? null);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.tiles.push(tile);
        else groups.push({ label, tiles: [tile] });
    });
    return groups;
}

/** A small square of the photo. A tap shows it full screen. */
function Thumb({ tile, master, size, onOpen, onPick }) {
    const poster = usePreview(tile);
    const percent = useArriving(tile);
    const Icon = tile.isAudio ? AudiotrackRounded : PlayCircleRounded;
    const previewOnly = !!tile.previewOnly;
    let inside;
    if (tile.loading) {
        inside = (
            <>
                {poster && <Box component="img" src={poster} alt="" sx={{ ...fill, filter: 'brightness(0.55)' }} />}
                <CircularProgress size={22} variant={percent > 0 ? 'determinate' : 'indeterminate'} value={percent}
                    sx={{ position: 'relative', color: poster ? '#fff' : undefined }} />
            </>
        );
    } else if (tile.isImage && !previewOnly) {
        // The same RenderContent the full view uses: it also reads the photo's details once it is here.
        inside = (
            <TileErrorBoundary fileName={tile.fileName}>
                <Box sx={{ ...fill, '& div': { height: '100%' }, '& img': { width: '100% !important', height: '100% !important', objectFit: 'cover', aspectRatio: 'auto !important' } }}>
                    <RenderContent tile={tile} master={master} playbackActive={false} />
                </Box>
            </TileErrorBoundary>
        );
    } else {
        inside = (
            <>
                {poster && <Box component="img" src={poster} alt="" sx={fill} />}
                {!previewOnly && <Icon sx={{ position: 'relative', fontSize: size / 2.5, color: poster ? '#fff' : 'text.secondary' }} />}
            </>
        );
    }
    const box = {
        position: 'relative', width: size, height: size, flexShrink: 0, borderRadius: 1, overflow: 'hidden',
        bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center',
    };
    // Only the preview is here, or it is still arriving: a tap picks the row,
    // and its details have the one button that gets the photo.
    if (previewOnly || tile.loading) {
        return <Box onClick={onPick} sx={{ ...box, cursor: 'pointer' }}>{inside}</Box>;
    }
    return (
        <ButtonBase
            onClick={event => {
                event.stopPropagation();
                onOpen();
            }}
            aria-label={tile.fileName ? `View ${tile.fileName}` : 'View photo'}
            sx={box}
        >
            {inside}
        </ButtonBase>
    );
}
const fill = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

/**
 * The picked photo larger, at the top of its details: a tap shows it full
 * screen. A clip plays here; one still arriving shows how far along it is
 * (and "Download anyway" when only its preview is wanted).
 */
function Preview({ tile, master, onOpen }) {
    if (tile.loading) {
        return <Box sx={{ mb: 1.5 }}><LoadingTile name={tile.fileName || ''} tile={tile} master={master} /></Box>;
    }
    if (tile.secure && tile.sealedError) return null;
    const media = <RenderContent tile={tile} master={master} />;
    return (
        <TileErrorBoundary fileName={tile.fileName}>
            <Box data-testid="list-preview" sx={{ mb: 1.5, borderRadius: 1.5, overflow: 'hidden', bgcolor: '#07090d',
                '& img': { maxHeight: 300, objectFit: 'contain' } }}>
                {tile.isImage ? (
                    <ButtonBase onClick={onOpen} aria-label={`Full screen ${tile.fileName || 'photo'}`}
                        sx={{ display: 'block', width: '100%', cursor: 'zoom-in' }}>
                        {media}
                    </ButtonBase>
                ) : media}
            </Box>
        </TileErrorBoundary>
    );
}

/** Full screen, Save and Remove for the selected photo, above its details. */
function Actions({ tile, master, onOpen, onRemove }) {
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        setSaving(false);
        setSaved(false);
    }, [tile]);
    const canSave = !tile.loading && !(tile.torrentFile && !tile.torrentFile.done && !tile.elem)
        && !!(tile.elem || canReadTorrentFile(tile.torrentFile));
    const save = () => {
        setSaving(true);
        saveToDevice([tile], { roomId: master.service && master.service.id })
            .then(result => setSaved(result !== 'cancelled'))
            .catch(err => Logger.error('save: ' + (err && err.message ? err.message : err)))
            .finally(() => setSaving(false));
    };
    return (
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}>
            <Button variant="contained" size="small" startIcon={<CloudDownloadRounded />}
                disabled={!canSave || saving} onClick={save}>
                {saveLabel(tile.fileSize, saving, saved)}
            </Button>
            <Button variant="outlined" size="small" startIcon={<FullscreenRounded />} onClick={onOpen}
                disabled={tile.loading} sx={{ textTransform: 'none' }}>
                Full screen
            </Button>
            <IconButton aria-label={removeLabel(tile)} size="small" onClick={() => onRemove(tile)} sx={{ ml: 'auto' }}>
                <DeleteRounded fontSize="small" />
            </IconButton>
        </Stack>
    );
}

function TitleCell({ tile, facts }) {
    useHaveChanges();
    const have = alreadyHave(tile);
    if (tile.secure && tile.sealedError) {
        return (
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <LockRounded fontSize="small" sx={muted} />
                <Typography variant="body2" sx={muted}>{tile.sealedError}</Typography>
            </Stack>
        );
    }
    const title = facts?.title;
    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: title ? 600 : 400 }} title={title || tile.fileName}>
                {title || tile.fileName || 'Photo'}
            </Typography>
            {title && <Typography variant="caption" noWrap component="div" sx={{ ...muted, ...mono }}>{tile.fileName}</Typography>}
            {tile.loading && <Typography variant="caption" sx={{ color: 'primary.main' }}>Arriving…</Typography>}
            {have && (
                <Stack direction="row" spacing={0.5} data-testid="already-have" sx={{ alignItems: 'center' }}>
                    <CheckCircleRounded aria-hidden="true" sx={{ fontSize: 13, color: 'success.main' }} />
                    <Typography variant="caption" sx={muted}>{HAVE_LABELS[have]}</Typography>
                </Stack>
            )}
        </Box>
    );
}

const SORTABLE = {
    title: { asc: 'title' },
    rating: { desc: 'rating' },
    taken: { desc: 'taken-desc', asc: 'taken-asc' },
    camera: { asc: 'camera' },
};

/** The table header: a tap on Title, Rating, Taken or Camera sorts by it. */
function HeadCell({ id, label, sort, onSort, sx }) {
    const ways = SORTABLE[id];
    if (!ways) return <TableCell sx={sx}>{label}</TableCell>;
    const active = Object.entries(ways).find(([, value]) => value === sort);
    const next = () => {
        if (active && ways.asc && ways.desc) onSort(active[0] === 'desc' ? ways.asc : ways.desc);
        else onSort(ways.desc || ways.asc);
    };
    return (
        <TableCell sx={sx} sortDirection={active ? active[0] : false}>
            <TableSortLabel active={!!active} direction={active ? active[0] : (ways.desc ? 'desc' : 'asc')} onClick={next}>
                {label}
            </TableSortLabel>
        </TableCell>
    );
}

/**
 * Photographer mode's room view: one row per photo with its title, rating,
 * date taken, camera, lens, exposure, place, size and who shared it. The
 * selected photo's details (editable) sit beside the list on a wide screen
 * and open under the row on a phone. A tap on a thumbnail shows the photo
 * full screen.
 */
function PhotoList({ master, tiles, facts, roomTiles, sort, onSort, openKey, onOpen, onRemove }) {
    const theme = useTheme();
    // Read the width on the first render: a phone layout first and the table
    // after would mount every thumbnail twice.
    const wide = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });
    const roomy = useMediaQuery(theme.breakpoints.up('lg'), { noSsr: true });
    const [picked, setPicked] = useState(null);
    const rowRefs = useRef(new Map());

    // Back from full screen, the photo seen last is the one picked.
    useEffect(() => {
        if (openKey != null) setPicked(openKey);
    }, [openKey]);

    const pickedTile = tiles.find(tile => keyOf(tile) === picked);
    // A wide screen always shows someone's details; a phone only after a tap.
    const shown = pickedTile || (wide ? tiles.find(tile => !tile.loading) || tiles[0] : null);
    const shownKey = shown ? keyOf(shown) : null;
    const groups = useMemo(() => groupByDay(tiles, facts, sort), [tiles, facts, sort]);

    const move = useCallback((tile, step) => {
        const index = tiles.indexOf(tile) + step;
        const next = tiles[index];
        if (!next) return;
        setPicked(keyOf(next));
        const row = rowRefs.current.get(keyOf(next));
        if (row && typeof row.focus === 'function') row.focus();
    }, [tiles]);

    const onRowKey = (event, tile) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') { event.preventDefault(); if (!tile.loading) onOpen(tile); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); move(tile, 1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(tile, -1); }
    };

    const rowProps = tile => ({
        ref: node => { if (node) rowRefs.current.set(keyOf(tile), node); else rowRefs.current.delete(keyOf(tile)); },
        tabIndex: 0,
        className: 'media-card',
        'aria-selected': keyOf(tile) === shownKey,
        'data-testid': 'photo-row',
        onKeyDown: event => onRowKey(event, tile),
        onDoubleClick: () => !tile.loading && onOpen(tile),
    });

    const details = tile => (
        <Box sx={{ p: wide ? 2 : 1.5 }}>
            <Preview tile={tile} master={master} onOpen={() => onOpen(tile)} />
            <Actions tile={tile} master={master} onOpen={() => onOpen(tile)} onRemove={onRemove} />
            <PhotoDetails master={master} tile={tile} roomTiles={roomTiles} />
        </Box>
    );

    if (!wide) {
        return (
            <Box component="section" aria-label="Photos" sx={{ pb: 3 }}>
                {groups.map(group => (
                    <Box key={group.label || 'all'}>
                        {group.label && <DayHeading label={group.label} count={group.tiles.length} />}
                        {group.tiles.map(tile => {
                            const fact = facts.get(tile);
                            const open = keyOf(tile) === shownKey;
                            const line2 = fact?.exposure || '';
                            const line3 = [takenLabel(fact?.takenAt ?? null), fact?.place].filter(Boolean).join(' · ');
                            return (
                                <Box key={keyOf(tile)} className="media-card" data-testid="photo-row"
                                    sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: open ? 'action.selected' : 'transparent' }}>
                                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1 }}>
                                        <Thumb tile={tile} master={master} size={64} onOpen={() => onOpen(tile)} onPick={() => setPicked(keyOf(tile))} />
                                        <ButtonBase aria-expanded={open}
                                            ref={node => { if (node) rowRefs.current.set(keyOf(tile), node); else rowRefs.current.delete(keyOf(tile)); }}
                                            onClick={() => setPicked(open ? '' : keyOf(tile))}
                                            onKeyDown={event => {
                                                if (event.key === 'ArrowDown') { event.preventDefault(); move(tile, 1); }
                                                else if (event.key === 'ArrowUp') { event.preventDefault(); move(tile, -1); }
                                            }}
                                            sx={{ minWidth: 0, flex: 1, display: 'block', textAlign: 'left', borderRadius: 1, py: 0.5,
                                                '&.Mui-focusVisible': { boxShadow: `0 0 0 2px ${theme.palette.primary.main}` } }}>
                                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                                                <Box sx={{ minWidth: 0, flex: 1 }}><TitleCell tile={tile} facts={fact} /></Box>
                                                {fact?.rating > 0 && <RatingStars value={fact.rating} size={13} />}
                                            </Stack>
                                            {fact?.camera && <Typography variant="caption" noWrap component="div" sx={muted}>{fact.camera}</Typography>}
                                            {line2 && <Typography variant="caption" noWrap component="div" sx={{ ...muted, ...mono }}>{line2}</Typography>}
                                            {line3 && <Typography variant="caption" noWrap component="div" sx={muted}>{line3}</Typography>}
                                        </ButtonBase>
                                    </Stack>
                                    <Collapse in={open} unmountOnExit>
                                        <Box sx={{ bgcolor: 'background.paper' }}>
                                            {details(tile)}
                                        </Box>
                                    </Collapse>
                                </Box>
                            );
                        })}
                    </Box>
                ))}
            </Box>
        );
    }

    const cols = roomy ? 9 : 7;
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: 2, alignItems: 'start', pb: 3 }}>
            <Box component="section" aria-label="Photos" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper' }}>
                <Table size="small" stickyHeader aria-label="Photos and their details"
                    sx={{ tableLayout: 'fixed', '& td, & th': { px: 1, py: 0.75 } }}>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ width: 76 }}><Box component="span" sx={visuallyHidden}>Photo</Box></TableCell>
                            <HeadCell id="title" label="Title" sort={sort} onSort={onSort} />
                            <HeadCell id="rating" label="Rating" sort={sort} onSort={onSort} sx={{ width: 96 }} />
                            <HeadCell id="taken" label="Taken" sort={sort} onSort={onSort} sx={{ width: 150 }} />
                            <HeadCell id="camera" label="Camera" sort={sort} onSort={onSort} />
                            <TableCell>Exposure</TableCell>
                            {roomy && <TableCell>Place</TableCell>}
                            <TableCell sx={{ width: 76 }}>Size</TableCell>
                            {roomy && <TableCell sx={{ width: 120 }}>From</TableCell>}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {groups.map(group => (
                            <React.Fragment key={group.label || 'all'}>
                                {group.label && (
                                    <TableRow>
                                        <TableCell colSpan={cols} sx={{ bgcolor: 'action.hover' }}>
                                            <DayHeading label={group.label} count={group.tiles.length} inline />
                                        </TableCell>
                                    </TableRow>
                                )}
                                {group.tiles.map(tile => {
                                    const fact = facts.get(tile);
                                    return (
                                        <TableRow key={keyOf(tile)} hover {...rowProps(tile)} selected={keyOf(tile) === shownKey}
                                            onClick={() => setPicked(keyOf(tile))}
                                            sx={{ cursor: 'pointer', outline: 'none',
                                                '&:focus-visible': { boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}` } }}>
                                            <TableCell><Thumb tile={tile} master={master} size={60} onOpen={() => onOpen(tile)} onPick={() => setPicked(keyOf(tile))} /></TableCell>
                                            <TableCell><TitleCell tile={tile} facts={fact} /></TableCell>
                                            <TableCell>{fact?.rating > 0 ? <RatingStars value={fact.rating} size={14} />
                                                : fact?.rating === -1 ? <Typography variant="caption" sx={{ color: 'error.main' }}>Rejected</Typography> : null}</TableCell>
                                            <TableCell><Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{takenLabel(fact?.takenAt ?? null)}</Typography></TableCell>
                                            <TableCell>
                                                <Typography variant="body2" noWrap title={fact?.camera}>{fact?.camera}</Typography>
                                                {fact?.lens && <Typography variant="caption" noWrap component="div" sx={muted} title={fact.lens}>{fact.lens}</Typography>}
                                            </TableCell>
                                            <TableCell><Exposure value={fact?.exposure} /></TableCell>
                                            {roomy && <TableCell><Typography variant="body2" noWrap title={fact?.place || ''}>{fact?.place}</Typography></TableCell>}
                                            <TableCell><Typography variant="body2" sx={mono}>{tile.fileSize}</Typography></TableCell>
                                            {roomy && <TableCell><Typography variant="body2" noWrap>{sharerLabel(tile, master)}</Typography></TableCell>}
                                        </TableRow>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </TableBody>
                </Table>
            </Box>
            <Box component="aside" aria-label="Details of the selected photo" data-testid="list-details"
                sx={{ position: 'sticky', top: 72, maxHeight: 'calc(100vh - 88px)', overflow: 'auto',
                    border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
                {shown ? details(shown) : null}
            </Box>
        </Box>
    );
}

/** "ƒ/2 · 1/250 s" over "ISO 400 · 35 mm": aperture and shutter, then ISO and focal length. */
function Exposure({ value }) {
    if (!value) return null;
    const parts = value.split(' · ');
    const iso = parts.findIndex(part => part.startsWith('ISO'));
    const cut = iso > 0 ? iso : Math.ceil(parts.length / 2);
    return (
        <Box sx={{ ...mono, whiteSpace: 'nowrap' }}>
            <div>{parts.slice(0, cut).join(' · ')}</div>
            {cut < parts.length && <Box sx={muted}>{parts.slice(cut).join(' · ')}</Box>}
        </Box>
    );
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' };

function DayHeading({ label, count, inline }) {
    return (
        <Typography variant="overline" component="h3"
            sx={{ display: 'block', lineHeight: 1.6, px: inline ? 0 : 1, pt: inline ? 0 : 1.5, pb: inline ? 0 : 0.5, color: 'text.secondary' }}>
            {label} · {count === 1 ? '1 photo' : `${count} photos`}
        </Typography>
    );
}

PhotoList.propTypes = {
    master: PropTypes.object.isRequired,
    tiles: PropTypes.array.isRequired,
    facts: PropTypes.instanceOf(Map).isRequired,
    roomTiles: PropTypes.array.isRequired,
    sort: PropTypes.string.isRequired,
    onSort: PropTypes.func.isRequired,
    openKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    onOpen: PropTypes.func.isRequired,
    onRemove: PropTypes.func.isRequired,
};

export default PhotoList;
