/**
 * Unit tests for WebTorrentUtils
 */
import { describe, it, expect, vi } from 'vitest';
import {
    getTorrent,
    getBaseInfoHash,
    isCompoundInfoHash,
    getFilePathFromInfoHash,
    getTorrentByAnyHash,
    hasTorrent,
    extractDuplicateTorrentId,
    isDuplicateTorrentError
} from '../WebTorrentUtils';

describe('WebTorrentUtils', () => {
    describe('getTorrent', () => {
        it('should return null when client is null', () => {
            expect(getTorrent(null, 'abc123')).toBeNull();
        });

        it('should return null when infoHash is null', () => {
            const mockClient = { get: vi.fn() };
            expect(getTorrent(mockClient, null)).toBeNull();
        });

        it('should return null when infoHash is empty string', () => {
            const mockClient = { get: vi.fn() };
            expect(getTorrent(mockClient, '')).toBeNull();
        });

        it('should return null when client.get returns empty object (WebTorrent bug)', () => {
            const mockClient = { get: vi.fn().mockReturnValue({}) };
            expect(getTorrent(mockClient, 'abc123')).toBeNull();
            expect(mockClient.get).toHaveBeenCalledWith('abc123');
        });

        it('should return null when client.get returns object without infoHash', () => {
            const mockClient = { get: vi.fn().mockReturnValue({ name: 'test' }) };
            expect(getTorrent(mockClient, 'abc123')).toBeNull();
        });

        it('should return torrent when it has valid infoHash', () => {
            const mockTorrent = { infoHash: 'abc123', name: 'test' };
            const mockClient = { get: vi.fn().mockReturnValue(mockTorrent) };
            expect(getTorrent(mockClient, 'abc123')).toBe(mockTorrent);
        });

        it('should return null when client.get returns null', () => {
            const mockClient = { get: vi.fn().mockReturnValue(null) };
            expect(getTorrent(mockClient, 'abc123')).toBeNull();
        });
    });

    describe('getBaseInfoHash', () => {
        it('should return null for null input', () => {
            expect(getBaseInfoHash(null)).toBeNull();
        });

        it('should return null for undefined input', () => {
            expect(getBaseInfoHash(undefined)).toBeNull();
        });

        it('should return null for empty string', () => {
            expect(getBaseInfoHash('')).toBeNull();
        });

        it('should return null for non-string input', () => {
            expect(getBaseInfoHash(123)).toBeNull();
            expect(getBaseInfoHash({})).toBeNull();
            expect(getBaseInfoHash([])).toBeNull();
        });

        it('should return the same hash for simple infoHash', () => {
            expect(getBaseInfoHash('abc123def456')).toBe('abc123def456');
        });

        it('should return base hash for compound infoHash', () => {
            expect(getBaseInfoHash('abc123def456-path/to/file.jpg')).toBe('abc123def456');
        });

        it('should handle multiple dashes in path', () => {
            expect(getBaseInfoHash('abc123-path/to/file-name.jpg')).toBe('abc123');
        });
    });

    describe('isCompoundInfoHash', () => {
        it('should return false for null', () => {
            expect(isCompoundInfoHash(null)).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(isCompoundInfoHash(undefined)).toBe(false);
        });

        it('should return false for simple infoHash', () => {
            expect(isCompoundInfoHash('abc123def456')).toBe(false);
        });

        it('should return true for compound infoHash', () => {
            expect(isCompoundInfoHash('abc123-path/to/file.jpg')).toBe(true);
        });

        it('should return false for non-string input', () => {
            expect(isCompoundInfoHash(123)).toBe(false);
        });
    });

    describe('getFilePathFromInfoHash', () => {
        it('should return null for simple infoHash', () => {
            expect(getFilePathFromInfoHash('abc123def456')).toBeNull();
        });

        it('should return file path from compound infoHash', () => {
            expect(getFilePathFromInfoHash('abc123-path/to/file.jpg')).toBe('path/to/file.jpg');
        });

        it('should handle paths with dashes', () => {
            expect(getFilePathFromInfoHash('abc123-path/to/file-name.jpg')).toBe('path/to/file-name.jpg');
        });

        it('should return null for null input', () => {
            expect(getFilePathFromInfoHash(null)).toBeNull();
        });
    });

    describe('getTorrentByAnyHash', () => {
        it('should extract base hash and call getTorrent', () => {
            const mockTorrent = { infoHash: 'abc123', name: 'test' };
            const mockClient = { get: vi.fn().mockReturnValue(mockTorrent) };
            
            const result = getTorrentByAnyHash(mockClient, 'abc123-path/to/file.jpg');
            
            expect(result).toBe(mockTorrent);
            expect(mockClient.get).toHaveBeenCalledWith('abc123');
        });

        it('should work with simple hash', () => {
            const mockTorrent = { infoHash: 'abc123', name: 'test' };
            const mockClient = { get: vi.fn().mockReturnValue(mockTorrent) };
            
            const result = getTorrentByAnyHash(mockClient, 'abc123');
            
            expect(result).toBe(mockTorrent);
            expect(mockClient.get).toHaveBeenCalledWith('abc123');
        });
    });

    describe('hasTorrent', () => {
        it('should return true when torrent exists', () => {
            const mockTorrent = { infoHash: 'abc123', name: 'test' };
            const mockClient = { get: vi.fn().mockReturnValue(mockTorrent) };
            
            expect(hasTorrent(mockClient, 'abc123')).toBe(true);
        });

        it('should return false when torrent does not exist', () => {
            const mockClient = { get: vi.fn().mockReturnValue({}) };
            
            expect(hasTorrent(mockClient, 'abc123')).toBe(false);
        });

        it('should return false for null client', () => {
            expect(hasTorrent(null, 'abc123')).toBe(false);
        });
    });

    describe('extractDuplicateTorrentId', () => {
        it('should return null for non-duplicate error', () => {
            const error = new Error('Some other error');
            expect(extractDuplicateTorrentId(error)).toBeNull();
        });

        it('should extract torrent ID from duplicate error', () => {
            const error = new Error('Cannot add duplicate torrent abc123def456');
            expect(extractDuplicateTorrentId(error)).toBe('abc123def456');
        });

        it('should return null for null input', () => {
            expect(extractDuplicateTorrentId(null)).toBeNull();
        });

        it('should work with string input', () => {
            expect(extractDuplicateTorrentId('Cannot add duplicate torrent xyz789')).toBe('xyz789');
        });
    });

    describe('isDuplicateTorrentError', () => {
        it('should return true for duplicate error', () => {
            const error = new Error('Cannot add duplicate torrent abc123');
            expect(isDuplicateTorrentError(error)).toBe(true);
        });

        it('should return false for other errors', () => {
            const error = new Error('Some other error');
            expect(isDuplicateTorrentError(error)).toBe(false);
        });

        it('should work with string input', () => {
            expect(isDuplicateTorrentError('Cannot add duplicate torrent')).toBe(true);
            expect(isDuplicateTorrentError('Normal error')).toBe(false);
        });

        it('should return false for null', () => {
            expect(isDuplicateTorrentError(null)).toBe(false);
        });
    });
});

