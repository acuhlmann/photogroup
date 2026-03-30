import React, {useState, useEffect, useCallback} from 'react';
import PropTypes from 'prop-types';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import SmartphoneRounded from '@mui/icons-material/SmartphoneRounded';
import ComputerRounded from '@mui/icons-material/ComputerRounded';
import RouterRounded from '@mui/icons-material/RouterRounded';
import DnsRounded from '@mui/icons-material/DnsRounded';

import StringUtil from './util/StringUtil';

const monoFont = 'var(--font-mono)';

function getDeviceIcon(platform) {
    if (!platform) return <ComputerRounded />;
    const lower = platform.toLowerCase();
    if (lower.includes('android') || lower.includes('ios') || lower.includes('iphone') || lower.includes('mobile')) {
        return <SmartphoneRounded />;
    }
    return <ComputerRounded />;
}

function ChainArrow() {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.5 }}>
            <ArrowDownwardRounded sx={{ color: 'text.disabled', fontSize: 20 }} />
        </Box>
    );
}

function ChainCard({ icon, title, children, borderColor }) {
    return (
        <Paper
            variant="outlined"
            sx={{
                p: 1.5,
                borderLeft: 4,
                borderLeftColor: borderColor,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 1.5,
            }}
        >
            <Box sx={{ color: 'text.secondary', mt: 0.25 }}>
                {icon}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>
                    {title}
                </Typography>
                {children}
            </Box>
        </Paper>
    );
}

function MeView({ master }) {
    const [showMe, setShowMe] = useState(false);
    const [galleryHasImages, setGalleryHasImages] = useState(false);
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
            if (me?.label && myNat?.network?.hostname) return;
            if (!chain?.find) return;

            const meItem = chain.find(item => item.typeDetail === 'host');
            if (meItem) {
                meItem.label = originPlatform + ' ' + meItem.ip;
            }
            const natItem = findNat(chain);
            if (natItem) {
                natItem.label = natItem.typeDetail + ' ' + natItem.ip;
                natItem.network = {};
            }

            setMe(meItem || {});
            setMyNat(natItem);
        };

        const handlePeers = (event) => {
            if (event.type === 'update') {
                const myPeer = event.item;
                if (myPeer && myPeer.peerId === master.client.peerId && myPeer.networkChain) {
                    const natItem = findNat(myPeer.networkChain);
                    if (natItem && !natItem.network) {
                        natItem.network = {};
                    }
                    if (natItem) {
                        natItem.label = StringUtil.createNetworkLabel(natItem);
                    }
                    const meItem = myPeer.networkChain.find(item => item.typeDetail === 'host');
                    if (meItem) {
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
            setMe({ label: platform });
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

    const batchChangeName = useCallback((event) => {
        if (!event.target) return;
        console.log('change name ' + event.target.value);
        master.service.updatePeer({
            name: event.target.value,
        });
    }, [master]);

    const init = master && master.client && master.client.peerId && master.me;

    // Extract NAT details for display
    const natIp = myNat?.ip || myNat?.network?.ip || '';
    const natIsp = myNat?.network?.connection?.isp || '';
    const natCity = myNat?.network?.city || '';
    const natCountryFlag = myNat?.network?.location?.country_flag_emoji || '';
    const natCountry = myNat?.network?.country || '';
    const natHostname = myNat?.network?.hostname || '';

    // Determine if there's a relay (relay items have typeDetail 'relay')
    const hasRelay = myNat?.typeDetail?.includes('prflx');

    const speedChip = connectionSpeedType.trim();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2 }}>
            {/* Nickname field */}
            {init && (
                <TextField
                    placeholder="Your Nickname"
                    margin="none"
                    variant="outlined"
                    size="small"
                    fullWidth
                    defaultValue={master.me.name}
                    onChange={batchChangeName}
                />
            )}

            {/* Network chain visualization */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Device card */}
                <ChainCard
                    icon={getDeviceIcon(originPlatform)}
                    title="Your Device"
                    borderColor="success.main"
                >
                    <Typography variant="caption" sx={{ fontFamily: monoFont, color: 'text.secondary' }}>
                        {me.label || originPlatform || 'Detecting...'}
                    </Typography>
                    {me.ip && (
                        <Typography variant="caption" sx={{ fontFamily: monoFont, color: 'text.secondary' }}>
                            {me.ip}
                        </Typography>
                    )}
                    {speedChip && (
                        <Box sx={{ mt: 0.5 }}>
                            <Chip label={speedChip} size="small" variant="outlined" color="info" />
                        </Box>
                    )}
                </ChainCard>

                {/* NAT card */}
                {myNat && (
                    <>
                        <ChainArrow />
                        <ChainCard
                            icon={<RouterRounded />}
                            title="NAT"
                            borderColor="warning.main"
                        >
                            {natIp && (
                                <Typography variant="caption" sx={{ fontFamily: monoFont, color: 'text.secondary' }}>
                                    {natIp}
                                </Typography>
                            )}
                            {natHostname && (
                                <Typography variant="caption" sx={{ fontFamily: monoFont, color: 'text.secondary' }}>
                                    {natHostname}
                                </Typography>
                            )}
                            {natIsp && (
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {natIsp}
                                </Typography>
                            )}
                            {(natCity || natCountry) && (
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {natCountryFlag && (
                                        <span style={{ fontSize: '1.2em', marginRight: 4 }}>{natCountryFlag}</span>
                                    )}
                                    {[natCity, natCountry].filter(Boolean).join(', ')}
                                </Typography>
                            )}
                        </ChainCard>
                    </>
                )}

                {/* Relay card */}
                {hasRelay && (
                    <>
                        <ChainArrow />
                        <ChainCard
                            icon={<DnsRounded />}
                            title="Relay Server"
                            borderColor="error.main"
                        >
                            <Typography variant="caption" sx={{ fontFamily: monoFont, color: 'text.secondary' }}>
                                Connection relayed (TURN)
                            </Typography>
                        </ChainCard>
                    </>
                )}
            </Box>
        </Box>
    );
}

MeView.propTypes = {
    master: PropTypes.object.isRequired,
};

export default MeView;
