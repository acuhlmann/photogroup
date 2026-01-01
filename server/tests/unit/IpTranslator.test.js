import assert from 'assert';
import IpTranslator from '../../IpTranslator.js';

describe('IpTranslator', () => {
  beforeEach(() => {
    // Initialize lookedUpIPs if it doesn't exist
    if (!IpTranslator.lookedUpIPs) {
      IpTranslator.lookedUpIPs = new Map();
    }
    IpTranslator.reset();
  });

  describe('extractIps', () => {
    it('should extract IPs from request.ips', () => {
      const request = {
        ips: ['192.168.1.1', '10.0.0.1']
      };
      const result = IpTranslator.extractIps(request);
      assert.deepStrictEqual(result, ['192.168.1.1', '10.0.0.1']);
    });

    it('should extract IP from x-real-ip header if ips is empty', () => {
      const request = {
        ips: [],
        headers: {
          'x-real-ip': '192.168.1.100'
        },
        connection: {
          remoteAddress: '10.0.0.1'
        }
      };
      const result = IpTranslator.extractIps(request);
      assert.deepStrictEqual(result, ['192.168.1.100']);
    });

    it('should extract IP from connection.remoteAddress if no header', () => {
      const request = {
        ips: [],
        headers: {},
        connection: {
          remoteAddress: '10.0.0.1'
        }
      };
      const result = IpTranslator.extractIps(request);
      assert.deepStrictEqual(result, ['10.0.0.1']);
    });

    it('should strip ::ffff: prefix from IPv4-mapped IPv6 addresses', () => {
      const request = {
        ips: ['::ffff:192.168.1.1', '::ffff:10.0.0.1']
      };
      const result = IpTranslator.extractIps(request);
      assert.deepStrictEqual(result, ['192.168.1.1', '10.0.0.1']);
    });

    it('should filter out null/undefined IPs', () => {
      const request = {
        ips: ['192.168.1.1', null, undefined, '10.0.0.1']
      };
      const result = IpTranslator.extractIps(request);
      assert.deepStrictEqual(result, ['192.168.1.1', '10.0.0.1']);
    });
  });

  describe('createEmptyIpObj', () => {
    it('should create empty IP object with correct structure', () => {
      const result = IpTranslator.createEmptyIpObj('192.168.1.1');
      assert.strictEqual(result.ip, '192.168.1.1');
      assert.strictEqual(result.hostname, 'localhost');
      assert.strictEqual(result.country_code, null);
      assert.strictEqual(result.city, null);
      assert.strictEqual(result.region_name, null);
      assert.deepStrictEqual(result.location, { country_flag_emoji: null });
      assert.deepStrictEqual(result.connection, { isp: null });
    });

    it('should set hostname to empty string for non-local IPs', () => {
      const result = IpTranslator.createEmptyIpObj('8.8.8.8');
      assert.strictEqual(result.hostname, '');
    });
  });

  describe('getCountryFlagEmoji', () => {
    it('should convert country code to flag emoji', () => {
      const result = IpTranslator.getCountryFlagEmoji('US');
      assert(result !== null);
      assert(typeof result === 'string');
    });

    it('should return null for invalid country code', () => {
      assert.strictEqual(IpTranslator.getCountryFlagEmoji(null), null);
      assert.strictEqual(IpTranslator.getCountryFlagEmoji(''), null);
      assert.strictEqual(IpTranslator.getCountryFlagEmoji('USA'), null);
      assert.strictEqual(IpTranslator.getCountryFlagEmoji('U'), null);
    });

    it('should handle lowercase country codes', () => {
      const upper = IpTranslator.getCountryFlagEmoji('US');
      const lower = IpTranslator.getCountryFlagEmoji('us');
      assert.strictEqual(upper, lower);
    });
  });

  describe('getLookupIp', () => {
    it('should return cached IP if already looked up', async () => {
      const ip = '192.168.1.1';
      const cached = IpTranslator.createEmptyIpObj(ip);
      IpTranslator.lookedUpIPs.set(ip, cached);
      
      const result = await IpTranslator.getLookupIp(ip);
      assert.deepStrictEqual(result, cached);
    });

    it('should return empty IP object for local IPs', async () => {
      const result = await IpTranslator.getLookupIp('127.0.0.1');
      assert.strictEqual(result.ip, '127.0.0.1');
      assert.strictEqual(result.hostname, 'localhost');
    });

    it('should return empty IP object for fd00::1', async () => {
      const result = await IpTranslator.getLookupIp('fd00::1');
      assert.strictEqual(result.ip, 'fd00::1');
      assert.strictEqual(result.hostname, 'localhost');
    });
  });

  describe('enrichNetworkChainIPs', () => {
    it('should enrich network chain with IP lookups', async () => {
      const chain = [
        { ip: '127.0.0.1' },
        { ip: '192.168.1.1' }
      ];
      
      const result = await IpTranslator.enrichNetworkChainIPs(chain);
      assert.strictEqual(result.length, 2);
      assert(result[0].network);
      assert(result[1].network);
      assert.strictEqual(result[0].network.ip, '127.0.0.1');
      assert.strictEqual(result[1].network.ip, '192.168.1.1');
    });
  });

  describe('enrichCandidateIPs', () => {
    it('should enrich candidate IPs with network lookups', async () => {
      const candidates = [
        { ip: '127.0.0.1' },
        { ip: '192.168.1.1' }
      ];
      
      const result = await IpTranslator.enrichCandidateIPs(candidates);
      assert.strictEqual(result.length, 2);
      assert(result[0].network);
      assert(result[1].network);
    });
  });
});

