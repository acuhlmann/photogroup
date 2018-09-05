import React, { Component } from 'react';
import PropTypes from 'prop-types';

import GridList from '@material-ui/core/GridList';
import GridListTile from '@material-ui/core/GridListTile';
import GridListTileBar from '@material-ui/core/GridListTileBar';
import IconButton from '@material-ui/core/IconButton';
import InfoIcon from '@material-ui/icons/Info';
import DeleteIcon from '@material-ui/icons/Delete';

import { withStyles } from '@material-ui/core/styles';

import PhotoDetails from './PhotoDetails';

const styles = theme => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        overflow: 'hidden',
        backgroundColor: theme.palette.background.paper,
    },
    gridList: {
        width: '100%',
        height: '100%',
    },
    subheader: {
        width: '100%',
    },
    icon: {
        color: 'rgba(255, 255, 255, 0.54)',
    },
});

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.model = props.model;
        this.model.view = this;

        this.state = {
            open: false,
            tileData: [],
            allMetadata: []
        };

        const { classes } = props;
        this.classes = classes;
    }

    handleImageLoaded(tile, event) {
        this.model.parser.readMetadata(tile, event);
    }

    handleDelete(tile) {
        this.model.deleteTile(tile);
    }

    handleOpen(tile) {
        this.setState({
            open: true,
            allMetadata: this.model.parser.createMetadataSummary(tile.allMetadata)
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    render() {
        const classes = this.classes;
        const tileData = this.state.tileData;

        return (
            <div className={classes.root}>
                <GridList cellHeight={400} className={classes.gridList} cols={1} spacing={1}>
                    {tileData.map((tile, index) => (
                        <GridListTile key={tile.img} cols={tile.cols || 1}>
                            <img id={'img' + index} src={tile.img} alt={tile.title}
                                 crossOrigin="Anonymous"
                                 onLoad={this.handleImageLoaded.bind(this, tile)} />
                            <GridListTileBar
                                title={<div onClick={this.handleOpen.bind(this, tile)}
                                            title={tile.summary}>{tile.summary}</div>}
                                titlePosition="bottom"
                                subtitle={<span onClick={this.handleOpen.bind(this, tile)}
                                                title={tile.cameraSettings}>
                                    <IconButton onClick={this.handleOpen.bind(this, tile)} className={classes.icon}>
                                        <InfoIcon />
                                    </IconButton>
                                    {tile.size} {tile.cameraSettings}
                                </span>}
                                actionIcon={
                                    <IconButton onClick={this.handleDelete.bind(this, tile)}
                                                className={classes.icon}>
                                        <DeleteIcon />
                                    </IconButton>
                                }
                            />
                        </GridListTile>
                    ))}
                </GridList>

                <PhotoDetails metadata={this.state.allMetadata}
                              open={this.state.open}
                              handleClose={this.handleClose.bind(this)} />
            </div>
        );
    }
}

Gallery.propTypes = {
    classes: PropTypes.object.isRequired,
};

export default withStyles(styles)(Gallery);