import React, { useEffect, useRef, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import _ from 'lodash';
import Logger from 'js-logger';
import FileUtil from '../util/FileUtil';
import OwnersList from './OwnersList';
import MediaMetadataPanel from './metadata/MediaMetadataPanel';
import { nearbyLocations, takenMinutesAgo } from './metadata/locationHints';
import { canSaveDetails, saveDetails } from './metadata/saveDetails';
import { isPrivateRoom } from '../privateRoom';

/**
 * All details of one photo: the file, the shared title, rating, description,
 * keywords and location (editable), the camera and exposure, and who has it.
 * The geek viewer shows it beside the photo; the photographer list shows it
 * beside (or under) the selected row.
 */
function PhotoDetails({ master, tile, roomTiles, headingId }) {
    const [summary, setSummary] = useState(null);
    const [fileName, setFileName] = useState('');

    const debouncedRename = useRef(
        _.throttle((infoHash, value) => {
            if (!value) return;
            Logger.info('change name ' + value);
            master.service.update([{
                infoHash,
                fileName: FileUtil.truncateFileName(value),
            }]);
        }, 1000, { leading: true, trailing: true })
    ).current;

    const handleSaveDetails = useCallback(
        (fields) => saveDetails(master, tile.infoHash, fields),
        [master, tile?.infoHash]);

    const handleFileNameChange = useCallback((value) => {
        setFileName(value);
        if (tile?.infoHash) {
            debouncedRename(tile.infoHash, value);
        }
    }, [tile?.infoHash, debouncedRename]);

    const applyMetadataSummary = useCallback((sourceTile) => {
        if (!sourceTile || !sourceTile.metadata || !master.metadata
            || typeof master.metadata.createMetadataSummary !== 'function') {
            setSummary(null);
            return;
        }
        setSummary(master.metadata.createMetadataSummary(sourceTile.metadata, sourceTile) || null);
    }, [master.metadata]);

    useEffect(() => {
        if (!tile) return;
        setFileName(FileUtil.getFileNameWithoutSuffix(tile.fileName) || '');
        applyMetadataSummary(tile);
    }, [tile, tile && tile.metadata, tile && tile.fileName, applyMetadataSummary]);

    useEffect(() => {
        if (!tile?.infoHash) return undefined;
        const handlePhotos = (event) => {
            if (event.type !== 'update' || !Array.isArray(event.item)) return;
            const updated = event.item.find(item => item.infoHash === tile.infoHash);
            if (updated) applyMetadataSummary(updated);
        };
        master.emitter.on('photos', handlePhotos);
        return () => master.emitter.removeListener('photos', handlePhotos);
    }, [tile?.infoHash, master.emitter, applyMetadataSummary]);

    if (!tile) return null;
    const others = Array.isArray(tile.owners) && master.peers && master.client
        && tile.owners.some(owner => owner.peerId !== master.client.peerId);

    return (
        <Box data-testid="photo-details">
            {/* The catalog title/rating/description lead; the file is context. */}
            <Typography
                id={headingId}
                variant="body2"
                sx={{ color: 'text.secondary', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', wordBreak: 'break-word' }}
            >
                {tile.fileName}{tile.fileSize ? ` · ${tile.fileSize}` : ''}
            </Typography>

            {(tile.isVideo || tile.isAudio) && !tile.hasMetadata && !summary && (
                <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                    Reading file details…
                </Typography>
            )}

            <MediaMetadataPanel
                summary={summary}
                tile={tile}
                fileName={fileName}
                onFileNameChange={isPrivateRoom() ? undefined : handleFileNameChange}
                onSaveDetails={canSaveDetails(master) ? handleSaveDetails : undefined}
                myPeerId={master.client && master.client.peerId}
                /* All of the room's photos, not only the ones a filter shows. */
                locationHints={() => ({ nearby: nearbyLocations(tile, roomTiles, master), minutesAgo: takenMinutesAgo(tile, master) })}
            />

            {others && (
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
    );
}

PhotoDetails.propTypes = {
    master: PropTypes.object.isRequired,
    tile: PropTypes.object,
    roomTiles: PropTypes.array.isRequired,
    headingId: PropTypes.string,
};

export default PhotoDetails;
