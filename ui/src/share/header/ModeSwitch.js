import React, { useState } from 'react';
import PropTypes from 'prop-types';

import ButtonBase from '@mui/material/ButtonBase';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ViewQuiltRounded from '@mui/icons-material/ViewQuiltRounded';

import { headerButtonSx, headerLabelSx } from './headerButtonSx';
import { MODES, MODE_INFO } from '../uiMode';

/**
 * Pick between the simple, default and geek views. `compact` shows an icon
 * instead of the name on a phone, to leave room for the room's name.
 */
function ModeSwitch({ mode, onChange, compact = false }) {
    const [anchor, setAnchor] = useState(null);

    const choose = (next) => {
        setAnchor(null);
        if (next !== mode) onChange(next);
    };

    return (
        <>
            <ButtonBase
                aria-label={`View: ${MODE_INFO[mode].label}. Change view`}
                aria-haspopup="menu"
                aria-expanded={anchor ? 'true' : undefined}
                onClick={(event) => setAnchor(event.currentTarget)}
                sx={headerButtonSx}
            >
                {compact && <ViewQuiltRounded sx={{ display: { xs: 'block', sm: 'none' } }} />}
                <Box component="span" sx={{ ...headerLabelSx, display: compact ? { xs: 'none', sm: 'inline' } : 'inline' }}>
                    {MODE_INFO[mode].label}
                </Box>
                <ExpandMoreRounded />
            </ButtonBase>
            <Menu
                anchorEl={anchor}
                open={!!anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                {MODES.map((item) => (
                    <MenuItem key={item} selected={item === mode} onClick={() => choose(item)}>
                        <ListItemIcon>
                            {item === mode && <CheckRounded fontSize="small" />}
                        </ListItemIcon>
                        <ListItemText primary={MODE_INFO[item].label} secondary={MODE_INFO[item].detail} />
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
}

ModeSwitch.propTypes = {
    mode: PropTypes.oneOf(MODES).isRequired,
    onChange: PropTypes.func.isRequired,
    compact: PropTypes.bool,
};

export default ModeSwitch;
