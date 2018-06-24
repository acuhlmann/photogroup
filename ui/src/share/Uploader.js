import React, { Component } from 'react';
import PropTypes from 'prop-types';

import { withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';

import LoaderView from './LoaderView';

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

    log(message) {
        this.model.log(message);
    }

    handleUpload(event) {
        const files = event.target.files;
        if(!files[0]) {
            return;
        }
        this.log('handleUpload ' + files[0].name);

        //this.readPiexifMetadata(files[0]);

        this.model.seed(files);

        const target = event.target || event.srcElement;
        target.value = '';
    }

    /*
    TODO: figure out how to write into description and rating metadata. http://www.exiv2.org/tags.html
    readPiexifMetadata(img) {
        const scope = this;

        const reader = new FileReader();
        reader.addEventListener("load", event => {
            scope.loadPiexif(reader.result);
        }, false);
        reader.readAsDataURL(img);
    }j

    loadPiexif(img) {
        const piexif = window.piexif;
        const exifObj = piexif.load(img);
        for (let ifd in exifObj) {
            if (ifd === "thumbnail") {
                continue;
            }
            console.log("-" + ifd);
            for (let tag in exifObj[ifd]) {
                console.log("  " + piexif.TAGS[ifd][tag]["name"] + ":" + exifObj[ifd][tag]);
            }
        }
    }
    */

    render() {
        const {classes} = this.props;

        return (
            <div>
                <div>Share a file</div>
                <input
                    accept="image/*"
                    className={classes.input}
                    id="contained-button-file"
                    type="file" onChange={this.handleUpload.bind(this)}
                />
                <label htmlFor="contained-button-file">
                    <Button
                        variant="contained" component="span" className={classes.button}>
                        Upload
                    </Button>
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