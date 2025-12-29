//-----------------Custom WebTorrent Tracker - ICE Events
const axios = require('axios');
const isLocal = require('is-local-ip');
const _ = require('lodash');

module.exports = class IpTranslator {

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

                const isOnline = true;
                if(isOnline) {

                    const key = '8f125144341210254a52ef8d24bcc4dc';
                    return axios.get('https://api.ipstack.com/' + ip, {
                        params: {
                            access_key: key,
                            hostname: 1,
                            security: 1,
                            output: 'json',
                            fields: 'ip,type,hostname,country_code,city,region_name,location.country_flag_emoji,connection.isp'
                        }
                    })
                        .then(function (response) {
                            const json = response.data;
                            IpTranslator.lookedUpIPs.set(ip, json);
                            return resolve(json);
                        })
                        .catch(function (err) {
                            // Crawling failed...
                            console.error('api.ipstack err' + err);
                            reject(err)
                        });
                } else {

                    Promise.resolve(IpTranslator.createEmptyIpObj(ip));
                }
            }
        });
    }

    static createEmptyIpObj(ip) {
        return {
            "ip": ip,
            "hostname": isLocal(ip) ? 'localhost' : '',
            "country_code": null,
            "region_name": null,
            "location": {
                "country_flag_emoji": null
            }
        };
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