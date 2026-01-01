import assert from 'assert';
import Topology from '../../Topology.js';

describe('Topology', () => {
  let topology;
  let mockPeers;
  let mockUpdateChannel;

  beforeEach(() => {
    mockUpdateChannel = {
      broadcast: () => {},
      send: () => {}
    };
    
    mockPeers = {
      webPeers: new Map(),
      clientsBySessionId: new Map()
    };
    
    topology = new Topology(mockPeers, mockUpdateChannel);
  });

  describe('constructor', () => {
    it('should initialize with peers and updateChannel', () => {
      assert.strictEqual(topology.peers, mockPeers);
      assert.strictEqual(topology.updateChannel, mockUpdateChannel);
      assert(topology.connectionsMap instanceof Map);
    });
  });

  describe('connect', () => {
    it('should set connectionType to p2p for host-to-host connections', () => {
      const fromPeer = {
        networkChain: [
          { 
            ip: '192.168.1.1', 
            type: 'host', 
            typeDetail: 'host', 
            port: 8080,
            network: { ip: '192.168.1.1' }
          }
        ]
      };
      const toPeer = {
        networkChain: [
          { 
            ip: '192.168.1.2', 
            type: 'host', 
            typeDetail: 'host', 
            port: 8080,
            network: { ip: '192.168.1.2' }
          }
        ]
      };
      
      mockPeers.webPeers.set('peer1', fromPeer);
      mockPeers.webPeers.set('peer2', toPeer);
      
      const connection = {
        fromPeerId: 'peer1',
        toPeerId: 'peer2',
        from: '192.168.1.1',
        to: '192.168.1.2',
        fromPort: 8080,
        toPort: 8080,
        infoHash: 'test-hash'
      };
      
      topology.connect(connection);
      
      assert.strictEqual(connection.connectionType, 'p2p');
      assert(connection.id);
    });

    it('should set connectionType to relay for relay connections', () => {
      const fromPeer = {
        networkChain: [
          { 
            ip: '192.168.1.1', 
            type: 'relay', 
            typeDetail: 'relay', 
            port: 8080,
            network: { 
              ip: '192.168.1.1',
              location: { country_flag_emoji: '🇺🇸' }
            }
          }
        ]
      };
      const toPeer = {
        networkChain: [
          { 
            ip: '192.168.1.2', 
            type: 'host', 
            typeDetail: 'host', 
            port: 8080,
            network: { ip: '192.168.1.2' }
          }
        ]
      };
      
      mockPeers.webPeers.set('peer1', fromPeer);
      mockPeers.webPeers.set('peer2', toPeer);
      
      const connection = {
        fromPeerId: 'peer1',
        toPeerId: 'peer2',
        from: '192.168.1.1',
        to: '192.168.1.2',
        fromPort: 8080,
        toPort: 8080,
        infoHash: 'test-hash'
      };
      
      topology.connect(connection);
      
      assert(connection.connectionType.includes('relay'));
    });

    it('should return early if fromPeer not found', () => {
      const connection = {
        fromPeerId: 'nonexistent',
        toPeerId: 'peer2',
        infoHash: 'test-hash'
      };
      
      topology.connect(connection);
      
      assert(!connection.connectionType);
    });

    it('should return early if toPeer not found', () => {
      const fromPeer = {
        networkChain: []
      };
      mockPeers.webPeers.set('peer1', fromPeer);
      
      const connection = {
        fromPeerId: 'peer1',
        toPeerId: 'nonexistent',
        infoHash: 'test-hash'
      };
      
      topology.connect(connection);
      
      assert(!connection.connectionType);
    });
  });
});

