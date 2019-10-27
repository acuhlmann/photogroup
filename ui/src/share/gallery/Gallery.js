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
import Button from "@material-ui/core/Button/Button";
import PasswordInput from "../security/PasswordInput";
import Paper from "@material-ui/core/Paper";

const styles = theme => ({
    root: {
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-around',
        //overflow: 'hidden',
        width: '100%',
        backgroundColor: theme.palette.background.paper,
    },
    gridList: {
        //overflow: 'hidden',
        width: '100%',
        paddingBottom: '10px'
    },
    wide: {
        width: '100%',
    },
    icon: {
        //color: 'rgba(255, 255, 255, 0.54)',
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap'
    }
});

class Gallery extends Component {

    constructor(props) {
        super(props);

        this.model = props.model;
        this.model.view = this;

        this.state = {
            open: false,
            tileData: [],
            allMetadata: [],
            sharedBy: {},
            fileSize: ''
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
            allMetadata: this.model.parser.createMetadataSummary(tile.allMetadata),
            sharedBy: tile.sharedBy,
            fileSize: tile.size
        });
    }

    handleClose() {
        this.setState({ open: false });
    }

    buildTile(tile, index, classes) {

        //if(!tile.sharedBy) {
        //    return <div></div>;
        //}
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
            return <div key={tile.img} cols={tile.cols || 1} className={classes.gridList}>
                <img id={'img' + index}  src={tile.img} alt={tile.title}
                     crossOrigin="Anonymous" className={classes.wide}
                     onLoad={this.handleImageLoaded.bind(this, tile)} />
                <Paper className={classes.toolbar}>
                    <IconButton onClick={this.handleOpen.bind(this, tile)} className={classes.icon}>
                        <InfoIcon />
                    </IconButton>
                    <span onClick={this.handleOpen.bind(this, tile)}
                         title={tile.summary}>{tile.summary}: {tile.size}, {tile.sharedBy.originPlatform}, {tile.cameraSettings}
                    </span>
                    <IconButton onClick={this.handleDelete.bind(this, tile)}
                                className={classes.icon}>
                        <DeleteIcon />
                    </IconButton>
                </Paper>
                {/*<GridListTileBar className={classes.wide}
                    title={<div onClick={this.handleOpen.bind(this, tile)}
                                title={tile.summary}>{tile.summary}</div>}
                    titlePosition="bottom"
                    subtitle={<span onClick={this.handleOpen.bind(this, tile)}
                                    title={tile.cameraSettings}>
                                    <IconButton onClick={this.handleOpen.bind(this, tile)} className={classes.icon}>
                                        <InfoIcon />
                                    </IconButton>
                        {tile.size}, {tile.sharedBy.originPlatform}, {tile.cameraSettings}
                                </span>}
                    actionIcon={
                        <IconButton onClick={this.handleDelete.bind(this, tile)}
                                    className={classes.icon}>
                            <DeleteIcon />
                        </IconButton>
                    }
                />*/}
            </div>;
        }
    }

    render() {
        const classes = this.props.classes;
        const tileData = this.state.tileData;

        return (
            <div className={classes.root}>

                <div className={classes.gridList}>
                    {tileData.map((tile, index) => this.buildTile(tile, index, classes))}
                </div>

                <PhotoDetails metadata={this.state.allMetadata}
                              sharedBy={this.state.sharedBy}
                              fileSize={this.state.fileSize}
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