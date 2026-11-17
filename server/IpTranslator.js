//-----------------Custom WebTorrent Tracker - ICE Events
import axios from 'axios';
import isLocal from 'is-local-ip';
import _ from 'lodash';

export default class IpTranslator {

    // Cache for successfully looked up IPs
    static lookedUpIPs = new Map();
    
    // Map to store pending lookups (to avoid duplicate API calls for same IP)
    static pendingLookups = new Map();
    
    // Rate limit handling: timestamp when we can make API calls again
    static rateLimitCooldownUntil = 0;
    
    // Cooldown period after hitting rate limit (60 seconds)
    static RATE_LIMIT_COOLDOWN_MS = 60000;

    static reset() {
        IpTranslator.lookedUpIPs.clear();
        IpTranslator.pendingLookups.clear();
        IpTranslator.rateLimitCooldownUntil = 0;
    }

    static extractIps(request) {
        let ips = request.ips;
        if(!ips || ips.length < 1) {
            ips = [request.headers['x-real-ip'] || request.connection.remoteAddress];
        }

        //ips = ['::ffff:119.237.92.133', '::ffff:182.239.120.232'];

        ips = ips
            .filter(ip => ip)
            .map(ip => {
                return (ip.substr(0, 7) === "::ffff:") ? ip.substr(7) : ip;
            });

        return ips;
    }

    static shouldSkipLookup(ip) {
        // Skip lookups for:
        // - Local IPs (already handled by isLocal check)
        // - .local addresses (mDNS/local network)
        // - Invalid IP formats
        // - IPv6 link-local addresses
        if (!ip || typeof ip !== 'string') {
            return true;
        }
        
        // Skip .local addresses (mDNS)
        if (ip.includes('.local')) {
            return true;
        }
        
        // Skip IPv6 link-local addresses (fe80::)
        if (ip.startsWith('fe80::') || ip.startsWith('fd00::')) {
            return true;
        }
        
        // Skip if it looks like a UUID or non-IP format
        if (ip.includes('-') && ip.length > 15) {
            return true;
        }
        
        return false;
    }

    /** True when a network object carries place, ISP, or reverse DNS. */
    static isUsefulNetwork(network) {
        if (!network || typeof network !== 'object') return false;
        const isp = network.connection && (network.connection.isp || network.connection.org);
        return !!(network.city || network.country || network.country_code
            || network.hostname || isp);
    }

    /** True while IpTranslator has not finished (or soft-failed) a lookup for this IP. */
    static isLookupPending(network) {
        return !!(network && network.lookupPending);
    }

    /** Keep a prior useful enrichment when a later lookup returns an empty shell. */
    static preferNetwork(existing, incoming) {
        if (IpTranslator.isUsefulNetwork(incoming)) return incoming;
        if (IpTranslator.isUsefulNetwork(existing)) return existing;
        // A settled empty (lookup finished, nothing useful) beats a still-pending shell.
        if (existing && !IpTranslator.isLookupPending(existing) && IpTranslator.isLookupPending(incoming)) {
            return existing;
        }
        return incoming || existing || null;
    }

    /** Remember a useful enrichment so later rate-limit skips still resolve it. */
    static rememberNetwork(ip, network) {
        if (!ip || !IpTranslator.isUsefulNetwork(network)) return;
        const cached = IpTranslator.lookedUpIPs.get(ip);
        if (!IpTranslator.isUsefulNetwork(cached)) {
            IpTranslator.lookedUpIPs.set(ip, network);
        }
    }

    static getCachedIp(ip) {
        return IpTranslator.lookedUpIPs.get(ip) || null;
    }

