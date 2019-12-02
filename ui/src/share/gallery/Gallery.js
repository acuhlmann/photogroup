import React, { Component } from 'react';
import PropTypes from 'prop-types';
import {withStyles} from '@material-ui/core/styles';

import GridListTile from '@material-ui/core/GridListTile';

import Button from "@material-ui/core/Button/Button";
import PasswordInput from "../security/PasswordInput";
import GalleryMedia from './GalleryMedia';
import FileUtil from '../util/FileUtil';

const styles = theme => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
    gridList: {
        width: '100%',
        paddingBottom: '10px'
    },
});

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.master = props.master;
        this.model = props.model;
        this.model.view = this;

        this.state = {
            tileData: [],
        };

        this.master.emitter.on('urls', urls => {

            this.setState({
                tileData: this.state.tileData.map(tile => {

                    const url = urls.find(item => item.url === tile.torrent.magnetURI);

                    if(url && url.fileName && tile.allMetadata) {
                        const allMetadata = this.model.parser.createMetadataSummary(tile.allMetadata);
                        const suffix = FileUtil.getFileSuffix(tile.torrent.name);
                        const fileName = FileUtil.truncateFileName(url.fileName);
                        tile.summary = this.model.parser.createSummary(allMetadata, tile.dateTaken, fileName + suffix);
                        tile.name = url.fileName;
                    }
                    return tile;
                })
            });
        });

        const { classes } = props;
        this.classes = classes;
    }

    buildTile(tile, index, classes) {

        const master = this.master;

        const label = tile.name + ' of ' + tile.size + ' first shared by ' + tile.sharedBy.originPlatform;

        if(tile.secure) {

            return <GridListTile key={index} cols={tile.cols || 1}>
                <div>Decrypt with</div>
                <PasswordInput onChange={value => this.setState({password: value})} />
                <Button onClick={this.model.decrypt.bind(this.model, tile, this.state.password, index)}
                        color="primary">
                    Submit
                </Button>
            </GridListTile>;
        } else {

            return <GalleryMedia key={index} tile={tile} label={label}
                                 master={this.master} model={this.model}/>;
        }
    }

    render() {
        const classes = this.props.classes;
        const tileData = Array.from(this.state.tileData);

        return (
            <div className={classes.root}>

                <div className={classes.gridList}>
                    {tileData.map((tile, index) => this.buildTile(tile, index, classes))}
                </div>
            </div>
        );
    }
}

Gallery.propTypes = {
    classes: PropTypes.object.isRequired,
    model: PropTypes.object.isRequired,
    master: PropTypes.object.isRequired,
};

export default withStyles(styles)(Gallery);