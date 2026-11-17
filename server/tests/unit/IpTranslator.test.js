import assert from 'assert';
import axios from 'axios';
import IpTranslator from '../../IpTranslator.js';

describe('IpTranslator', () => {
  beforeEach(() => {
    // Reset IpTranslator state before each test
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
      assert.strictEqual(result.country, null);
      assert.strictEqual(result.city, null);
      assert.strictEqual(result.region, null);
      assert.strictEqual(result.region_name, null);
      assert.deepStrictEqual(result.location, { country_flag_emoji: null });
      assert.deepStrictEqual(result.connection, { isp: null, org: null, as: null });
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

    it('should handle empty candidates array', async () => {
      const result = await IpTranslator.enrichCandidateIPs([]);
      assert.deepStrictEqual(result, []);
    });

    it('should handle null/undefined candidates', async () => {
      const result = await IpTranslator.enrichCandidateIPs([null, undefined]);
      assert.strictEqual(result.length, 2);
    });
  });

  describe('getLookupIp with API call', () => {
    let originalGet;
    let axiosGetCalls;

    beforeEach(() => {
      axiosGetCalls = [];
      originalGet = axios.get;
      axios.get = function(url, config) {
        axiosGetCalls.push({ url, config });
        return Promise.resolve({
          data: {
            status: 'success',
            query: '24.48.0.1',
            country: 'Canada',
            countryCode: 'CA',
            region: 'QC',
            regionName: 'Quebec',
            city: 'Montreal',
            zip: 'H1K',
            lat: 45.6085,
            lon: -73.5493,
            timezone: 'America/Toronto',
            isp: 'Le Groupe Videotron Ltee',
            org: 'Videotron Ltee',
            as: 'AS5769 Videotron Ltee',
            reverse: 'example.com'
          }
        });
      };
    });

    afterEach(() => {
      axios.get = originalGet;
      axiosGetCalls = [];
    });

    it('should call ip-api.com with correct URL and parameters', async () => {
      const ip = '24.48.0.1';
      await IpTranslator.getLookupIp(ip);
      
      assert.strictEqual(axiosGetCalls.length, 1);
      assert.strictEqual(axiosGetCalls[0].url, 'http://ip-api.com/json/24.48.0.1');
      assert.deepStrictEqual(axiosGetCalls[0].config.params.fields, 
        'status,message,country,countryCode,region,regionName,city,isp,org,as,query,reverse');
    });

    it('should transform API response correctly', async () => {
      const ip = '24.48.0.1';
      const result = await IpTranslator.getLookupIp(ip);
      
      assert.strictEqual(result.ip, '24.48.0.1');
      assert.strictEqual(result.country, 'Canada');
      assert.strictEqual(result.country_code, 'CA');
      assert.strictEqual(result.city, 'Montreal');
      assert.strictEqual(result.region, 'QC');
      assert.strictEqual(result.region_name, 'Quebec');
      assert.strictEqual(result.hostname, 'example.com');
      assert.strictEqual(result.connection.isp, 'Le Groupe Videotron Ltee');
      assert.strictEqual(result.connection.org, 'Videotron Ltee');
      assert.strictEqual(result.connection.as, 'AS5769 Videotron Ltee');
      assert(result.location.country_flag_emoji !== null);
    });

    it('should handle API failure response', async () => {
      axios.get = function() {
        return Promise.resolve({
          data: {
            status: 'fail',
            message: 'invalid query'
          }
        });
      };

      const ip = 'invalid.ip';
      const result = await IpTranslator.getLookupIp(ip);
      
      assert.strictEqual(result.ip, 'invalid.ip');
      assert.strictEqual(result.country, null);
      assert.strictEqual(result.city, null);
      assert.strictEqual(result.connection.isp, null);
    });

    it('should handle network errors gracefully', async () => {
      axios.get = function() {
        return Promise.reject(new Error('Network error'));
      };

      const ip = '8.8.8.8';
      const result = await IpTranslator.getLookupIp(ip);
      
      // Should return empty IP object on error
      assert.strictEqual(result.ip, '8.8.8.8');
      assert.strictEqual(result.country, null);
      assert.strictEqual(result.city, null);
    });

    it('should cache API results', async () => {
      const ip = '24.48.0.1';
      await IpTranslator.getLookupIp(ip);
      const firstCallCount = axiosGetCalls.length;
      
      // Second call should use cache
      await IpTranslator.getLookupIp(ip);
      assert.strictEqual(axiosGetCalls.length, firstCallCount);
    });
  });

  describe('enrichNetworkChainIPs with API data', () => {
    let originalGet;

    beforeEach(() => {
      originalGet = axios.get;
      axios.get = function(url) {
        const ip = url.split('/').pop();
        return Promise.resolve({
          data: {
            status: 'success',
            query: ip,
            country: 'United States',
            countryCode: 'US',
            region: 'CA',
            regionName: 'California',
            city: 'San Francisco',
            isp: 'Example ISP',
            org: 'Example Org',
            as: 'AS12345 Example AS'
          }
        });
      };
    });

    afterEach(() => {
      axios.get = originalGet;
    });

    it('should enrich network chain with API data', async () => {
      const chain = [
        { ip: '8.8.8.8', typeDetail: 'srflx' },
        { ip: '1.1.1.1', typeDetail: 'host' }
      ];
      
      const result = await IpTranslator.enrichNetworkChainIPs(chain);
      
      assert.strictEqual(result.length, 2);
      assert(result[0].network);
      assert(result[1].network);
      assert.strictEqual(result[0].network.ip, '8.8.8.8');
      assert.strictEqual(result[0].network.country, 'United States');
      assert.strictEqual(result[0].network.city, 'San Francisco');
      assert.strictEqual(result[0].network.region_name, 'California');
      assert.strictEqual(result[0].network.connection.isp, 'Example ISP');
      assert.strictEqual(result[1].network.ip, '1.1.1.1');
    });

    it('should preserve original chain item properties', async () => {
      const chain = [
        { ip: '8.8.8.8', typeDetail: 'srflx', port: 12345 }
      ];
      
      const result = await IpTranslator.enrichNetworkChainIPs(chain);
      
      assert.strictEqual(result[0].typeDetail, 'srflx');
      assert.strictEqual(result[0].port, 12345);
      assert(result[0].network);
    });

    it('should handle empty chain', async () => {
      const result = await IpTranslator.enrichNetworkChainIPs([]);
      assert.deepStrictEqual(result, []);
    });

    it('should handle chain with null items', async () => {
      const chain = [
        { ip: '8.8.8.8' },
        null,
        { ip: '1.1.1.1' }
      ];
      
      const result = await IpTranslator.enrichNetworkChainIPs(chain);
      assert.strictEqual(result.length, 3);
      assert(result[0].network);
      assert(result[2].network);
    });
  });

  describe('sticky enrichment / rate-limit fail-soft', () => {
    let originalGet;

    const useful = {
      ip: '203.0.113.50',
      hostname: '',
      country_code: 'US',
      country: 'United States',
      city: 'Los Angeles',
      region: 'CA',
      region_name: 'California',
      location: { country_flag_emoji: '🇺🇸' },
      connection: { isp: 'LogicWeb Inc', org: 'LogicWeb Inc', as: null }
    };

    afterEach(() => {
      if (originalGet) axios.get = originalGet;
    });

    it('isUsefulNetwork / preferNetwork keep place over empty shells', () => {
      assert.strictEqual(IpTranslator.isUsefulNetwork(useful), true);
      assert.strictEqual(IpTranslator.isUsefulNetwork(IpTranslator.createEmptyIpObj('203.0.113.50')), false);
      assert.strictEqual(IpTranslator.preferNetwork(useful, IpTranslator.createEmptyIpObj('203.0.113.50')), useful);
      assert.strictEqual(IpTranslator.preferNetwork(null, useful), useful);
    });

    it('does not overwrite a useful chain enrichment when rate-limited', async () => {
      originalGet = axios.get;
      axios.get = () => {
        const err = new Error('Request failed with status code 403');
        err.response = { status: 403 };
        return Promise.reject(err);
      };

      const chain = [{
        ip: '203.0.113.50',
        port: 35036,
        type: 'srflx',
        network: { ...useful }
      }];

      IpTranslator.rateLimitCooldownUntil = Date.now() + 60000;
      const result = await IpTranslator.enrichNetworkChainIPs(chain);

      assert.strictEqual(result[0].network.city, 'Los Angeles');
      assert.strictEqual(result[0].network.connection.isp, 'LogicWeb Inc');
      assert.strictEqual(IpTranslator.getCachedIp('203.0.113.50').city, 'Los Angeles');
    });

    it('reuses cached place/ISP for a new port of the same IP under cooldown', async () => {
      IpTranslator.lookedUpIPs.set('203.0.113.50', useful);
      IpTranslator.rateLimitCooldownUntil = Date.now() + 60000;

      const chain = [{ ip: '203.0.113.50', port: 40080, type: 'srflx' }];
      const result = await IpTranslator.enrichNetworkChainIPs(chain);

      assert.strictEqual(result[0].port, 40080);
      assert.strictEqual(result[0].network.city, 'Los Angeles');
      assert.strictEqual(result[0].network.connection.isp, 'LogicWeb Inc');
    });
  });
});

