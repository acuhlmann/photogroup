import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';

import { withStyles } from '@mui/styles';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Settings from '@mui/icons-material/Settings';
import Bluetooth from '@mui/icons-material/BluetoothSearching';
import CloseRounded from '@mui/icons-material/CloseRounded';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';

import List from '@mui/material/List';
/*import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import { FixedSizeList } from 'react-window';*/

import Switch from '@mui/material/Switch';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';

import RoomsService from '../RoomsService';
import {format} from 'date-fns';
import Typography from "@mui/material/Typography";
import {withSnackbar} from "../compatibility/withSnackbar";
import update from "immutability-helper";
import Slide from '@mui/material/Slide';

const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="down" ref={ref} {...props} />;
});

const styles = theme => ({
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
});

class SettingsView extends Component {

    constructor(props) {
        super(props);

        const { classes, master } = props;
        this.classes = classes;
        this.master = master;

        Logger.setHandler((messages, context) => {
            const date = format(new Date(), "HH:mm:ss:SSS");
            this.log(date + ' ' + messages[0], context.level.name);
        });

        this.state = {
            messages: [],
            open: false,
            peerId: '',
            showTopology: false, showMe: true, encrypt: false,
            strategyPreference: false, darkMode: props.prefersDarkMode,
        };
        this.logsBeforeMount = [];

        Logger.info('platform ' + navigator.platform + ' cpu ' + navigator.oscpu);

        this.master.emitter.on('addPeerDone', () => {

            const showMe = localStorage.getItem('showMe') || this.state.showMe;
            this.handleShowMeChange(String(showMe) == 'true');

            const showTopology = localStorage.getItem('showTopology') || this.state.showTopology;
            this.handleTopologyChange(String(showTopology) == 'true');

            const encrypt = localStorage.getItem('encrypt') || this.state.encrypt;
            this.handleEncryptChange(String(encrypt) == 'true');

            const strategyPreference = localStorage.getItem('strategyPreference') || this.state.strategyPreference;
            this.handleStrategyPreferenceChange(String(strategyPreference) == 'true');

            const darkMode = localStorage.getItem('darkMode') || this.state.darkMode;
            this.handleDarkModeChange(String(darkMode) == 'true');

            this.setState({peerId: this.master.client.peerId});
            this.checkConnection();
        });
    }

