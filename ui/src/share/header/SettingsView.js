import React, { useState, useEffect, useRef, useCallback } from 'react';
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

/* global __APP_VERSION__ */

const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="down" ref={ref} {...props} />;
});

function getAppVersionString() {
    const base = (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) ? __APP_VERSION__ : 'dev';
    const build = import.meta?.env?.VITE_APP_VERSION;
    return build ? `${base}.${build}` : base;
}

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

function SettingsView(props) {
    const {classes, master, enqueueSnackbar, closeSnackbar, prefersDarkMode} = props;
    const masterRef = useRef(master);
    masterRef.current = master;

    const [messages, setMessages] = useState([]);
    const [open, setOpen] = useState(false);
    const [peerId, setPeerId] = useState('');
    const [showTopology, setShowTopology] = useState(true);
    const [showMe, setShowMe] = useState(true);
    const [encrypt, setEncrypt] = useState(false);
    const [strategyPreference, setStrategyPreference] = useState(false);
    const [darkMode, setDarkMode] = useState(prefersDarkMode);
    const logsBeforeMountRef = useRef([]);
    const mountedRef = useRef(false);

    const log = useCallback((message, level) => {
        if(mountedRef.current) {
            const msg = <div key={Math.random()}>
                <Typography variant="caption">{level + ': ' + message}</Typography>
            </div>;
            console.info(level, message);

            if(level === 'DEBUG' || level === 'INFO' || level === 'WARN' || level === 'ERROR') {
                setMessages(state => update(state, {$unshift: [msg]}));
            }
        } else {
            logsBeforeMountRef.current.push({message: message, level: level});
        }
    }, []);

    useEffect(() => {
        Logger.setHandler((messages, context) => {
            const date = format(new Date(), "HH:mm:ss:SSS");
            log(date + ' ' + messages[0], context.level.name);
        });

        Logger.info('platform ' + navigator.platform + ' cpu ' + navigator.oscpu);

        const handleAddPeerDone = () => {
            const showMeValue = localStorage.getItem('showMe') || showMe;
            handleShowMeChange(String(showMeValue) == 'true');

            const showTopologyValue = localStorage.getItem('showTopology');
            const showTopologyVal = showTopologyValue !== null ? showTopologyValue === 'true' : showTopology;
            handleTopologyChange(showTopologyVal);

            const encryptValue = localStorage.getItem('encrypt') || encrypt;
            handleEncryptChange(String(encryptValue) == 'true');

            const strategyPreferenceValue = localStorage.getItem('strategyPreference') || strategyPreference;
            handleStrategyPreferenceChange(String(strategyPreferenceValue) == 'true');

            const darkModeValue = localStorage.getItem('darkMode') || darkMode;
            handleDarkModeChange(String(darkModeValue) == 'true');

            setPeerId(masterRef.current.client.peerId);
            checkConnection();
        };

        master.emitter.on('addPeerDone', handleAddPeerDone);

        return () => {
            master.emitter.removeListener('addPeerDone', handleAddPeerDone);
        };
    }, [showMe, showTopology, encrypt, strategyPreference, darkMode, log]);

    const checkConnection = useCallback(() => {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if(connection) {
            let type = connection.effectiveType;
            Logger.info("Connection type is " + type);
            masterRef.current.emitter.emit('connectionSpeedType', type);
            masterRef.current.service.updatePeer({
                connectionSpeedType: type
            });
            const updateConnectionStatus = () => {
                Logger.info("Connection type changed from " + type + " to " + connection.effectiveType);
                type = connection.effectiveType;
                masterRef.current.emitter.emit('connectionSpeedType', type);
                masterRef.current.service.updatePeer({
                    connectionSpeedType: type
                });
            };

            connection.addEventListener('change', updateConnectionStatus);
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        logsBeforeMountRef.current.forEach(missedMessage => log(missedMessage.message, missedMessage.level));
        logsBeforeMountRef.current = [];
    }, [log]);

    const showLogs = useCallback(() => {
        setOpen(true);
    }, []);

    const handleClose = useCallback(() => {
        setOpen(false);
    }, []);

    const handleReset = useCallback(async () => {
        await RoomsService.deleteAll();
        masterRef.current.leaveRoomAndReload();
    }, []);

    const onDisconnected = useCallback((event) => {
        let device = event.target;
        Logger.info('Device ' + device.name + ' is disconnected.');
    }, []);

    const handleBatteryLevelChanged = useCallback((event) => {
        let value = event.target.value.getUint8(0);
        Logger.info('handleBatteryLevelChanges ' + JSON.stringify(event));
        Logger.info('handleBatteryLevelChanges value ' + value);
    }, []);

    const requestLES = useCallback(() => {
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
                    // Isn't an iBeacon.
                    return;
                }
                let major = appleData.getUint16(18, false);
                let minor = appleData.getUint16(20, false);
                let txPowerAt1m = -appleData.getInt8(22);
                let pathLossVs1m = txPowerAt1m - event.rssi;

                Logger.info(major, minor, pathLossVs1m);
            });
        })
    }, []);

    const requestBLE = useCallback(() => {
        if(!navigator.bluetooth) {
            Logger.info('navigator.bluetooth not available');
        } else {
            if(navigator.bluetooth.getAvailability && typeof navigator.bluetooth.getAvailability === 'function') {
                navigator.bluetooth.getAvailability()
                    .then(availability => {
                        Logger.info('bluetooth.availability ' + availability);
                    })
                    .catch((e) => {
                        Logger.info('bluetooth.availability.e ' + JSON.stringify(e));
                    });
            } else {
                Logger.info('bluetooth.getAvailability() not available');
            }

            requestLES();

            navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
            })
                .then(device => {
                    Logger.info('bluetooth.device ' + device.name + ' ' + device.id);
                    device.addEventListener('gattserverdisconnected', onDisconnected);
                    return device.gatt.connect();
                })
                .then(server => {
                    return server.getPrimaryService('battery_service');
                })
                .then(service => {
                    return service.getCharacteristic('battery_level');
                })
                .then(characteristic => {
                    characteristic.addEventListener('characteristicvaluechanged', handleBatteryLevelChanged);
                    return characteristic.readValue();
                })
                .then(value => {
                    Logger.info('Battery percentage is ' + value.getUint8(0));
                })
                .catch(error => {
                    Logger.error('bluetooth.error ' + error.name + ' ' + error.message);
                });
        }
    }, [requestLES, onDisconnected, handleBatteryLevelChanged]);

    const handleTopologyChange = useCallback((value) => {
        localStorage.setItem('showTopology', String(value));
        masterRef.current.emitter.emit('showTopology', value);
        setShowTopology(value);
    }, []);

    const handleShowMeChange = useCallback((value) => {
        localStorage.setItem('showMe', value);
        masterRef.current.emitter.emit('showMe', value);
        setShowMe(value);
    }, []);

    const handleEncryptChange = useCallback((value) => {
        localStorage.setItem('encrypt', value);
        masterRef.current.emitter.emit('encrypt', value);
        setEncrypt(value);
    }, []);

    const handleStrategyPreferenceChange = useCallback((value) => {
        localStorage.setItem('strategyPreference', value);
        masterRef.current.emitter.emit('strategyPreference', value);
        setStrategyPreference(value);
    }, []);

    const handleDarkModeChange = useCallback((value) => {
        localStorage.setItem('darkMode', value);
        masterRef.current.emitter.emit('darkMode', value);
        setDarkMode(value);
    }, []);

    const batchChangeName = useCallback((event) => {
        if(!event.target) return;
        console.log('change name ' + event.target.value);
        masterRef.current.service.updatePeer({
            name: event.target.value
        });
    }, []);

    const messagesList = <List>
        {messages}
    </List>;

    return (
        <div>
            <IconButton
                aria-haspopup="true"
                onClick={showLogs}
                color="inherit"
            >
                <Settings />
            </IconButton>

            <Dialog
                open={open}
                onClose={handleClose}
                TransitionComponent={Transition}
                keepMounted
                maxWidth="md"
                fullWidth
            >
                <DialogTitle>Settings</DialogTitle>
                <DialogActions className={classes.vertical}>
                        <FormControlLabel
                            control={
                                <Switch
                                    onChange={(event) => handleEncryptChange(event.target.checked)}
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
                                    onChange={(event) => handleTopologyChange(event.target.checked)}
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
                                        onChange={(event) => handleShowMeChange(event.target.checked)}
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
                                    onChange={(event) => handleStrategyPreferenceChange(event.target.checked)}
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
                                    onChange={(event) => handleDarkModeChange(event.target.checked)}
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
                            onClick={requestBLE}
                            color="inherit"
                        >
                            <Bluetooth />
                        </IconButton>
                        <Button onClick={() => masterRef.current.restartTrackers()} color="secondary">
                            restart trackers
                        </Button>
                        <IconButton
                            onClick={handleClose}>
                            <CloseRounded />
                        </IconButton>
                    </span>
                </DialogActions>
                <DialogContent>
                    <Typography variant={"caption"}>v{getAppVersionString()} {peerId}</Typography>

                    {messagesList}

                    <Button key='delete' onClick={handleReset} color="primary">
                        Del server state
                    </Button>
                </DialogContent>
            </Dialog>
        </div>
    );
}

SettingsView.propTypes = {
    classes: PropTypes.object.isRequired,
    emitter: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
    prefersDarkMode: PropTypes.bool.isRequired,
};

export default withSnackbar(withStyles(styles)(SettingsView));