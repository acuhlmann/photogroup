import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles } from '@material-ui/core/styles';
import ExpansionPanel from '@material-ui/core/ExpansionPanel';
import ExpansionPanelSummary from '@material-ui/core/ExpansionPanelSummary';
import ExpansionPanelDetails from '@material-ui/core/ExpansionPanelDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import { withSnackbar } from 'notistack';

import Graph from 'vis-react';
import Logger from 'js-logger';
import _ from "lodash";
import update from "immutability-helper";
import StringUtil from "../util/StringUtil";

const styles = theme => ({
    typography: {
        useNextVariants: true,
    },
    heading: {
        fontSize: theme.typography.pxToRem(15),
        fontWeight: theme.typography.fontWeightRegular,
    },
    content: {
        padding: '0px 0px 0px 0px',
        width: '100%',
        overflow: 'hidden'
    },
    wordwrap: {
        wordWrap: 'break-word'
    },
});

class TopologyView extends Component {

    constructor(props) {
        super(props);

        this.master = props.master;
        const emitter = props.master.emitter;
        emitter.on('showTopology', value => {
            this.setState({showTopology: value});
        });

        emitter.on('readyToUpload', () => {
            this.setState({
                visible: true
            });
        });

        const self = this;

        const expandedTopology = localStorage.getItem('expandedTopology') || true;
        this.state = {
            visible: false,
            showTopology: false,
            expandedTopology: String(expandedTopology) == 'true',
            graph: {
                nodes: [], edges: []
            },
            options: {

                nodes: {
                    font: {
                        size: 9
                    },
                    //fixed: false
                    //size: 100
                },
                edges: {
                    color: '#000000'
                },
                /*groups: {
                    photogroupServer: {
                        shape: 'icon',
                        icon: {
                            face: 'FontAwesome',
                            code: '\uf233',
                            size: 40,
                            color: '#3F51B5'
                        }
                    }
                },
                physics:{
                    stabilization: {
                        enabled: false,
                        iterations: 1
                    }
                },
                layout: {
                    hierarchical: {
                        enabled:true,
                        //levelSeparation: 80,
                        //nodeSpacing: 100,
                        //treeSpacing: 100,
                        blockShifting: true,
                        edgeMinimization: true,
                        parentCentralization: true,
                        direction: 'UD',        // UD, DU, LR, RL
                        sortMethod: 'hubsize'   // hubsize, directed
                    }
                },
                interaction:{hover:true}*/
            },
            events: {
                select: event => {

                    const {nodes, edges} = event;
                    if(nodes && nodes.length > 0) {

                        if(!nodes[0])
                            return;

                        const id = nodes[0];

                        const node = self.state.graph.nodes.find(node => node.id === id);
                        if(!node)
                            return;

                        let label = '';
                        const network = node.network;
                        if(node.type === 'client') {
                            const platform = StringUtil.slimPlatform(node.peer.originPlatform);
                            label = node.peer.name + '\n' + platform + '\n'
                        } else if(node.type === 'relay') {

                            const values = [...node.relays.values()];
                            const ips = values.map(item => item.ip).join(',');
                            const ports = values.map(item => item.ports).join(',');
                            node.network.ip = ips;
                            label = StringUtil.createNetworkLabel(node.network, '\n');
                            label += (network.transportsLabel ? network.transportsLabel.toLowerCase() : '')
                                + ' ' + ips + ':' + ports;
                            self.setState({
                                selectedNodeLabel: label
                            });
                            return;
                        } else {
                            label = StringUtil.createNetworkLabel(node.network, '\n') + '\n';
                        }
                        if(network.transportsLabel && Array.isArray(network.transportsLabel)) {
                            network.transportsLabel = network.transportsLabel.join(',');
                        }
                        if(network.ports && Array.isArray(network.ports)) {
                            network.ports = network.ports.join(',');
                        }
                        if(!network.ports) {
                            Logger.warn('no ports ' + JSON.stringify(network))
                        }
                        //label += `${network.transportsLabel ? network.transportsLabel.toLowerCase() : ''} ${network.ip}:${network.ports.join(',')}`;
                        label += (network.transportsLabel ? network.transportsLabel.toLowerCase() : '')
                            + ' ' + network.ip + ':' + network.ports;
                        self.setState({
                            selectedNodeLabel: label
                        });

                    } else if(edges && edges.length > 0) {

                        if(!edges[0])
                            return;

                        const id = edges[0];
                        const edge = self.state.graph.edges.find(edge => edge.id === id);
                        if(edge) {
                            let edgeLabel;
                            if(edge.network && edge.network.typeDetail && edge.network.typeDetail.includes('host')) {
                                edge.from = edge.network.ip;
                            }
                            if(edge.type === 'connection') {

                                const conn = edge.network;
                                edgeLabel = `${conn.from}:${conn.fromPort} >> ${conn.to}:${conn.toPort}`
                            } else{
                                edgeLabel = '';//edge.from + ' >> ' + edge.to;
                            }
                            this.setState({
                                selectedNodeLabel: edgeLabel
                            });
                        }
                    }

                    //const seed = self.network.getSeed();
                    //console.log('select ' + seed);
                }
            },
        };

        emitter.on('addPeerDone', () => {

            const myPeerId = this.master.client.peerId;
            const peers = this.master.peers;
            emitter.on('peers', event => {
                const nodes = [];
                const edges = this.state.graph.edges.filter(item => item.type === 'connection');
                peers.items.forEach(peer => {
                    if(peer.networkChain) {

                        const isMe = peer.peerId === myPeerId;

                        const host = this.addHosts(peer, nodes, isMe);
                        const nat = this.addNats(peer, nodes, isMe);
                        const relays = this.addRelays(peer, nodes, isMe);

                        if(nat) {

                            const edge = {
                                from: peer.peerId,
                                to: nat.id || nat.ip,
                                width: 2,
                                dashes: true,
                                arrows: '',
                                color: this.isMeColor(isMe),
                                network: host
                            };
                            edges.push(edge);

                            relays.forEach(relay => {
                                const edge = {
                                    from: nat.id || nat.ip,
                                    to: relay.id || relay.ip,
                                    width: 2,
                                    dashes: true,
                                    arrows: '',
                                    color: this.isMeColor(isMe)
                                };
                                edges.push(edge);
                            });
                        }
                    }
                });
                this.setState({graph: {nodes : nodes, edges: edges}});
            });

            emitter.on('peerConnections', connections => {

                const nodes = this.state.graph.nodes;
                let edges = this.state.graph.edges;

                //remove all connection edges
                const connEdges = edges.filter(item => item.type === 'connection');
                connEdges.forEach(edge => {
                    const index = edges.findIndex(item => item.from === edge.from && item.to === edge.to);
                    edges = update(edges, {$splice: [[index, 1]]});
                });

                //add connection edges in.
                connections.forEach(conn => {

                    const edge = {
                        from: conn.connectionType === 'p2p' ? conn.fromPeerId : conn.from,
                        to: conn.connectionType === 'p2p' ? conn.toPeerId : conn.to,
                        label: conn.connectionType + ' ' + conn.fileName,
                        type: 'connection',
                        network: conn,
                        width: 2,
                        arrows: 'to',
                    };
                    edge.title = edge.label;
                    if(!edges.find(item => item.from === edge.from && item.to === edge.to)) {
                        edges = update(edges, {$push: [edge]});
                    }
                });
                this.setState({graph: {nodes: nodes, edges: edges}});
            });
        });
    }

