// Test IP Translation End-to-End Flow
import '../test-setup.js';

import request from 'supertest';
import assert from 'assert';
import { app, started } from '../../app.js';
import IpTranslator from '../../IpTranslator.js';
import axios from 'axios';

describe('IP Translation Integration', () => {
    let testRoomId;
    let testPeer;

    // Mock axios for controlled testing
    let originalGet;
    let axiosGetCalls = [];

    before(async () => {
        await started;
        
        // Reset IpTranslator state before tests
        IpTranslator.reset();
    });

    beforeEach(() => {
        testRoomId = 'test-room-ip-' + Date.now();
        testPeer = {
            peerId: 'test-peer-ip-' + Date.now(),
            sessionId: 'test-session-ip-' + Date.now(),
            originPlatform: 'Chrome 100.0 on Windows 10',
            name: 'Test Peer',
            networkChain: [
                { ip: '192.168.1.1', port: 12345, type: 'host', typeDetail: 'host', transport: 'UDP' },
                { ip: '8.8.8.8', port: 54321, type: 'srflx', typeDetail: 'Normal NAT srflx', transport: 'UDP' },
                { ip: '74.125.200.127', port: 3478, type: 'relay', typeDetail: 'relay', transport: 'UDP' }
            ]
        };

        axiosGetCalls = [];
        originalGet = axios.get;
        
        // Mock axios to return predictable data for public IPs
        axios.get = function(url, config) {
            axiosGetCalls.push({ url, config });
            const ip = url.split('/').pop();
            
            // Simulate ip-api.com response for public IPs
            if (ip === '8.8.8.8') {
                return Promise.resolve({
                    data: {
                        status: 'success',
                        query: '8.8.8.8',
                        country: 'United States',
                        countryCode: 'US',
                        region: 'CA',
                        regionName: 'California',
                        city: 'Mountain View',
                        isp: 'Google LLC',
                        org: 'Google Public DNS',
                        as: 'AS15169 Google LLC',
                        reverse: 'dns.google'
                    }
                });
            } else if (ip === '74.125.200.127') {
                return Promise.resolve({
                    data: {
                        status: 'success',
                        query: '74.125.200.127',
                        country: 'United States',
                        countryCode: 'US',
                        region: 'CA',
                        regionName: 'California',
                        city: 'Mountain View',
                        isp: 'Google LLC',
                        org: 'Google Inc.',
                        as: 'AS15169 Google LLC',
                        reverse: 'googleturns.com'
                    }
                });
            } else {
                // Unknown IP - return failure
                return Promise.resolve({
                    data: {
                        status: 'fail',
                        message: 'unknown IP'
                    }
                });
            }
        };
    });

    afterEach(() => {
        axios.get = originalGet;
        IpTranslator.reset();
    });

    describe('networkChain enrichment via Peers API', () => {
        it('should enrich public IPs with geolocation data when creating a room with peer', async () => {
            // Create a room with a peer that has networkChain
            const response = await request(app)
                .post('/api/rooms/')
                .send({
                    id: testRoomId,
                    peer: testPeer
                })
                .expect(200);

            // Check that the peer was created
            assert(response.body.peers, 'Response should have peers');
            assert(Array.isArray(response.body.peers), 'Peers should be an array');
            
            // Check that networkChain items have network property initialized
            const createdPeer = response.body.peers.find(p => p.peerId === testPeer.peerId);
            assert(createdPeer, 'Created peer should be in response');
            assert(createdPeer.networkChain, 'Peer should have networkChain');
            assert.strictEqual(createdPeer.networkChain.length, 3, 'NetworkChain should have 3 items');

            // Wait for async enrichment to complete
            await new Promise(resolve => setTimeout(resolve, 500));

            // Verify API calls were made for public IPs (not local IPs)
            const publicIpCalls = axiosGetCalls.filter(call => 
                call.url.includes('8.8.8.8') || call.url.includes('74.125.200.127')
            );
            assert(publicIpCalls.length >= 2, 
                `Should make API calls for public IPs, got ${publicIpCalls.length} calls. All calls: ${axiosGetCalls.map(c => c.url).join(', ')}`);

            // Check that local IP was NOT looked up
            const localIpCalls = axiosGetCalls.filter(call => call.url.includes('192.168.1.1'));
            assert.strictEqual(localIpCalls.length, 0, 'Should not make API call for local IP 192.168.1.1');
        });

        it('should skip lookup for mDNS .local addresses', async () => {
            const peerWithMdns = {
                ...testPeer,
                peerId: 'mdns-peer-' + Date.now(),
                sessionId: 'mdns-session-' + Date.now(),
                networkChain: [
                    { ip: 'some-uuid-1234.local', port: 12345, type: 'host', typeDetail: 'host', transport: 'UDP' },
                    { ip: '8.8.8.8', port: 54321, type: 'srflx', typeDetail: 'Normal NAT srflx', transport: 'UDP' }
                ]
            };

            await request(app)
                .post('/api/rooms/')
                .send({
                    id: 'test-room-mdns-' + Date.now(),
                    peer: peerWithMdns
                })
                .expect(200);

            // Wait for enrichment
            await new Promise(resolve => setTimeout(resolve, 300));

            // .local address should be skipped
            const localCalls = axiosGetCalls.filter(call => call.url.includes('.local'));
            assert.strictEqual(localCalls.length, 0, 'Should not make API call for .local addresses');

            // But public IP should be looked up
            const publicCalls = axiosGetCalls.filter(call => call.url.includes('8.8.8.8'));
            assert.strictEqual(publicCalls.length, 1, 'Should make API call for public IP');
        });

        it('should update peer with enriched network data when updating', async () => {
            // Create room first
            await request(app)
                .post('/api/rooms/')
                .send({
                    id: testRoomId,
                    peer: { ...testPeer, networkChain: [] }
                })
                .expect(200);

            // Reset call tracking
            axiosGetCalls = [];

            // Update peer with networkChain
            await request(app)
                .put(`/api/rooms/${testRoomId}/peers/${testPeer.peerId}`)
                .send({
                    networkChain: testPeer.networkChain
                })
                .expect(200);

            // Wait for enrichment
            await new Promise(resolve => setTimeout(resolve, 300));

            // Verify public IPs were looked up
            const publicIpCalls = axiosGetCalls.filter(call => 
                call.url.includes('8.8.8.8') || call.url.includes('74.125.200.127')
            );
            assert(publicIpCalls.length >= 2, 'Should make API calls for public IPs on update');
        });
    });

    describe('IpTranslator.enrichNetworkChainIPs', () => {
        it('should add network property with geolocation data to chain items', async () => {
            const chain = [
                { ip: '8.8.8.8', port: 54321, type: 'srflx', typeDetail: 'Normal NAT srflx' },
                { ip: '74.125.200.127', port: 3478, type: 'relay', typeDetail: 'relay' }
            ];

            const enriched = await IpTranslator.enrichNetworkChainIPs(chain);

            assert.strictEqual(enriched.length, 2, 'Should return same number of items');

            // Check first item is enriched
            const firstItem = enriched[0];
            assert(firstItem.network, 'First item should have network property');
            assert.strictEqual(firstItem.network.ip, '8.8.8.8', 'Network IP should match');
            assert.strictEqual(firstItem.network.city, 'Mountain View', 'Should have city');
            assert.strictEqual(firstItem.network.country, 'United States', 'Should have country');
            assert.strictEqual(firstItem.network.country_code, 'US', 'Should have country code');
            assert.strictEqual(firstItem.network.connection.isp, 'Google LLC', 'Should have ISP');
            assert(firstItem.network.location.country_flag_emoji, 'Should have country flag emoji');

            // Check second item is also enriched
            const secondItem = enriched[1];
            assert(secondItem.network, 'Second item should have network property');
            assert.strictEqual(secondItem.network.city, 'Mountain View', 'Should have city');
        });

        it('should cache lookups to avoid duplicate API calls', async () => {
            const chain1 = [{ ip: '8.8.8.8', port: 54321, type: 'srflx', typeDetail: 'srflx' }];
            const chain2 = [{ ip: '8.8.8.8', port: 12345, type: 'srflx', typeDetail: 'srflx' }];

            await IpTranslator.enrichNetworkChainIPs(chain1);
            const callsAfterFirst = axiosGetCalls.length;

            await IpTranslator.enrichNetworkChainIPs(chain2);
            const callsAfterSecond = axiosGetCalls.length;

            assert.strictEqual(callsAfterSecond, callsAfterFirst, 
                'Second call should use cache, not make new API request');
        });

        it('should dedupe concurrent requests for the same IP', async () => {
            // Simulate a chain with duplicate IPs (like relay servers)
            const chainWithDuplicates = [
                { ip: '8.8.8.8', port: 54321, type: 'relay', typeDetail: 'relay' },
                { ip: '8.8.8.8', port: 12345, type: 'relay', typeDetail: 'relay' },
                { ip: '8.8.8.8', port: 3478, type: 'relay', typeDetail: 'relay' },
                { ip: '74.125.200.127', port: 3478, type: 'relay', typeDetail: 'relay' }
            ];

            const enriched = await IpTranslator.enrichNetworkChainIPs(chainWithDuplicates);

            // Should only make 2 API calls (one for each unique IP)
            const uniqueApiCalls = new Set(axiosGetCalls.map(c => c.url));
            assert.strictEqual(uniqueApiCalls.size, 2, 
                `Should only make API calls for unique IPs, got ${uniqueApiCalls.size} unique calls from ${axiosGetCalls.length} total`);

            // All items should still be enriched
            assert.strictEqual(enriched.length, 4, 'All chain items should be returned');
            enriched.forEach(item => {
                assert(item.network, `Item with IP ${item.ip} should have network property`);
                assert(item.network.city, `Item with IP ${item.ip} should have city`);
            });
        });

        it('should preserve original chain item properties after enrichment', async () => {
            const chain = [
                { 
                    ip: '8.8.8.8', 
                    port: 54321, 
                    type: 'srflx', 
                    typeDetail: 'Normal NAT srflx',
                    transport: 'UDP',
                    customProperty: 'custom-value'
                }
            ];

            const enriched = await IpTranslator.enrichNetworkChainIPs(chain);

            const item = enriched[0];
            assert.strictEqual(item.ip, '8.8.8.8', 'Should preserve ip');
            assert.strictEqual(item.port, 54321, 'Should preserve port');
            assert.strictEqual(item.type, 'srflx', 'Should preserve type');
            assert.strictEqual(item.typeDetail, 'Normal NAT srflx', 'Should preserve typeDetail');
            assert.strictEqual(item.transport, 'UDP', 'Should preserve transport');
            assert.strictEqual(item.customProperty, 'custom-value', 'Should preserve custom properties');
            assert(item.network, 'Should add network property');
        });
    });

    describe('UI data format compatibility', () => {
        it('should provide network data in format expected by StringUtil.createNetworkLabel', async () => {
            const chain = [{ ip: '8.8.8.8', port: 54321, type: 'srflx', typeDetail: 'Normal NAT srflx' }];
            const enriched = await IpTranslator.enrichNetworkChainIPs(chain);
            
            const item = enriched[0];
            const network = item.network;

            // These are the fields accessed by StringUtil.createNetworkLabel
            assert(network.hasOwnProperty('ip'), 'Should have network.ip');
            assert(network.hasOwnProperty('city'), 'Should have network.city');
            assert(network.hasOwnProperty('region_name'), 'Should have network.region_name');
            assert(network.hasOwnProperty('country'), 'Should have network.country');
            assert(network.location, 'Should have network.location');
            assert(network.location.hasOwnProperty('country_flag_emoji'), 'Should have network.location.country_flag_emoji');
            assert(network.connection, 'Should have network.connection');
            assert(network.connection.hasOwnProperty('isp'), 'Should have network.connection.isp');
            assert(network.connection.hasOwnProperty('org'), 'Should have network.connection.org');
        });

        it('should gracefully degrade to just IP when API fails or is rate limited', async () => {
            // Mock a rate-limited API response
            const originalGet = axios.get;
            axios.get = function() {
                const err = new Error('Request failed with status code 403');
                err.response = { status: 403 };
                err.code = 'ERR_BAD_REQUEST';
                return Promise.reject(err);
            };

            try {
                IpTranslator.reset(); // Clear cache
                
                const chain = [{ ip: '203.0.113.1', port: 54321, type: 'srflx', typeDetail: 'Normal NAT srflx' }];
                const enriched = await IpTranslator.enrichNetworkChainIPs(chain);
                
                const item = enriched[0];
                
                // Item should still have its original IP
                assert.strictEqual(item.ip, '203.0.113.1', 'Should preserve original IP');
                
                // Network object should exist with the IP
                assert(item.network, 'Should have network property even on failure');
                assert.strictEqual(item.network.ip, '203.0.113.1', 'Network should have IP');
                
                // Location/ISP should be null (graceful degradation)
                assert.strictEqual(item.network.city, null, 'City should be null on API failure');
                assert.strictEqual(item.network.country, null, 'Country should be null on API failure');
                assert.strictEqual(item.network.connection.isp, null, 'ISP should be null on API failure');
                
                // IP should NOT be cached when rate limited (so it can be retried)
                assert(!IpTranslator.lookedUpIPs.has('203.0.113.1'), 
                    'Rate-limited IP should NOT be cached for later retry');
            } finally {
                axios.get = originalGet;
            }
        });
    });
});

