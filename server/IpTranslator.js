//-----------------Custom WebTorrent Tracker - ICE Events
import axios from 'axios';
import isLocal from 'is-local-ip';
import _ from 'lodash';

export default class IpTranslator {

    static reset() {
        IpTranslator.lookedUpIPs.clear();
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

    static getLookupIp(ip) {

        return new Promise((resolve, reject) => {
            if (IpTranslator.lookedUpIPs.has(ip)) {

                return resolve(IpTranslator.lookedUpIPs.get(ip));

            } else if(isLocal(ip) || ip === 'fd00::1') {

                const ipObj = IpTranslator.createEmptyIpObj(ip);
                IpTranslator.lookedUpIPs.set(ip, ipObj);
                return resolve(ipObj);

            } else {

                // Using ip-api.com (free tier: 45 requests/minute, no API key required)
                // Alternative free services: ipapi.co (30k/month), ipwhois.io (10k/month)
                const isOnline = true;
                if(isOnline) {
                    
                    return axios.get('https://ip-api.com/json/' + ip, {
                        params: {
                            fields: 'status,message,country,countryCode,region,regionName,city,isp,org,as,query,reverse'
                        },
                        timeout: 5000 // 5 second timeout
                    })
                        .then(function (response) {
                            const json = response.data;
                            
                            // Transform ip-api.com response to match expected format
                            const transformed = {
                                ip: json.query || ip,
                                hostname: json.reverse || '',
                                country_code: json.countryCode || null,
                                city: json.city || null,
                                region_name: json.regionName || null,
                                location: {
                                    country_flag_emoji: json.countryCode ? IpTranslator.getCountryFlagEmoji(json.countryCode) : null
                                },
                                connection: {
                                    isp: json.isp || json.org || null
                                }
                            };
                            
                            IpTranslator.lookedUpIPs.set(ip, transformed);
                            return resolve(transformed);
                        })
                        .catch(function (err) {
                            // API call failed - return empty IP object instead of failing
                            console.warn('ip-api.com lookup failed for ' + ip + ':', err.message);
                            const ipObj = IpTranslator.createEmptyIpObj(ip);
                            IpTranslator.lookedUpIPs.set(ip, ipObj);
                            return resolve(ipObj);
                        });
                } else {
                    const ipObj = IpTranslator.createEmptyIpObj(ip);
                    IpTranslator.lookedUpIPs.set(ip, ipObj);
                    return resolve(ipObj);
                }
            }
        });
    }

    static createEmptyIpObj(ip) {
        return {
            "ip": ip,
            "hostname": isLocal(ip) ? 'localhost' : '',
            "country_code": null,
            "city": null,
            "region_name": null,
            "location": {
                "country_flag_emoji": null
            },
            "connection": {
                "isp": null
            }
        };
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

        return Promise.all(chain.map(item => IpTranslator.getLookupIp(item.ip))).then(results => {

            const values = chain.map(item => {
                item.network = results.find(result => result.ip === item.ip);
                if(!item.network) {
                    item.network = this.createEmptyIpObj(item.ip);
                }
                return item;
            });

            return values;
        });
    }

    static enrichCandidateIPs(candidates) {

        return Promise.all(candidates.map(item => IpTranslator.getLookupIp(item.ip))).then(results => {

            const values = candidates.map(item => {
                //_.merge(item, results.find(result => result.ip === item.ip));
                item.network = results.find(result => result.ip === item.ip);
                return item;
            });

            return values;
        });
    }
};