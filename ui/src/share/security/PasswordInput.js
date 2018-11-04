import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

import { withStyles } from '@material-ui/core/styles';

import IconButton from "@material-ui/core/IconButton/IconButton";
import InputAdornment from '@material-ui/core/InputAdornment';
import TextField from '@material-ui/core/TextField';
import Visibility from '@material-ui/icons/Visibility';
import VisibilityOff from '@material-ui/icons/VisibilityOff';

const styles = theme => ({
    margin: {
        margin: theme.spacing.unit,
    },
    textField: {
        flexBasis: 200,
    },
});

class PasswordInput extends Component {

    constructor(props) {
        super(props);

        const { classes } = props;

        this.classes = classes;

        this.state = {
            password: 'p',
            showPassword: false,
        };
        this.props.onChange(this.state.password);
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
    };

    render() {
        const {classes} = this.props;

        return (
            <div>
                <TextField
                    id="outlined-adornment-password"
                    className={classNames(classes.margin, classes.textField)}
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
            </div>
        );
    }
}

PasswordInput.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(PasswordInput);