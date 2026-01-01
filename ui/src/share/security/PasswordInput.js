import React, { Component } from 'react';
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

class PasswordInput extends Component {

    constructor(props) {
        super(props);

        const { classes } = props;

        this.classes = classes;

        this.state = {
            password: 'foobar',
            //password: '',
            showPassword: false,
            strengthMeter: 0, strengthText: ''
        };
        this.props.onChange(this.state.password);
    }

    componentDidMount() {
        this.keyCheckMeter(this.state.password);
    }

    get password() {
        return this.state.passive;
    }

    handleClickShowPassword = () => {
        this.setState(state => ({ showPassword: !state.showPassword }));
    };

    handleChange = prop => event => {
        const password = event.target.value;
        this.setState({ [prop]: password });
        this.props.onChange(password);
        this.keyCheckMeter(password);
    };

    //credits https://github.com/sh-dv/hat.sh/blob/master/src/js/app.js
    keyCheckMeter(password) {
        let strength = {
            0: "Very Bad",
            1: "Bad",
            2: "Weak",
            3: "Good",
            4: "Strong"
        };
        let result = zxcvbn(password);
        const strengthMeter = result.score * 25 + '%';
        let strengthText;
        if (password !== '') {
            strengthText = strength[result.score];
        } else {
            strengthText = "none.";
        }

        this.setState({
            strengthMeter: strengthMeter, strengthText: strengthText
        })
    }

    render() {
        const {classes} = this.props;
        const {strengthMeter, strengthText} = this.state;

        return (
            <div>
                <TextField
                    id="outlined-adornment-password"
                    className={classes.textField}
                    variant="outlined"
                    type={this.state.showPassword ? 'text' : 'password'}
                    label="Password"
                    value={this.state.password}
                    onChange={this.handleChange('password')}
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="Toggle password visibility"
                                    onClick={this.handleClickShowPassword}
                                >
                                    {this.state.showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />

                {/*<span className={classes.vertical} style={{width: '100%'}}>
                </span>*/}
                <div style={{
                    backgroundColor: '#757575',
                    width: strengthMeter, height: '10px'
                }}> </div>
                <Typography variant="caption">Password Strength: {strengthText}</Typography>
            </div>
        );
    }
}

PasswordInput.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(PasswordInput);