    static getLookupIp(ip) {
        // Check if already cached
        if (IpTranslator.lookedUpIPs.has(ip)) {
            const ipObj = IpTranslator.lookedUpIPs.get(ip);
            return Promise.resolve(ipObj);
        }

        // Check if there's already a pending lookup for this IP (avoid duplicate API calls)
        if (IpTranslator.pendingLookups.has(ip)) {
            return IpTranslator.pendingLookups.get(ip);
        }

        // Skip certain IPs
        if (isLocal(ip) || ip === 'fd00::1' || IpTranslator.shouldSkipLookup(ip)) {
            const reason = isLocal(ip) ? 'local IP' : (ip === 'fd00::1' ? 'fd00::1' : 'shouldSkipLookup');
            console.log(`[IpTranslator] Skipping lookup for ${ip}: ${reason}`);

            const ipObj = IpTranslator.createEmptyIpObj(ip);
            IpTranslator.lookedUpIPs.set(ip, ipObj);
            return Promise.resolve(ipObj);
        }

        // Create the lookup promise
        const isOnline = process.env.ENABLE_IP_LOOKUP !== 'false';
        if (!isOnline) {
            const ipObj = IpTranslator.createEmptyIpObj(ip);
            IpTranslator.lookedUpIPs.set(ip, ipObj);
            return Promise.resolve(ipObj);
        }

        // Check if we're in global rate limit cooldown
        const now = Date.now();
        if (IpTranslator.rateLimitCooldownUntil > now) {
            const remainingSecs = Math.ceil((IpTranslator.rateLimitCooldownUntil - now) / 1000);
            console.log(`[IpTranslator] Rate limit cooldown active for ${ip}, ${remainingSecs}s remaining`);
            // Fail soft: pending empty shell, not cached — callers must not clobber a
            // previously useful item.network (see preferNetwork in enrich*).
            return Promise.resolve(IpTranslator.createEmptyIpObj(ip, { pending: true }));
        }

        // Using ip-api.com (free tier: 45 requests/minute, no API key required)
        console.log(`[IpTranslator] Making API call for IP: ${ip}`);
        
        const lookupPromise = axios.get('http://ip-api.com/json/' + ip, {
            params: {
                fields: 'status,message,country,countryCode,region,regionName,city,isp,org,as,query,reverse'
            },
            timeout: 5000
        })
            .then(function (response) {
                const json = response.data;
                
                // Check if API call was successful
                if (json.status === 'fail') {
                    console.warn('ip-api.com lookup failed for ' + ip + ':', json.message || 'Unknown error');
                    const ipObj = IpTranslator.createEmptyIpObj(ip);
                    IpTranslator.lookedUpIPs.set(ip, ipObj);
                    IpTranslator.pendingLookups.delete(ip);
                    return ipObj;
                }
                
                // Transform ip-api.com response to match expected format
                const transformed = {
                    ip: json.query || ip,
                    hostname: json.reverse || '',
                    country_code: json.countryCode || null,
                    country: json.country || null,
                    city: json.city || null,
                    region: json.region || null,
                    region_name: json.regionName || null,
                    location: {
                        country_flag_emoji: json.countryCode ? IpTranslator.getCountryFlagEmoji(json.countryCode) : null
                    },
                    connection: {
                        isp: json.isp || json.org || null,
                        org: json.org || null,
                        as: json.as || null
                    }
                };
                
                // Always log successful lookups for debugging
                console.log(`[IpTranslator] API success for ${ip}:`, {
                    city: transformed.city,
                    region: transformed.region_name,
                    country: transformed.country,
                    isp: transformed.connection.isp
                });
                
                IpTranslator.lookedUpIPs.set(ip, transformed);
                IpTranslator.pendingLookups.delete(ip);
                return transformed;
            })
            .catch(function (err) {
                // API call failed - return empty IP object instead of failing
                const isRateLimit = err.response && err.response.status === 403;
                console.warn(`[IpTranslator] API call failed for ${ip}:`, err.message, 
                    err.code ? `(code: ${err.code})` : '',
                    err.response ? `(status: ${err.response.status})` : '',
                    isRateLimit ? '(RATE LIMITED - will retry later)' : '');
                
                const ipObj = IpTranslator.createEmptyIpObj(ip);
                
                // If rate limited, set global cooldown to prevent further API calls
                if (isRateLimit) {
                    IpTranslator.rateLimitCooldownUntil = Date.now() + IpTranslator.RATE_LIMIT_COOLDOWN_MS;
                    console.log(`[IpTranslator] Rate limit hit! Pausing all API calls for ${IpTranslator.RATE_LIMIT_COOLDOWN_MS / 1000} seconds`);
                    // Soft-fail as still pending so the UI can keep "looking up…"
                    ipObj.lookupPending = true;
                } else {
                    // Only cache the result if it's NOT a rate limit error
                    // Rate limited requests should be retried later
                    IpTranslator.lookedUpIPs.set(ip, ipObj);
                }
                
                IpTranslator.pendingLookups.delete(ip);
                return ipObj;
            });

        // Store the pending promise
        IpTranslator.pendingLookups.set(ip, lookupPromise);
        return lookupPromise;
    }