    addHosts(peer, nodes, isMe) {

        if(nodes.find(item => item.id === peer.peerId)) return;

        const hosts = peer.networkChain.filter(item => item.typeDetail === 'host');
        if(hosts.length > 1) {
            //Logger.warn('multiple hosts found ' + JSON.stringify(hosts));
        }
        const host = hosts.find(item => item.label);
        if(host) {

            const platform = StringUtil.slimPlatform(peer.originPlatform);
            const node = {
                id: peer.peerId,
                label: peer.name || _.truncate(platform), //StringUtil.addEmptySpaces([peer.name, platform]),
                type: 'client',
                shape: 'box',
                peer: peer,
                network: host,
            };
            node.title = node.label;
            node.color = this.isMeColor(isMe);
            node.font = {
                color: this.isMeColorBlack(isMe), strokeWidth: 2
            };
            this.addUserIcon(node, peer.originPlatform, isMe);
            nodes.push(node);
            return host;
        }
    }

    addUserIcon(node, platform, isMe) {
        node.shape = 'icon';
        if(this.isMobile(platform)) {
            node.icon = {
                face: 'FontAwesome',
                code: '\uf10b',
                size: 30,
                color: this.isMeColorBlack(isMe)
            }
        } else {
            node.icon = {
                face: 'FontAwesome',
                code: '\uf108',
                size: 30,
                color: this.isMeColorBlack(isMe)
            }
        }
    }

