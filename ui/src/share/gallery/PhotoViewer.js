import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CloudDownloadRounded from '@mui/icons-material/CloudDownloadRounded';
import StarOutlined from '@mui/icons-material/StarOutlined';
import StarBorderOutlined from '@mui/icons-material/StarBorderOutlined';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import List from '@mui/material/List';
import FileUtil from '../util/FileUtil';
import OwnersList from './OwnersList';
import PhotoDetailsRenderer from './metadata/PhotoDetailsRenderer';
import { groupPhotoMetadata, labelForMetadataKey } from './metadata/groupPhotoMetadata';
import { saveLabel, savePhoto } from './savePhoto';
import { photoTransitionName, supportsViewTransition } from './viewTransition';

function RatingStars({ value }) {
    const rating = Math.max(0, Math.min(5, Number(value) || 0));
    const stars = [];
    for (let i = 0; i < 5; i += 1) {
        stars.push(i < rating
            ? <StarOutlined key={i} fontSize="small" />
            : <StarBorderOutlined key={i} fontSize="small" />);
    }
    return <span aria-label={`${rating} out of 5`}>{stars}</span>;
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
    return (
        <Box component="dl" sx={{ m: 0 }}>
            {items.map(item => (
                <Box key={item.key} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}>
                    <Typography component="dt" variant="caption" sx={{ color: 'text.secondary' }}>
                        {labelForMetadataKey(item.key)}
                    </Typography>
                    <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                        <MetadataValue item={item} />
                    </Typography>
                </Box>
            ))}
        </Box>
    );
}

