import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';

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

function NetworkPanel({ master, isMobile, isCenter, wtNumPeers }) {
    const theme = useTheme();
    const [tabValue, setTabValue] = useState(0);

    const handleTabChange = useCallback((event, newValue) => {
        setTabValue(newValue);
    }, []);

    return (
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
                pt: 1,
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
                <TopologyView master={master} fillHeight={isCenter} />
            </TabPanel>
            <TabPanel value={tabValue} index={1}>
                <MeView master={master} />
            </TabPanel>
        </Box>
    );
}

NetworkPanel.propTypes = {
    master: PropTypes.object.isRequired,
    isMobile: PropTypes.bool.isRequired,
    isCenter: PropTypes.bool,
    wtNumPeers: PropTypes.number,
};

export default NetworkPanel;