    isMobile(platform) {
        return platform.indexOf('Mobile') > -1
            || platform.indexOf('Android') > -1
            || platform.indexOf('iOS') > -1;
    }

    addNats(peer, nodes, isMe) {

        const nats = peer.networkChain.filter(item => this.isNatType(item.typeDetail));
        if(nats.length > 1) {
            Logger.warn('multiple nats found ' + JSON.stringify(nats));
        }
        const nat = nats.find(item => item.label);
        if(nat) {

            if(nodes.find(item => item.id === nat.ip)) return nat;
            const node = {
                id: nat.ip,
                label: this.createShortNetworkLabel(nat),
                shape: 'box',
                network: nat,
                peer: peer,
                type: 'nat'
            };
            node.title = node.label;
            node.color = this.isMeColor(isMe);
            node.font = {
                color: this.isMeColorBlack(isMe), strokeWidth: 2
            };
            node.shape = 'image';
            node.image = './firewall.png';
            node.size = 15;
            nodes.push(node);
            return node;
        }
    }

    isNatType(natType) {
        return natType.includes('srflx') || natType.includes('prflx');
    }

    addRelays(peer, nodes, isMe) {

        const relays = peer.networkChain.filter(item => item.typeDetail === 'relay');
        if(relays.length > 1) {
            //Logger.warn('multiple relays found ' + JSON.stringify(relays));
        }
        return relays.map(relay => {

            const shortName = this.createShortNetworkLabel(relay);
            const existing = nodes.find(item => item.id === shortName);
            if(!existing) {

                const node = {
                    id: shortName,
                    label: shortName,
                    relays: new Map([[relay.ip, relay]]),
                    type: 'relay',
                    shape: 'box',
                    network: relay,
                    networks: [relay],
                    peer: peer
                };
                node.title = node.label;
                node.color = this.isMeColor(isMe);
                node.font = {
                    color: this.isMeColorBlack(isMe), strokeWidth: 2
                };
                this.addRelayIcon(node, isMe);
                nodes.push(node);
                return node;

            } else {
                existing.relays.set(relay.ip, relay);
                existing.networks.push(relay);
                return existing;
            }
        }).filter(item => item);
    }

    addRelayIcon(node, isMe) {
        node.shape = 'icon';
        node.icon = {
            face: 'FontAwesome',
            code: '\uf138',
            size: 30,
            color: this.isMeColorBlack(isMe)
        }
    }

    //---

    createShortNetworkLabel(item) {

        return StringUtil.addEmptySpaces([
            item.typeDetail,
            _.get(item, 'network.location.country_flag_emoji'),
            _.truncate((_.get(item, 'network.connection.isp') || item.ip)) + '\n'
        ]);
    }

    isMeColor(isMe) {
        return isMe ? '#F50057' : '#e0e0e0';
    }

    isMeColorBlack(isMe) {
        return isMe ? '#F50057' : '#000000';
    }

    setNetworkInstance = nw => {
        const network = this.network = nw;

        //network.setOptions({
        //    physics: {enabled:false}
        //});

        this.setState({network: network});
    };

    showStatusMessage(selectedNodeLabel, classes) {

        return <Typography variant="caption" align="center" className={classes.wordwrap}>
            <div>{selectedNodeLabel}</div>
        </Typography>
    }

    handleExpand = panel => (event, expanded) => {

        localStorage.setItem(panel, expanded);
        this.setState({
            [panel]: expanded,
        });
    };

    render() {

        const {classes} = this.props;
        const {visible, showTopology, graph, selectedNodeLabel, expandedTopology} = this.state;

        return (
            visible && showTopology ? <ExpansionPanel expanded={expandedTopology}
                                           onChange={this.handleExpand('expandedTopology')}
                                           style={{
                                               marginBottom: '5px'
                                            }}>
                <ExpansionPanelSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography className={classes.heading}>Network Topology</Typography>
                </ExpansionPanelSummary>
                <ExpansionPanelDetails className={classes.content} style={{
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    {this.showStatusMessage(selectedNodeLabel, classes)}
                    <Graph ref={node => this.graph = node} getNetwork={this.setNetworkInstance}
                           graph={graph} options={this.state.options} events={this.state.events}
                           style={{width: "100%", height: "400px"}}/>
                </ExpansionPanelDetails>
            </ExpansionPanel> : ''
        );
    }
}

TopologyView.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withSnackbar(withStyles(styles)(TopologyView));