function PhotoViewer({ master, tiles, index, onClose, onIndexChange }) {
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
    const tile = tiles[index];
    const [summary, setSummary] = useState(null);
    const [fileName, setFileName] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const nameBridge = useRef({
        setState: (next) => {
            if (next && Object.prototype.hasOwnProperty.call(next, 'fileName')) {
                setFileName(next.fileName);
            }
        },
    });

    useEffect(() => {
        if (!tile) return;
        setFileName(FileUtil.getFileNameWithoutSuffix(tile.fileName) || '');
        setSaved(false);
        setSaving(false);
        if (tile.metadata && master.metadata && typeof master.metadata.createMetadataSummary === 'function') {
            setSummary(master.metadata.createMetadataSummary(tile.metadata, tile) || null);
        } else {
            setSummary(null);
        }
    }, [tile, tile && tile.metadata, tile && tile.fileName, master.metadata]);

    useEffect(() => {
        const onKey = (event) => {
            const tag = event.target && event.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (event.key === 'ArrowRight' && index < tiles.length - 1) {
                onIndexChange(index + 1);
            } else if (event.key === 'ArrowLeft' && index > 0) {
                onIndexChange(index - 1);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [index, tiles.length, onIndexChange]);

    if (!tile) return null;

    const isImage = !!tile.isImage;
    const grouped = isImage ? groupPhotoMetadata(summary) : { lead: [], more: [] };
    const transitionName = photoTransitionName(tile.infoHash);
    const canSave = !!(tile.elem || (tile.torrentFile && typeof tile.torrentFile.getBlob === 'function'));
    const stillArriving = !!(tile.torrentFile && !tile.torrentFile.done);

    let mediaDetails = null;
    if (!isImage && summary && summary.length > 0) {
        const details = new PhotoDetailsRenderer(master.service, nameBridge.current);
        mediaDetails = details.render(summary, tile, fileName);
    }

    const onSave = () => {
        setSaving(true);
        savePhoto(tile)
            .then(() => setSaved(true))
            .catch(() => {})
            .finally(() => setSaving(false));
    };

    return (
        <Dialog
            open
            onClose={onClose}
            fullScreen={fullScreen}
            maxWidth="lg"
            fullWidth
            aria-labelledby="photo-viewer-title"
            transitionDuration={supportsViewTransition() ? 0 : undefined}
            slotProps={{
                paper: {
                    sx: {
                        bgcolor: 'background.paper',
                        overflow: 'hidden',
                        height: fullScreen ? '100%' : 'min(90vh, 860px)',
                    },
                },
            }}
        >
            <Box sx={{
                display: 'flex',
                flexDirection: fullScreen ? 'column' : 'row',
                height: '100%',
                minHeight: 0,
            }}>
                <Box sx={{
                    flex: 1.4,
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: '#0a0e14',
                }}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
                        <IconButton aria-label="Close photo" onClick={onClose} sx={{ color: '#fff' }}>
                            <CloseRounded />
                        </IconButton>
                    </Box>
                    <Box sx={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: 2,
                        overflow: 'hidden',
                    }}>
                        {tile.img ? (
                            <img
                                src={tile.img}
                                alt={tile.fileName || 'Shared photo'}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    viewTransitionName: transitionName,
                                }}
                            />
                        ) : (
                            <Typography sx={{ color: '#fff' }}>{tile.fileName}</Typography>
                        )}
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 2 }}>
                        <IconButton
                            aria-label="Previous photo"
                            onClick={() => onIndexChange(index - 1)}
                            disabled={index <= 0}
                            sx={{ color: '#fff' }}
                        >
                            <ArrowBackRounded />
                        </IconButton>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<CloudDownloadRounded />}
                            disabled={!canSave || saving || stillArriving}
                            onClick={onSave}
                            sx={{ flex: 1 }}
                        >
                            {saveLabel(tile.fileSize, saving, saved)}
                        </Button>
                        <IconButton
                            aria-label="Next photo"
                            onClick={() => onIndexChange(index + 1)}
                            disabled={index >= tiles.length - 1}
                            sx={{ color: '#fff' }}
                        >
                            <ArrowForwardRounded />
                        </IconButton>
                    </Stack>
                </Box>

                <Box sx={{
                    flex: 1,
                    maxWidth: fullScreen ? 'none' : 420,
                    overflow: 'auto',
                    p: 2.5,
                    minHeight: 0,
                }}>
                    <Typography id="photo-viewer-title" variant="h6" sx={{ wordBreak: 'break-word' }}>
                        {tile.fileName}
                    </Typography>
                    {tile.fileSize && (
                        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                            {tile.fileSize}
                        </Typography>
                    )}

                    {isImage && grouped.lead.length > 0 && (
                        <Box sx={{ mt: 2 }}>
                            <MetadataRows items={grouped.lead} />
                        </Box>
                    )}

                    {isImage && grouped.more.length > 0 && (
                        <Box component="details" sx={{ mt: 2 }}>
                            <Typography component="summary" variant="subtitle2" sx={{ cursor: 'pointer' }}>
                                More
                            </Typography>
                            <MetadataRows items={grouped.more} />
                        </Box>
                    )}

                    {isImage && grouped.lead.length === 0 && grouped.more.length === 0 && (
                        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                            {summary
                                ? 'This photo has no extra details.'
                                : 'Details show up once the photo finishes loading.'}
                        </Typography>
                    )}

                    {!isImage && mediaDetails && (
                        <List sx={{ mt: 1 }}>
                            {mediaDetails}
                        </List>
                    )}

                    {Array.isArray(tile.owners) && master.peers && master.client
                        && tile.owners.some(owner => owner.peerId !== master.client.peerId) && (
                        <Box sx={{ mt: 2 }}>
                            <OwnersList
                                emitter={master.emitter}
                                tile={tile}
                                peers={master.peers}
                                myPeerId={master.client && master.client.peerId}
                            />
                        </Box>
                    )}
                </Box>
            </Box>
        </Dialog>
    );
}

PhotoViewer.propTypes = {
    master: PropTypes.object.isRequired,
    tiles: PropTypes.array.isRequired,
    index: PropTypes.number.isRequired,
    onClose: PropTypes.func.isRequired,
    onIndexChange: PropTypes.func.isRequired,
};

export default PhotoViewer;
