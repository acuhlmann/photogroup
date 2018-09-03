import React, { Component } from 'react';
import PropTypes from 'prop-types';

import Logger from 'js-logger';
import { withStyles } from '@material-ui/core/styles';

import LoaderView from './LoaderView';
import IconButton from "@material-ui/core/IconButton/IconButton";
import CloudUploadRounded from '@material-ui/icons/CloudUploadRounded';

const styles = theme => ({

    root: {
        maxWidth: 300,
    },
    input: {
        display: 'none',
    },
});


class Uploader extends Component {

    constructor(props) {
        super(props);

        const { classes, model, loader } = props;

        this.classes = classes;
        this.model = model;
        this.loader = loader;
    }

    handleUpload(event) {
        const files = event.target.files;
        if(!files[0]) {
            return;
        }
        Logger.info('handleUpload ' + files[0].name);

        this.model.seed(files);

        const target = event.target || event.srcElement;
        target.value = '';
    }

    render() {
        const {classes} = this.props;

        return (
            <div>
                <input
                    accept="image/*"
                    className={classes.input}
                    id="contained-button-file"
                    type="file" onChange={this.handleUpload.bind(this)}
                />
                <label htmlFor="contained-button-file">
                    <IconButton
                        aria-haspopup="true"
                        color="inherit" variant="contained" component="span"
                    >
                        <CloudUploadRounded />
                    </IconButton>
                </label>
                <LoaderView loader={this.loader}/>
            </div>
        );
    }
}

Uploader.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
    loader: PropTypes.object.isRequired,
};

export default withStyles(styles)(Uploader);