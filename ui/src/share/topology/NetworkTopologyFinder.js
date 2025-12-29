import Logger from 'js-logger';
import {parse} from "sdp-transform/lib";
import Peer from 'simple-peer';

export default class NetworkTopologyFinder {

    constructor(service, emitter) {

        this.service = service;
        this.emitter = emitter;
    }

    static buildSdpNetworkChainString(sdp) {
        const jsonSdp = parse(sdp);
        if(jsonSdp.media[0] && jsonSdp.media[0].candidates) {
            const msg = jsonSdp.media[0].candidates.map(cand => cand.type + ' ' + cand.ip + ':' + cand.port + '>>');
            return msg
        }
        return '';
    }

    start(iceServers) {
        const scope = this;

        const candidates = {};

        const peer = new Peer({ initiator: true, trickle: true, config: iceServers });
        const pc = peer._pc;

        let calledNetwork = false;
        this.listenToPcEvents(pc);

        pc.createDataChannel('discoveryChannel');

        let msg;
        peer.on('signal', function (e) {
            msg = NetworkTopologyFinder.buildSdpNetworkChainString(e.sdp);
            Logger.debug('Peer.signal ' + msg);
            scope.emitter.emit('topStateMessage', msg);
        });

        pc.onicecandidate = function (e) {
            if(e.candidate) {
                Logger.debug('Peer.onicecandidate.candidate ' + e.candidate.candidate);
            }

            const sdp = e.target.localDescription.sdp;
            msg = NetworkTopologyFinder.buildSdpNetworkChainString(sdp);
            Logger.debug('Peer.onicecandidate.sdp ' + msg);
            scope.emitter.emit('topStateMessage', msg);

            const firstChain = NetworkTopologyFinder.translateSdp(sdp);
            scope.emitter.emit('localNetwork', firstChain);
            if(!calledNetwork && firstChain.length >= 3) {
                calledNetwork = true;

                if(scope.service.hasRoom) {

                    scope.service.updatePeer({networkChain: firstChain}).then(() => {

                        Logger.info('addNetwork no 1');
                    });

                } else {
                    scope.service.saveNetwork(firstChain);
                }
            }

            if (e.candidate && e.candidate.candidate.indexOf('srflx') !== -1) {
                const cand = parseCandidate(e.candidate.candidate);
                const route = cand.relatedAddress + ':' + cand.relatedPort + ' >> '
                    +cand.type + ' ' + cand.ip + ':' + cand.port;
                Logger.debug('route ' + route);
                scope.emitter.emit('topStateMessage', route);
                if (!candidates[cand.relatedPort]) candidates[cand.relatedPort] = [];
                candidates[cand.relatedPort].push(cand.port);
            } else if (!e.candidate) {
                Logger.debug('candidates ' + JSON.stringify(candidates));
                if (Object.keys(candidates).length >= 1) {

                    Logger.debug('candidates ' + candidates[Object.keys(candidates)[0]]);
                    const ports = candidates[Object.keys(candidates)[0]];
                    const natType = ports.length === 1 ? 'Normal NAT' : 'Symmetric NAT';
                    Logger.debug('natType ' + natType);

                    const networkChain = NetworkTopologyFinder.translateSdp(pc.localDescription.sdp, natType);
                    scope.emitter.emit('localNetwork', networkChain);
                    if(scope.service.hasRoom) {
                        scope.service.updatePeer({networkChain: networkChain}).then(() => {

                            Logger.info('addNetwork no 2');

                            scope.emitter.emit('pcEvent', 'icegatheringstatechange', '');
                            scope.emitter.emit('pcEvent', 'iceconnectionstatechange', '');
                            scope.emitter.emit('pcEvent', 'signalingstatechange', '');

                            //this is now in Uploader
                            scope.emitter.emit('topStateMessage', '');
                        });
                    } else {
                        scope.service.saveNetwork(networkChain);
                    }

                    //pc.close();
                    peer.destroy();

                    //scope.emitter.emit('topStateMessage', msg + '\nRegistering Peer');
                    //scope.emitter.emit('pcEvent', 'icegatheringstatechange', '');
                    //scope.emitter.emit('pcEvent', 'iceconnectionstatechange', '');
                    //scope.emitter.emit('pcEvent', 'signalingstatechange', '');
                }
            }
        };
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer));

        //---credits to https://webrtchacks.com/symmetric-nat/
        // parseCandidate from https://github.com/fippo/sdp
        function parseCandidate(line) {
            var parts;
            // Parse both variants.
            if (line.indexOf('a=candidate:') === 0) {
                parts = line.substring(12).split(' ');
            } else {
                parts = line.substring(10).split(' ');
            }

            var candidate = {
                foundation: parts[0],
                component: parts[1],
                protocol: parts[2].toLowerCase(),
                priority: parseInt(parts[3], 10),
                ip: parts[4],
                port: parseInt(parts[5], 10),
                // skip parts[6] == 'typ'
                type: parts[7]
            };

            for (var i = 8; i < parts.length; i += 2) {
                switch (parts[i]) {
                    case 'raddr':
                        candidate.relatedAddress = parts[i + 1];
                        break;
                    case 'rport':
                        candidate.relatedPort = parseInt(parts[i + 1], 10);
                        break;
                    case 'tcptype':
                        candidate.tcpType = parts[i + 1];
                        break;
                    default: // Unknown extensions are silently ignored.
                        break;
                }
            }
            return candidate;
        }
    }

    listenToPcEvents(pc) {
        const self = this;
        pc.addEventListener('icegatheringstatechange', event => {
            const state = event.target.iceGatheringState;
            self.emitter.emit('pcEvent', event.type, state);
        });
        pc.addEventListener('signalingstatechange', event => {
            const state = event.target.signalingState;
            self.emitter.emit('pcEvent', event.type, state);
        });
        pc.addEventListener('iceconnectionstatechange', event => {
            const state = event.target.iceConnectionState;
            self.emitter.emit('pcEvent', event.type, state);
        });
    }


    static translateSdp(sdp, natType) {

        NetworkTopologyFinder.typeDetailsyIp = new Map();
        natType = natType || '';
        const jsonSdp = parse(sdp);

        if(!jsonSdp.media[0] || !jsonSdp.media[0].candidates) {
            return false;
        }

        const all = jsonSdp.media[0].candidates
            .map(item => {

                const typeDetail = item.type === 'srflx' || item.type === 'prflx' ? natType + ' ' + item.type : item.type;
                NetworkTopologyFinder.typeDetailsyIp.set(item.ip, typeDetail);

                return {
                    ip: item.ip,
                    port: item.port,
                    transport: item.transport,
                    type: item.type,
                    typeDetail: typeDetail
                }
            });

        return all;
    }
}