    /**
     * @param {string} ip
     * @param {{ pending?: boolean }} [opts] pending=true → UI may show "looking up…"
     *   (pre-enrich / rate-limit). Settled empties omit the flag or set it false.
     */
    static createEmptyIpObj(ip, { pending = false } = {}) {
        const ipObj = {
            "ip": ip,
            "hostname": isLocal(ip) ? 'localhost' : '',
            "country_code": null,
            "country": null,
            "city": null,
            "region": null,
            "region_name": null,
            "location": {
                "country_flag_emoji": null
            },
            "connection": {
                "isp": null,
                "org": null,
                "as": null
            }
        };
        if (pending) ipObj.lookupPending = true;
        return ipObj;
    }

    static getCountryFlagEmoji(countryCode) {
        // Convert ISO 3166-1 alpha-2 country code to flag emoji
        // Each letter is converted to its regional indicator symbol
        if (!countryCode || countryCode.length !== 2) return null;
        
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt(0));
        
        return String.fromCodePoint(...codePoints);
    }

    static enrichNetworkChainIPs(chain) {
        if (!chain || chain.length === 0) {
            console.log('[IpTranslator] enrichNetworkChainIPs: chain is empty or null');
            return Promise.resolve([]);
        }

        console.log(`[IpTranslator] enrichNetworkChainIPs: processing ${chain.length} items`);
        const ips = chain.map(item => item?.ip).filter(Boolean);
        console.log(`[IpTranslator] enrichNetworkChainIPs: IPs to lookup: ${ips.join(', ')}`);

        // Seed the cache from any useful enrichment already on the chain so a
        // rate-limit skip still resolves the same IP to place/ISP.
        chain.forEach(item => {
            if (item?.ip) IpTranslator.rememberNetwork(item.ip, item.network);
        });

        return Promise.all(chain.map(item => {
            if (!item || !item.ip) {
                return Promise.resolve(null);
            }
            return IpTranslator.getLookupIp(item.ip);
        })).then(results => {
            const values = chain.map((item, index) => {
                if (!item || !item.ip) {
                    return item;
                }
                const previous = item.network;
                // Match by index since we process them in the same order
                let result = results[index];
                if (!(result && result.ip === item.ip)) {
                    result = (results.find(r => r && r.ip === item.ip) || result
                        || IpTranslator.createEmptyIpObj(item.ip));
                }
                item.network = IpTranslator.preferNetwork(previous, result)
                    || IpTranslator.createEmptyIpObj(item.ip);
                IpTranslator.rememberNetwork(item.ip, item.network);
                
                // Always log enrichment results (not just in debug mode)
                if (item.network && (item.network.city || item.network.connection?.isp)) {
                    console.log(`[IpTranslator] Enriched ${item.ip}: city=${item.network.city || 'N/A'}, isp=${item.network.connection?.isp || 'N/A'}`);
                } else if (item.network) {
                    console.log(`[IpTranslator] Enriched ${item.ip}: no location/ISP data (likely local IP or API failed)`);
                }
                
                return item;
            });

            console.log(`[IpTranslator] enrichNetworkChainIPs: completed enrichment for ${values.length} items`);
            return values;
        });
    }

    static enrichCandidateIPs(candidates) {
        if (!candidates || candidates.length === 0) {
            return Promise.resolve([]);
        }

        candidates.forEach(item => {
            if (item?.ip) IpTranslator.rememberNetwork(item.ip, item.network);
        });

        return Promise.all(candidates.map(item => {
            if (!item || !item.ip) {
                return Promise.resolve(null);
            }
            return IpTranslator.getLookupIp(item.ip);
        })).then(results => {
            const values = candidates.map((item, index) => {
                if (!item || !item.ip) {
                    return item;
                }
                const previous = item.network;
                let result = results[index];
                if (!(result && result.ip === item.ip)) {
                    result = (results.find(r => r && r.ip === item.ip) || result
                        || IpTranslator.createEmptyIpObj(item.ip));
                }
                item.network = IpTranslator.preferNetwork(previous, result)
                    || IpTranslator.createEmptyIpObj(item.ip);
                IpTranslator.rememberNetwork(item.ip, item.network);
                return item;
            });

            return values;
        });
    }
};