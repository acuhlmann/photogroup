import React, {useState, useEffect, useCallback} from 'react';
import PropTypes from 'prop-types';

import {withStyles} from '@mui/styles';

import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import Paper from "@mui/material/Paper";
import AccountCircleRounded from '@mui/icons-material/AccountCircleRounded';
import TextField from "@mui/material/TextField";
import update from "immutability-helper";
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import ViewAgendaRounded from '@mui/icons-material/ViewAgendaRounded';
import IconButton from '@mui/material/IconButton';
import StringUtil from "./util/StringUtil";
import NatListItem from "./util/NatListItem";
import UserListItem from "./util/UserListItem";
import Slide from "@mui/material/Slide";
import {Fade} from "@mui/material";

const styles = theme => ({
    content: {
        padding: '0px 0px 0px 0px',
        width: '100%',
        overflow: 'hidden'
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column'
    },
    verticalAndWide: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%'
    },
    horizontal: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
});

function MeView({classes, master}) {
    const expandedMeFromStorage = localStorage.getItem('expandedMe') || false;
    const [expandedMe, setExpandedMe] = useState(String(expandedMeFromStorage) === 'true');
    const [showMe, setShowMe] = useState(false);
    const [galleryHasImages, setGalleryHasImages] = useState(false);
    const [listView, setListView] = useState(true);
    const [me, setMe] = useState({});
    const [myNat, setMyNat] = useState(null);
    const [connectionSpeedType, setConnectionSpeedType] = useState('');
    const [originPlatform, setOriginPlatform] = useState('');

    const findNat = useCallback((chain) => {
        return chain?.find(item => item.typeDetail?.includes('srflx') || item.typeDetail?.includes('prflx'));
    }, []);

    useEffect(() => {
        const emitter = master.emitter;

        const handleLocalNetwork = (chain) => {
            if(me?.label && myNat?.network?.hostname) return;
            if(!chain?.find) return;
            
            const meItem = chain.find(item => item.typeDetail === 'host');
            if(meItem) {
                meItem.label = originPlatform + ' ' + meItem.ip;
            }
            const natItem = findNat(chain);
            if(natItem) {
                natItem.label = natItem.typeDetail + ' ' + natItem.ip;
                natItem.network = {};
            }

            setMe(meItem || {});
            setMyNat(natItem);
        };

        const handlePeers = (event) => {
            if(event.type === 'update') {
                const myPeer = event.item;
                if(myPeer && myPeer.peerId === master.client.peerId && myPeer.networkChain) {
                    const natItem = findNat(myPeer.networkChain);
                    if(natItem && !natItem.network) {
                        natItem.network = {};
                    }
                    if(natItem) {
                        natItem.label = StringUtil.createNetworkLabel(natItem);
                    }
                    const meItem = myPeer.networkChain.find(item => item.typeDetail === 'host');
                    if(meItem) {
                        meItem.label = originPlatform + ' ' + meItem.ip;
                    }
                    setMyNat(natItem);
                    setMe(meItem || {});
                }
            }
        };

        const handleConnectionSpeedType = (type) => {
            setConnectionSpeedType(type + ' ');
        };

        const handleAddPeerDone = (peer) => {
            const platform = StringUtil.slimPlatform(peer.originPlatform);
            setOriginPlatform(platform);
            setMe({label: platform});
        };

        const handleShowMe = (value) => {
            setShowMe(value);
        };

        const handleGalleryHasImages = (hasImages) => {
            setGalleryHasImages(hasImages);
        };

        emitter.on('localNetwork', handleLocalNetwork);
        emitter.on('peers', handlePeers);
        emitter.on('connectionSpeedType', handleConnectionSpeedType);
        emitter.on('addPeerDone', handleAddPeerDone);
        emitter.on('showMe', handleShowMe);
        emitter.on('galleryHasImages', handleGalleryHasImages);

        return () => {
            emitter.removeListener('localNetwork', handleLocalNetwork);
            emitter.removeListener('peers', handlePeers);
            emitter.removeListener('connectionSpeedType', handleConnectionSpeedType);
            emitter.removeListener('addPeerDone', handleAddPeerDone);
            emitter.removeListener('showMe', handleShowMe);
            emitter.removeListener('galleryHasImages', handleGalleryHasImages);
        };
    }, [master, findNat, me, myNat, originPlatform]);

    const handleExpand = useCallback((panel) => (event, expanded) => {
        localStorage.setItem(panel, expanded);
        if (panel === 'expandedMe') {
            setExpandedMe(expanded);
        }
    }, []);

    const batchChangeName = useCallback((event) => {
        if(!event.target) return;
        console.log('change name ' + event.target.value);
        master.service.updatePeer({
            name: event.target.value
        });
    }, [master]);

    const buildHeader = useCallback((galleryHasImages, listView, classes) => {
        const init = master && master.client && master.client.peerId && master.me;
        if (!init) return null;
        
        return (
            <span style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%'
            }}>
                <TextField
                    placeholder="Your Nickname"
                    margin="normal"
                    variant="outlined"
                    defaultValue={master.me.name}
                    onClick={event => {
                        event.stopPropagation();
                    }}
                    onChange={batchChangeName}
                />
                <Fade in={galleryHasImages}>
                    <span className={classes.horizontal}>
                        <IconButton 
                            component="div"
                            color={listView ? 'primary' : 'inherit'}
                            onClick={(event) => {
                                event.stopPropagation();
                                master.emitter.emit('galleryListView', true);
                                setListView(true);
                            }}>
                            <ViewListRounded />
                        </IconButton>
                        <IconButton 
                            component="div"
                            color={!listView ? 'primary' : 'inherit'}
                            onClick={(event) => {
                                event.stopPropagation();
                                master.emitter.emit('galleryListView', false);
                                setListView(false);
                            }}>
                            <ViewAgendaRounded />
                        </IconButton>
                    </span>
                </Fade>
            </span>
        );
    }, [master, batchChangeName, classes]);

    const peer = {
        connectionSpeedType: connectionSpeedType,
        name: '', 
        originPlatform: me.label
    };

    return (
        <Slide direction="left" in={showMe} mountOnEnter unmountOnExit>
            <span>
                <Accordion expanded={expandedMe} onChange={handleExpand('expandedMe')}>
                    <AccordionSummary 
                        expandIcon={<ExpandMoreIcon />}
                        slotProps={{ iconButton: { component: 'div' } }}>
                        {buildHeader(galleryHasImages, listView, classes)}
                    </AccordionSummary>
                    <AccordionDetails className={classes.content}>
                        <div className={classes.verticalAndWide}>
                            <Paper style={{
                                margin: '10px',
                                padding: '10px'
                            }}>
                                <div className={classes.vertical}>
                                    <UserListItem peer={peer} />
                                    <NatListItem nat={myNat} />
                                </div>
                            </Paper>
                        </div>
                    </AccordionDetails>
                </Accordion>
            </span>
        </Slide>
    );
}

MeView.propTypes = {
    classes: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(MeView);