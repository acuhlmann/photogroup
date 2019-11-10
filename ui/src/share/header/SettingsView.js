import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';

import { withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import IconButton from '@material-ui/core/IconButton';
import Settings from '@material-ui/icons/Settings';
import Bluetooth from '@material-ui/icons/BluetoothSearching';
import CloseRounded from '@material-ui/icons/CloseRounded';
import Dialog from '@material-ui/core/Dialog';
import DialogContent from '@material-ui/core/DialogContent';
import DialogTitle from '@material-ui/core/DialogTitle';
import DialogActions from '@material-ui/core/DialogActions';

import Switch from '@material-ui/core/Switch';
import FormGroup from '@material-ui/core/FormGroup';
import FormControlLabel from '@material-ui/core/FormControlLabel';

import RoomsService from '../RoomsService';
import moment from "moment";
import Typography from "@material-ui/core/Typography/Typography";
import PeersView from "./PeersView";
import QRCodeButton from "./QRCodeButton";

/*function Transition(props) {
    return <Slide direction="down" {...props} />;
}*/

const styles = theme => ({

});

class SettingsView extends Component {

    constructor(props) {
        super(props);

        this.state = {
            messages: [],
            open: false,
            peerId: '',
            //showTopology: false,
            //showOtherPeers: true
        };

        const { classes, master } = props;
        this.classes = classes;
        this.master = master;

        Logger.setHandler((messages, context) => {
            const date = moment().format("HH:mm:ss:SSS");
            this.log(date + ' ' + messages[0], context.level.name);
        });

        this.master.emitter.on('addPeerDone', () => {
            //self.topology.start();
            this.setState({peerId: this.master.client.peerId})
        });
    }

    componentDidMount() {
        this.mounted = true;
    }

    log(message, level) {
        const msg = level + ': ' + message;
        console.log(msg);
        this.state.messages.unshift(msg);
        if(this.mounted) {
            this.setState({messages: this.state.messages});
        }
    }

    showLogs() {
        SettingsView.getAll().then(dom => {
            this.setState({
                urls: dom
            });
        });

        this.setState({
            open: true
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    static handleReset() {
        RoomsService.deleteAll();
    }

    static getAll() {
        return RoomsService.getAll().then(result => {
            let msg = '';
            for (let key in result) {
                //msg += 'Room: ' + key + '\n\n';
                const urls = result[key];
                msg += 'Shared: ' + urls.length + '\n\n';
                urls.forEach(item => {
                    const parsed = window.parsetorrent(item.url);
                    const key = parsed.name + ' ' + parsed.infoHash;
                    msg += key + ' '  + item.secure + '\n';
                });
            }
            return msg;
        });
    }

    requestBLE() {

        if(!navigator.bluetooth) {
            Logger.log('navigator.bluetooth not available');
        } else {
            if(navigator.bluetooth.getAvailability && typeof navigator.bluetooth.getAvailability === 'function') {
                navigator.bluetooth.getAvailability()
                    .then(availability => {
                        // availability.value may be kept up-to-date by the UA as long as the availability
                        // object is alive. It is advised for web developers to discard the object as soon
                        // as it's not needed.
                        Logger.log('bluetooth.availability ' + availability);
                    })
                    .catch((e) => {
                        Logger.log('bluetooth.availability.e ' + JSON.stringify(e));
                    });
            } else {
                Logger.log('bluetooth.getAvailability() not available');
            }

            this.requestLES();

            navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                //optionalServices: ['battery_service']
            })
                .then(device => {
                    Logger.log('bluetooth.device ' + device.name + ' ' + device.id);

                    // Set up event listener for when device gets disconnected.
                    device.addEventListener('gattserverdisconnected', this.onDisconnected);

                    return device.gatt.connect();
                })
                .then(server => {
                    // Getting Battery Service...
                    return server.getPrimaryService('battery_service');
                })
                .then(service => {
                    // Getting Battery Level Characteristic...
                    return service.getCharacteristic('battery_level');
                })
                .then(characteristic => {
                    // Set up event listener for when characteristic value changes.
                    characteristic.addEventListener('characteristicvaluechanged',
                        this.handleBatteryLevelChanged);
                    // Reading Battery Level...
                    return characteristic.readValue();
                })
                .then(value => {
                    Logger.log('Battery percentage is ' + value.getUint8(0));
                })
                .catch(error => {
                    Logger.log('bluetooth.error ' + error.name + ' ' + error.message);
                });
        }
    }

    requestLES() {
        if(!navigator.bluetooth.requestLEScan && typeof navigator.bluetooth.requestLEScan !== 'function')
            return;

        navigator.bluetooth.requestLEScan({
            filters: [{manufacturerData: {0x004C: {dataPrefix: new Uint8Array([
                            0x02, 0x15, // iBeacon identifier.
                            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15  // My beacon UUID.
                        ])}}}],
            keepRepeatedDevices: true
        }).then(() => {
            navigator.bluetooth.addEventListener('advertisementreceived', event => {
                let appleData = event.manufacturerData.get(0x004C);
                if (appleData.byteLength !== 23) {
                    // Isn’t an iBeacon.
                    return;
                }
                let major = appleData.getUint16(18, false);
                let minor = appleData.getUint16(20, false);
                let txPowerAt1m = -appleData.getInt8(22);
                let pathLossVs1m = txPowerAt1m - event.rssi;

                Logger.log(major, minor, pathLossVs1m);
            });
        })
    }

    onDisconnected(event) {
        let device = event.target;
        Logger.log('Device ' + device.name + ' is disconnected.');
    }

    handleBatteryLevelChanged(event) {
        let value = event.target.value.getUint8(0);
        Logger.log('handleBatteryLevelChanges ' + JSON.stringify(event));
        Logger.log('handleBatteryLevelChanges value ' + value);
    }

    restartTrackers() {
        this.master.client.torrents.forEach(torrent => {

            const isReady = torrent.discovery && torrent.discovery.tracker
                && torrent.discovery.tracker._trackers && torrent.discovery.tracker._trackers.length > 0;
            if(isReady) {

                const trackers = torrent.discovery.tracker._trackers;

                //Logger.info('torrent trackers ready ' + trackers.length);

                trackers.forEach(tracker => {
                    const announceUrl = tracker.announceUrl;
                    Logger.log('restartTrackers ' + announceUrl);
                    tracker._openSocket();
                });
            }
        });
    }

    handleTopologyChange(event) {
        this.master.emitter.emit('showTopology', event.target.checked);
    };

    handleOtherPeersChange(event) {
        this.master.emitter.emit('showOtherPeers', event.target.checked);
    };

    render() {
        const messageContent = this.state.messages
            .map((value, index) => (
            <div key={index}>
                {value}
            </div>
            ))
            .concat(
                <Button key='delete' onClick={SettingsView.handleReset.bind(this)} color="primary">
                    Del server state
                </Button>);

        const messages = <div>
                <Typography variant="subtitle2">{this.state.urls}</Typography>
                <Typography variant="caption">{messageContent}</Typography>
            </div>;

        const {showTopology, showOtherPeers} = this.state;

        return (
            <div>
                <IconButton
                    aria-haspopup="true"
                    onClick={this.showLogs.bind(this)}
                    color="inherit"
                >
                    <Settings />
                </IconButton>

                <Dialog
                    open={this.state.open}
                    onClose={this.handleClose.bind(this)}
                    //TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogTitle>Settings</DialogTitle>
                    <DialogActions>
                        <QRCodeButton />
                        <IconButton
                            aria-haspopup="true"
                            onClick={this.requestBLE.bind(this)}
                            color="inherit"
                        >
                            <Bluetooth />
                        </IconButton>
                        <Button onClick={this.restartTrackers.bind(this)} color="secondary">
                            wt track
                        </Button>
                        <PeersView emitter={this.master.emitter} />
                        <IconButton
                            onClick={this.handleClose.bind(this)}
                        >
                            <CloseRounded />
                        </IconButton>
                    </DialogActions>
                    <DialogContent>
                        <FormGroup row>
                            <FormControlLabel
                                control={
                                    <Switch
                                        onChange={this.handleTopologyChange.bind(this)}
                                        checked={showTopology}
                                        value="showTopology"
                                        color="primary"
                                    />
                                }
                                label="Topology View"
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        onChange={this.handleOtherPeersChange.bind(this)}
                                        checked={showOtherPeers}
                                        value="showOtherPeers"
                                        color="primary"
                                    />
                                }
                                label="Other Peers View"
                            />
                        </FormGroup>
                        <Typography variant={"caption"}>v2 {this.state.peerId}</Typography>
                        {messages}
                    </DialogContent>
                </Dialog>
            </div>
        );
    }
}

SettingsView.propTypes = {
    classes: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(SettingsView);