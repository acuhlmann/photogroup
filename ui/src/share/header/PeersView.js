import React, {Component} from 'react';
import PropTypes from 'prop-types';

import Badge from '@material-ui/core/Badge';
import PeopleRounded from '@material-ui/icons/PeopleRounded';
import PeopleOutline from '@material-ui/icons/PeopleOutline';
import IconButton from "@material-ui/core/IconButton/IconButton";
import Dialog from "@material-ui/core/Dialog/Dialog";
import DialogContent from "@material-ui/core/DialogContent/DialogContent";
import DialogActions from "@material-ui/core/DialogActions/DialogActions";
import Button from "@material-ui/core/Button/Button";
import Slide from '@material-ui/core/Slide';
import Typography from '@material-ui/core/Typography';

function Transition(props) {
    return <Slide direction="down" {...props} />;
}

export default class PeersView extends Component {

    constructor(props) {
        super(props);

        this.state = {
            peerId: '',
            numPeers: -1,
            sseConnections: -1,
            ips: [],
            p2p: [],
            content: [],
            open: false
        };

        const { emitter } = props;
        emitter.on('numPeers', (numPeers) => {
            this.setState({
                numPeers: numPeers,
                p2p: this.extractPeers(window.client)
            });
        });
        emitter.on('sseConnections', (value) => {
            this.setState({
                sseConnections: value,
            });
        });

        emitter.on('webPeers', peers => {
            this.setState({
                ips: Object.values(peers).map(peer => peer.ips)
            });
        });

        emitter.on('urls', urls => {
            this.setState({
                content: urls
            });
        });

        emitter.on('deleted', infoHash => {
            this.setState({
                p2p: this.extractPeers(window.client)
            });
        }, this);

        emitter.on('update', torrent => {
            this.setState({
                p2p: this.extractPeers(window.client)
            });
        });

        emitter.on('torrentDone', torrent => {
            this.setState({
                p2p: this.extractPeers(window.client)
            });
        });
    }

    extractPeers(client) {
        this.setState({
            peerId: client.peerId
        });
        return client.torrents
            .map(torrent => {
                return {
                    infoHash: torrent.infoHash,
                    fileName: torrent.name,
                    peers: Object.values(torrent._peers).map(peer => {
                        const conn = peer.conn;
                        const localAddr = conn.localAddress + ':' + conn.localPort;
                        const remoteAddr = conn.remoteAddress + ':' + conn.remotePort;
                        return {
                            status: {
                                iceGatheringState: conn._pc ? conn._pc.iceGatheringState : '',
                                iceConnectionState: conn._pc ? conn._pc.iceConnectionState : '',
                                signalingState: conn._pc ? conn._pc.signalingState : '',
                                readyState: conn._channel ? conn._channel.readyState : ''
                            },
                            peerId: conn.id,
                            localAddr: localAddr,
                            remoteAddr: remoteAddr,
                            remoteFamily: conn.remoteFamily
                        }
                    })
                };
            })
    }

    show(open) {

        if(open) {
            this.setState({
                p2p: this.extractPeers(window.client)
            });
        }

        this.setState({
            open: open
        });
    }

    render() {
        const { ips, p2p, content } = this.state;

        const p2pPeers = p2p.map((torrent, index) => {

            return <ul key={index}>
                <Typography variant="caption">{torrent.fileName}</Typography> {
                    torrent.peers.map((peer, index) => {
                        const status = Object.values(peer.status).join(' ');
                        //let divider = peer.ip ? ':' : '';
                        return <li key={index}>
                            <Typography variant="caption">{peer.ip} {peer.localAddr}>>{peer.remoteAddr} {status}</Typography>
                        </li>
                    })
                }
            </ul>
        });

        const uiPeers = ips.map((node, index) => {

            return <ul key={index}>
                    {
                        node.map((ip, index) => {
                            let divider = index < node.length -1 ? ' >> ' : '';
                            return <li key={index}>
                                <Typography variant="caption">{ip.location.country_flag_emoji} {ip.hostname}
                                {ip.ip} {ip.country_code} {ip.region_name} {divider}</Typography></li>
                        })
                    }
                    </ul>
                });

        const contentDom = content.map((url, index) => {

            url.sharedBy = url.sharedBy ? url.sharedBy : {};

            return <li key={index}>
                    <Typography variant="caption">
                        {url.ips} {url.originPlatform} peerId {url.sharedBy.originPlatform} infoHash {url.hash}
                    </Typography>
                </li>
        });

        return (
            <div>
                <div>
                    <IconButton
                        onClick={this.show.bind(this, true)}>
                        <Badge badgeContent={this.state.numPeers} color="primary" >
                            <PeopleRounded />
                        </Badge>
                    </IconButton>
                </div>
                <div>
                    <IconButton
                        onClick={this.show.bind(this, true)}>
                        <Badge badgeContent={this.state.sseConnections} color="secondary">
                            <PeopleOutline />
                        </Badge>
                    </IconButton>
                </div>

                <Dialog
                    open={this.state.open}
                    onClose={this.show.bind(this, false)}
                    aria-labelledby="alert-dialog-title"
                    aria-describedby="alert-dialog-description"
                    //TransitionComponent={Transition}                    
                    keepMounted>
                        
                    <DialogContent>
                        <div>
                            <Typography variant="caption">Peer Id: {this.state.peerId}</Typography>
                            <Typography variant="overline">WebRTC Peers</Typography>
                            {p2pPeers}
                            <Typography variant="overline">photogroup.network Peers</Typography>
                            {uiPeers}
                            <Typography variant="overline">Content</Typography>
                            <ul>{contentDom}</ul>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={this.show.bind(this, false)} color="primary">
                            Close
                        </Button>
                    </DialogActions>
                </Dialog>
            </div>
        );
    }
}

PeersView.propTypes = {
    emitter: PropTypes.object.isRequired,
};