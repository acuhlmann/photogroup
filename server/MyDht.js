const DHT = require('bittorrent-dht');
const IpTranslator = require('./IpTranslator');

module.exports = class MyDht {

    start() {

        this.dht = new DHT();

        this.dht.listen(20000, () => {
            console.log('now listening')
        });

        this.dht.on('peer', async (peer, infoHash, from) => {
            console.log('found potential peer ' + peer.host + ':' + peer.port + ' through ' + from.address + ':' + from.port);
            const result = await IpTranslator.getLookupIp(item.ip);
            console.log('ip translated ' + JSON.stringify(result));
            console.log('ip translated ');
        });
    }

    lookup(infoHash) {
        this.dht.lookup(infoHash);
    }
};