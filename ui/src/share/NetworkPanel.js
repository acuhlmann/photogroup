import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

import TopologyView from './topology/TopologyView';
import MeView from './MeView';

function TabPanel({ children, value, index }) {
    return (
        <Box
            role="tabpanel"
            sx={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                display: value === index ? 'block' : 'none',
            }}
        >
            {children}
        </Box>
    );
}

function NetworkPanel({ master, isMobile, isCenter, wtNumPeers }) {
    const [tabValue, setTabValue] = useState(0);

    const handleTabChange = useCallback((event, newValue) => {
        setTabValue(newValue);
    }, []);

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            bgcolor: 'transparent',
        }}>
            {/* Tabs */}
            <Tabs
                value={tabValue}
                onChange={handleTabChange}
                variant="fullWidth"
                sx={{
                    minHeight: 40,
                    borderBottom: 1,
                    borderColor: 'divider',
                    '& .MuiTab-root': {
                        minHeight: 40,
                        fontSize: '0.78rem',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '0.04em',
                    },
                }}
            >
                <Tab label="Map" />
                <Tab label="This device" />
            </Tabs>

            {/* Tab content */}
            <TabPanel value={tabValue} index={0}>
                <TopologyView master={master} fillHeight={isCenter} active={tabValue === 0} />
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
