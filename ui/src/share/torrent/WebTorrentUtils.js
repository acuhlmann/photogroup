/**
 * WebTorrentUtils - Centralized utilities for WebTorrent operations
 * 
 * This module provides workarounds for WebTorrent quirks and common utility functions
 * to ensure consistent behavior across the application.
 */

/**
 * Get a torrent from the WebTorrent client, handling the bug where
 * client.get() returns an empty object {} instead of null for non-existent torrents.
 * 
 * @param {WebTorrent} client - The WebTorrent client instance
 * @param {string} infoHash - The torrent info hash to look up
 * @returns {Torrent|null} The torrent object or null if not found
 */
export function getTorrent(client, infoHash) {
    if (!client || !infoHash) return null;
    
    const torrent = client.get(infoHash);
    
    // WebTorrent bug: client.get() returns empty object {} instead of null
    // for non-existent torrents. Check for the presence of infoHash property
    // to verify it's a valid torrent object.
    if (torrent && torrent.infoHash) {
        return torrent;
    }
    
    return null;
}

/**
 * Extract the base infoHash from a compound ID.
 * Compound IDs are used for multi-file torrents in the format: "baseHash-filePath"
 * 
 * @param {string} infoHash - The info hash (possibly compound)
 * @returns {string|null} The base info hash or null if invalid
 */
export function getBaseInfoHash(infoHash) {
    if (!infoHash || typeof infoHash !== 'string') return null;
    return infoHash.split('-')[0] || null;
}

/**
 * Check if an infoHash is a compound ID (contains file path)
 * 
 * @param {string} infoHash - The info hash to check
 * @returns {boolean} True if it's a compound ID
 */
export function isCompoundInfoHash(infoHash) {
    if (!infoHash || typeof infoHash !== 'string') return false;
    return infoHash.includes('-');
}

/**
 * Extract the file path from a compound infoHash
 * 
 * @param {string} infoHash - The compound info hash
 * @returns {string|null} The file path portion or null if not compound
 */
export function getFilePathFromInfoHash(infoHash) {
    if (!isCompoundInfoHash(infoHash)) return null;
    const parts = infoHash.split('-');
    return parts.slice(1).join('-') || null;
}

/**
 * Get a torrent by its compound or simple infoHash.
 * For compound IDs, extracts the base hash first.
 * 
 * @param {WebTorrent} client - The WebTorrent client instance
 * @param {string} infoHash - The torrent info hash (simple or compound)
 * @returns {Torrent|null} The torrent object or null if not found
 */
export function getTorrentByAnyHash(client, infoHash) {
    const baseHash = getBaseInfoHash(infoHash);
    return getTorrent(client, baseHash);
}

/**
 * Check if a torrent exists in the client
 * 
 * @param {WebTorrent} client - The WebTorrent client instance  
 * @param {string} infoHash - The torrent info hash
 * @returns {boolean} True if torrent exists
 */
export function hasTorrent(client, infoHash) {
    return getTorrent(client, infoHash) !== null;
}

/**
 * Safely remove a torrent from the client
 * 
 * @param {WebTorrent} client - The WebTorrent client instance
 * @param {string} infoHash - The torrent info hash to remove
 * @returns {Promise<string>} Resolves with infoHash when removed
 */
export function removeTorrent(client, infoHash) {
    return new Promise((resolve, reject) => {
        if (!client || !infoHash) {
            reject(new Error('Invalid client or infoHash'));
            return;
        }
        
        const torrent = getTorrent(client, infoHash);
        if (!torrent) {
            // Torrent doesn't exist, resolve anyway
            resolve(infoHash);
            return;
        }
        
        client.remove(infoHash, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(infoHash);
            }
        });
    });
}

/**
 * Extract torrent ID from a "Cannot add duplicate torrent" error message
 * 
 * @param {Error|string} error - The error object or message
 * @returns {string|null} The torrent ID or null if not a duplicate error
 */
export function extractDuplicateTorrentId(error) {
    const msg = error?.message || error;
    if (!msg || typeof msg !== 'string') return null;
    
    if (!msg.includes('Cannot add duplicate')) return null;
    
    const lastIndex = msg.lastIndexOf('torrent ');
    if (lastIndex === -1) return null;
    
    return msg.substring(lastIndex + 8).trim() || null;
}

/**
 * Check if an error is a duplicate torrent error
 * 
 * @param {Error|string} error - The error object or message
 * @returns {boolean} True if it's a duplicate error
 */
export function isDuplicateTorrentError(error) {
    const msg = error?.message || error;
    return typeof msg === 'string' && msg.includes('Cannot add duplicate');
}

export default {
    getTorrent,
    getBaseInfoHash,
    isCompoundInfoHash,
    getFilePathFromInfoHash,
    getTorrentByAnyHash,
    hasTorrent,
    removeTorrent,
    extractDuplicateTorrentId,
    isDuplicateTorrentError
};