    checkConnection() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if(connection) {
            let type = connection.effectiveType;
            Logger.info("Connection type is " + type);
            this.master.emitter.emit('connectionSpeedType', type);
            this.master.service.updatePeer({
                connectionSpeedType: type
            });
            function updateConnectionStatus() {
                Logger.info("Connection type changed from " + type + " to " + connection.effectiveType);
                type = connection.effectiveType;
                this.master.emitter.emit('connectionSpeedType', type);
                this.master.service.updatePeer({
                    connectionSpeedType: type
                });
            }

            connection.addEventListener('change', updateConnectionStatus.bind(this));
        }
    }

    snack(payload, type = 'info', persist = false) {

        const {enqueueSnackbar, closeSnackbar} = this.props;

        enqueueSnackbar(payload, {
            variant: type,
            persist: persist,
            autoHideDuration: 4000,
            action: (key) => (<Button className={this.props.classes.white} onClick={ () => closeSnackbar(key) } size="small">x</Button>),
            anchorOrigin: {
                vertical: 'bottom',
                horizontal: 'right'
            }
        });
    }

    componentDidMount() {
        this.mounted = true;
        this.logsBeforeMount.forEach(missedMessage => this.log(missedMessage));
        this.logsBeforeMount = [];
    }

    log(message, level) {
        if(this.mounted) {
            const msg = <div key={Math.random()}>
                <Typography variant="caption">{level + ': ' + message}</Typography>
            </div>;
            console.info(level, message);

            if(level === 'DEBUG' || level === 'INFO' || level === 'WARN' || level === 'ERROR') {
                this.setState(state => {
                    const messages = update(state.messages, {$unshift: [msg]});
                    return {messages: messages};
                });
            }
        } else {
            this.logsBeforeMount.push({message: message, level: level});
        }
    }

    showLogs() {
        this.setState({
            open: true
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    async handleReset() {
        await RoomsService.deleteAll();
        this.master.leaveRoomAndReload();
    }

    requestBLE() {

        if(!navigator.bluetooth) {
            Logger.info('navigator.bluetooth not available');
        } else {
            if(navigator.bluetooth.getAvailability && typeof navigator.bluetooth.getAvailability === 'function') {
                navigator.bluetooth.getAvailability()
                    .then(availability => {
                        // availability.value may be kept up-to-date by the UA as long as the availability
                        // object is alive. It is advised for web developers to discard the object as soon
                        // as it's not needed.
                        Logger.info('bluetooth.availability ' + availability);
                    })
                    .catch((e) => {
                        Logger.info('bluetooth.availability.e ' + JSON.stringify(e));
                    });
            } else {
                Logger.info('bluetooth.getAvailability() not available');
            }

            this.requestLES();

            navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                //optionalServices: ['battery_service']
            })
                .then(device => {
                    Logger.info('bluetooth.device ' + device.name + ' ' + device.id);

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
                    Logger.info('Battery percentage is ' + value.getUint8(0));
                })
                .catch(error => {
                    Logger.error('bluetooth.error ' + error.name + ' ' + error.message);
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

                Logger.info(major, minor, pathLossVs1m);
            });
        })
    }

    onDisconnected(event) {
        let device = event.target;
        Logger.info('Device ' + device.name + ' is disconnected.');
    }

    handleBatteryLevelChanged(event) {
        let value = event.target.value.getUint8(0);
        Logger.info('handleBatteryLevelChanges ' + JSON.stringify(event));
        Logger.info('handleBatteryLevelChanges value ' + value);
    }

    handleTopologyChange(value) {
        localStorage.setItem('showTopology', value);
        this.master.emitter.emit('showTopology', value);
        this.setState({showTopology: value});
    };

    handleShowMeChange(value) {
        localStorage.setItem('showMe', value);
        this.master.emitter.emit('showMe', value);
        this.setState({showMe: value});
    };

    handleEncryptChange(value) {
        const field = 'encrypt';
        localStorage.setItem(field, value);
        this.master.emitter.emit(field, value);
        this.setState({[field]: value});
    };

    handleStrategyPreferenceChange(value) {
        const field = 'strategyPreference';
        localStorage.setItem(field, value);
        this.master.emitter.emit(field, value);
        this.setState({[field]: value});
    };

    handleDarkModeChange(value) {
        const field = 'darkMode';
        localStorage.setItem(field, value);
        this.master.emitter.emit(field, value);
        this.setState({[field]: value});
    };

    batchChangeName(event) {

        if(!event.target) return;

        console.log('change name ' + event.target.value);
        this.master.service.updatePeer( {
            name: event.target.value
        });
    }

    render() {
        const {classes} = this.props;

        /*const Row = ({ index, style }) => (
            <ListItem>
                <Typography variant="caption" key={index}>{this.state.messages[index]}</Typography>
            </ListItem>
        );*/

        //const messages = <FixedSizeList height={200} width={300} itemSize={10} itemCount={100}>
        //    {Row}
        //</FixedSizeList>;

        const messages = <List>
            {this.state.messages}
        </List>;

        const {showMe, showTopology, encrypt, strategyPreference, darkMode} = this.state;
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
                    TransitionComponent={Transition}
                    keepMounted
                >
                    <DialogTitle>Settings</DialogTitle>
                    <DialogActions className={classes.vertical}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        onChange={(event) =>
                                            this.handleEncryptChange(event.target.checked)}
                                        checked={encrypt}
                                        value="encrypt"
                                        color="primary"
                                    />
                                }
                                label="Encrypt End-to-end"
                            />
                            <FormGroup row>
                                <FormControlLabel
                                control={
                                    <Switch
                                        onChange={(event) =>
                                            this.handleTopologyChange(event.target.checked)}
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
                                            onChange={(event) =>
                                                this.handleShowMeChange(event.target.checked)}
                                            checked={showMe}
                                            value="showMe"
                                            color="primary"
                                        />
                                    }
                                    label="Me View"
                                />
                            </FormGroup>
                            <FormControlLabel
                                control={
                                    <Switch
                                        onChange={(event) =>
                                            this.handleStrategyPreferenceChange(event.target.checked)}
                                        checked={strategyPreference}
                                        value="strategyPreference"
                                        color="primary"
                                    />
                                }
                                label="Prefer Sequential over Rarest-First Downloading?"
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        onChange={(event) =>
                                            this.handleDarkModeChange(event.target.checked)}
                                        checked={darkMode}
                                        value="darkMode"
                                        color="primary"
                                    />
                                }
                                label="Dark Theme"
                            />
                        <span className={classes.horizontal}>
                            <IconButton
                                aria-haspopup="true"
                                onClick={this.requestBLE.bind(this)}
                                color="inherit"
                            >
                                <Bluetooth />
                            </IconButton>
                            <Button onClick={this.master.restartTrackers.bind(this.master)} color="secondary">
                                restart trackers
                            </Button>
                            <IconButton
                                onClick={this.handleClose.bind(this)}>
                                <CloseRounded />
                            </IconButton>
                        </span>
                    </DialogActions>
                    <DialogContent>
                        <Typography variant="subtitle2">{this.state.urls}</Typography>
                        <Typography variant={"caption"}>v0.3 {this.state.peerId}</Typography>

                        {messages}

                        <Button key='delete' onClick={this.handleReset.bind(this)} color="primary">
                            Del server state
                        </Button>
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
    prefersDarkMode: PropTypes.bool.isRequired,
};

export default withSnackbar(withStyles(styles)(SettingsView));