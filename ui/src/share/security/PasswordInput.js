import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@mui/styles';

import IconButton from "@mui/material/IconButton";
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import zxcvbn from 'zxcvbn';
import Typography from "@mui/material/Typography";

const styles = theme => ({
    margin: {
        margin: theme.spacing(1),
    },
    textField: {
        flexBasis: 200,
    },
    vertical: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
    },
});

function PasswordInput({classes, onChange}) {
    const [password, setPassword] = useState('foobar');
    const [showPassword, setShowPassword] = useState(false);
    const [strengthMeter, setStrengthMeter] = useState(0);
    const [strengthText, setStrengthText] = useState('');

    useEffect(() => {
        onChange(password);
        keyCheckMeter(password);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    //credits https://github.com/sh-dv/hat.sh/blob/master/src/js/app.js
    const keyCheckMeter = (password) => {
        const strength = {
            0: "Very Bad",
            1: "Bad",
            2: "Weak",
            3: "Good",
            4: "Strong"
        };
        const result = zxcvbn(password);
        const strengthMeterValue = result.score * 25 + '%';
        let strengthTextValue;
        if (password !== '') {
            strengthTextValue = strength[result.score];
        } else {
            strengthTextValue = "none.";
        }

        setStrengthMeter(strengthMeterValue);
        setStrengthText(strengthTextValue);
    };

    const handleClickShowPassword = () => {
        setShowPassword(prev => !prev);
    };

    const handleChange = (event) => {
        const newPassword = event.target.value;
        setPassword(newPassword);
        onChange(newPassword);
        keyCheckMeter(newPassword);
    };

    return (
        <div>
            <TextField
                id="outlined-adornment-password"
                className={classes.textField}
                variant="outlined"
                type={showPassword ? 'text' : 'password'}
                label="Password"
                value={password}
                onChange={handleChange}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton
                                aria-label="Toggle password visibility"
                                onClick={handleClickShowPassword}
                            >
                                {showPassword ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                        </InputAdornment>
                    ),
                }}
            />

            <div style={{
                backgroundColor: '#757575',
                width: strengthMeter, 
                height: '10px'
            }}> </div>
            <Typography variant="caption">Password Strength: {strengthText}</Typography>
        </div>
    );
}

PasswordInput.propTypes = {
    classes: PropTypes.object.isRequired,
    onChange: PropTypes.func.isRequired,
};

export default withStyles(styles)(PasswordInput);