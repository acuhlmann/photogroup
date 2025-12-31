// Suppress console output before loading app
require('../test-setup');

const request = require('supertest');
const assert = require('assert');
const {app, started} = require('../../app');

describe('P2P Flow Integration Tests', () => {
    let testRoomId;
    let peer1, peer2;

    before(async () => {
        await started;
        testRoomId = 'integration-room-' + Date.now();
        
        peer1 = {
            peerId: 'peer1-' + Date.now(),
            sessionId: 'session1-' + Date.now(),
            originPlatform: 'Chrome 100.0 on Windows 10',
            name: 'Peer 1'
        };

        peer2 = {
            peerId: 'peer2-' + Date.now(),
            sessionId: 'session2-' + Date.now(),
            originPlatform: 'Firefox 100.0 on Linux',
            name: 'Peer 2'
        };
    });

    describe('Complete P2P Photo Sharing Flow', () => {
        it('should handle full flow: create room, join, add photo, share', async () => {
            // Step 1: Peer 1 creates a room
            const createResponse = await request(app)
                .post('/api/rooms/')
                .send({
                    id: testRoomId,
                    peer: peer1
                })
                .expect(200);

            assert(createResponse.body.hasOwnProperty('photos'), 'Response should have photos');
            assert(createResponse.body.hasOwnProperty('peers'), 'Response should have peers');
            assert(createResponse.body.peers.length === 1, 'Should have one peer');

            // Step 2: Peer 2 joins the room
            const joinResponse = await request(app)
                .post(`/api/rooms/${testRoomId}`)
                .send({
                    peer: peer2
                })
                .expect(200);

            assert(joinResponse.body.peers.length === 2, 'Should have two peers');

            // Step 3: Peer 1 adds a photo
            const photoHash = 'photo-hash-' + Date.now();
            const addPhotoResponse = await request(app)
                .post(`/api/rooms/${testRoomId}/photos/`)
                .send({
                    sessionId: peer1.sessionId,
                    photos: [{
                        infoHash: photoHash,
                        peerId: peer1.peerId,
                        name: 'test-photo.jpg',
                        length: 2048
                    }]
                })
                .expect(200);

            assert(addPhotoResponse.body.length === 1, 'Should have one photo');
            assert(addPhotoResponse.body[0].infoHash === photoHash, 'Photo hash should match');

            // Step 4: Verify photo appears in room
            const roomResponse = await request(app)
                .get(`/api/rooms/${testRoomId}`)
                .expect(200);

            assert(roomResponse.body.photos.length === 1, 'Room should have one photo');
            assert(roomResponse.body.photos[0].infoHash === photoHash, 'Photo hash should match');

            // Step 5: Add owner for peer 2
            const addOwnerResponse = await request(app)
                .post(`/api/rooms/${testRoomId}/photos/owners/`)
                .send([{
                    infoHash: photoHash,
                    peerId: peer2.peerId,
                    loading: false
                }])
                .expect(200);

            assert(typeof addOwnerResponse.body === 'boolean', 'Should return boolean');

            // Step 6: Create connection
            const connectionResponse = await request(app)
                .post(`/api/rooms/${testRoomId}/connections`)
                .send({
                    infoHash: photoHash,
                    fileName: 'test-photo.jpg',
                    peerId: peer2.peerId
                })
                .expect(200);

            assert(connectionResponse.body === true, 'Should return true');

            // Step 7: Update owner loading status
            const updateOwnerResponse = await request(app)
                .put(`/api/rooms/${testRoomId}/photos/owners/`)
                .send([{
                    infoHash: photoHash,
                    peerId: peer2.peerId,
                    loading: true
                }])
                .expect(200);

            assert(updateOwnerResponse.body === true, 'Should return true');

            // Step 8: Disconnect
            const disconnectResponse = await request(app)
                .delete(`/api/rooms/${testRoomId}/connections`)
                .send({
                    infoHash: photoHash
                })
                .expect(200);

            assert(disconnectResponse.body === true, 'Should return true');
        });

        it('should handle multiple photos in a room', async () => {
            const roomId = 'multi-photo-room-' + Date.now();
            const peer = {
                peerId: 'multi-peer-' + Date.now(),
                sessionId: 'multi-session-' + Date.now(),
                originPlatform: 'Chrome 100.0',
                name: 'Multi Photo Peer'
            };

            // Create room
            await request(app)
                .post('/api/rooms/')
                .send({
                    id: roomId,
                    peer: peer
                })
                .expect(200);

            // Add multiple photos
            const photos = [
                {
                    infoHash: 'hash1-' + Date.now(),
                    peerId: peer.peerId,
                    name: 'photo1.jpg',
                    length: 1024
                },
                {
                    infoHash: 'hash2-' + Date.now(),
                    peerId: peer.peerId,
                    name: 'photo2.jpg',
                    length: 2048
                },
                {
                    infoHash: 'hash3-' + Date.now(),
                    peerId: peer.peerId,
                    name: 'photo3.jpg',
                    length: 3072
                }
            ];

            const response = await request(app)
                .post(`/api/rooms/${roomId}/photos/`)
                .send({
                    sessionId: peer.sessionId,
                    photos: photos
                })
                .expect(200);

            assert(response.body.length === 3, 'Should have three photos');

            // Verify all photos are in room
            const roomResponse = await request(app)
                .get(`/api/rooms/${roomId}`)
                .expect(200);

            assert(roomResponse.body.photos.length === 3, 'Room should have three photos');
        });

        it('should handle peer updates', async () => {
            const roomId = 'update-room-' + Date.now();
            const peer = {
                peerId: 'update-peer-' + Date.now(),
                sessionId: 'update-session-' + Date.now(),
                originPlatform: 'Chrome 100.0',
                name: 'Original Name'
            };

            // Create room
            await request(app)
                .post('/api/rooms/')
                .send({
                    id: roomId,
                    peer: peer
                })
                .expect(200);

            // Update peer name
            const updateResponse = await request(app)
                .put(`/api/rooms/${roomId}/peers/${peer.peerId}`)
                .send({
                    name: 'Updated Name'
                })
                .expect(200);

            assert(updateResponse.body === true, 'Should return true');
        });
    });
});

