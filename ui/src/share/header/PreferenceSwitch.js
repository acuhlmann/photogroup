import React from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';

/** One on/off choice in Settings: a short label and a line on what it does. */
export default function PreferenceSwitch({ checked, onChange, label, description }) {
    return (
        <FormControlLabel
            control={<Switch checked={checked} onChange={event => onChange(event.target.checked)} />}
            label={
                <Box>
                    <Typography variant="body2">{label}</Typography>
                    <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{description}</Typography>
                </Box>
            }
            sx={{ alignItems: 'flex-start', mx: 0, py: 0.5, '& .MuiSwitch-root': { mt: -0.5 } }}
        />
    );
}

PreferenceSwitch.propTypes = {
    checked: PropTypes.bool.isRequired,
    onChange: PropTypes.func.isRequired,
    label: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
};
