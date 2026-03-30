import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import Fab from '@mui/material/Fab';
import Badge from '@mui/material/Badge';
import CloseRounded from '@mui/icons-material/CloseRounded';
import HubRounded from '@mui/icons-material/HubRounded';

import TopologyView from './topology/TopologyView';
import MeView from './MeView';

function TabPanel({ children, value, index }) {
    return (
        <Box
            role="tabpanel"
            hidden={value !== index}
            sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
        >
            {value === index && children}
        </Box>
    );
}

function NetworkPanel({ master, isMobile, wtNumPeers }) {
    const theme = useTheme();
    const [tabValue, setTabValue] = useState(0);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const handleTabChange = useCallback((event, newValue) => {
        setTabValue(newValue);
    }, []);

    const panelContent = (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            bgcolor: 'background.default',
        }}>
            {/* Panel header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                pt: isMobile ? 1 : 0,
                pb: 0,
            }}>
                <Typography
                    variant="subtitle2"
                    sx={{
                        fontFamily: 'var(--font-mono)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        fontSize: '0.7rem',
                        color: 'text.secondary',
                    }}
                >
                    Network
                </Typography>
                {isMobile && (
                    <IconButton size="small" onClick={() => setDrawerOpen(false)}>
                        <CloseRounded fontSize="small" />
                    </IconButton>
                )}
            </Box>

            {/* Tabs */}
            <Tabs
                value={tabValue}
                onChange={handleTabChange}
                variant="fullWidth"
                sx={{
                    minHeight: 36,
                    '& .MuiTab-root': {
                        minHeight: 36,
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        textTransform: 'none',
                    },
                    '& .MuiTabs-indicator': {
                        height: 2,
                        borderRadius: 1,
                    },
                }}
            >
                <Tab label="Network Map" />
                <Tab label="My Connection" />
            </Tabs>

            {/* Tab content */}
            <TabPanel value={tabValue} index={0}>
                <TopologyView master={master} />
            </TabPanel>
            <TabPanel value={tabValue} index={1}>
                <MeView master={master} />
            </TabPanel>
        </Box>
    );

    // Mobile: FAB + bottom drawer
    if (isMobile) {
        return (
            <>
                <Fab
                    size="medium"
                    color="primary"
                    onClick={() => setDrawerOpen(true)}
                    sx={{
                        position: 'fixed',
                        bottom: 20,
                        right: 20,
                        zIndex: 1050,
                        boxShadow: theme.palette.mode === 'dark'
                            ? '0 0 24px rgba(0,229,255,0.3)'
                            : '0 4px 12px rgba(0,0,0,0.15)',
                    }}
                >
                    <Badge badgeContent={wtNumPeers} color="secondary" overlap="circular">
                        <HubRounded />
                    </Badge>
                </Fab>
                <Drawer
                    anchor="bottom"
                    open={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    PaperProps={{
                        sx: {
                            height: '75vh',
                            borderTopLeftRadius: 16,
                            borderTopRightRadius: 16,
                            bgcolor: 'background.default',
                        },
                    }}
                >
                    {/* Drag handle */}
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        pt: 1,
                        pb: 0.5,
                    }}>
                        <Box sx={{
                            width: 40,
                            height: 4,
                            borderRadius: 2,
                            bgcolor: 'divider',
                        }} />
                    </Box>
                    {panelContent}
                </Drawer>
            </>
        );
    }

    // Desktop: inline panel
    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            borderRight: `1px solid ${theme.palette.divider}`,
        }}>
            {panelContent}
        </Box>
    );
}

NetworkPanel.propTypes = {
    master: PropTypes.object.isRequired,
    isMobile: PropTypes.bool.isRequired,
    wtNumPeers: PropTypes.number,
};

export default NetworkPanel;
