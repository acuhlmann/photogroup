import ListItem from "@material-ui/core/ListItem/ListItem";
import ListItemText from "@material-ui/core/ListItemText/ListItemText";
import React from "react";
import StarOutlined from "@material-ui/icons/StarOutlined";
import StarBorderOutlined from "@material-ui/icons/StarBorderOutlined";
import Logger from "js-logger";
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import TextField from '@material-ui/core/TextField';
import FileUtil from "../util/FileUtil";
import _ from 'lodash';
import StringUtil from "../util/StringUtil";

export default class PhotoDetailsRenderer {

    constructor(service, view) {
        this.service = service;
        this.view = view;
        this.debouncedServerPublish = _.throttle(this.batchChangeName.bind(this), 1000,
            { 'leading': true, 'trailing': true });
    }

    render(metadata, tile, fileName) {

        this.tile = tile;

        if(!metadata || (metadata && metadata.length < 1)) return;

        if(metadata[0] && metadata[0].key !== 'Shared by ') {
            //const shared = sharedBy ? (sharedBy.name ? sharedBy.name : sharedBy.originPlatform) : '';
            //metadata.unshift({key: 'Shared by ', value: shared + ' ' + fileSize});
        }

        if(tile.isImage) {

            return metadata.map((item, index) => {
                let content = item.value;
                if(item.key === 'Rating XMP') {
                    content = this.getRating(item.value);
                } else if(item.key === 'x-Location') {
                    content = this.getLocation(item.value);
                } else if(item.key === 'GPSAltitude') {
                    content = item.value + 'm'
                } else if(item.key === 'x-file name') {
                    //const fileName = tile && tile.fileName ? tile.fileName : item.value;
                    content = this.getFileNameEntry(fileName, item.value);
                }

                return <ListItem key={index}
                                 divider>
                    <ListItemText primary={content} secondary={item.key} />
                </ListItem>
            });
        } else if(tile.isAudio || tile.isVideo) {

            return metadata.map((item, index) => {
                let {key, value} = item;
                if(key === 'x-file name') {

                    value = this.getFileNameEntry(fileName, value);
                    return this.createListItemText(index, key, value);

                } else if(key === 'format') {

                    return Object.entries(value).map((entry, subIndex) => {

                        const key = entry[0];
                        const item = entry[1];
                        let content;
                        if(key === 'trackInfo') {
                            content = item.map(item => {
                                return StringUtil.addEmptySpaces([
                                    item.codecName, item.type,
                                    Object.entries(item.audio).map(entry => entry[0] + ':' + entry[1])],
                                    ', ')
                            });
                        } else if(Array.isArray(item)) {
                            content = item.map(item => {
                                return item;
                            });
                        } else if(typeof item === 'string') {
                            content = item;
                        } else {
                            content = Object.entries(item)
                                .map(entry => {
                                    if(entry[1]) {
                                        return entry[0] + ':' + entry[1];
                                    }
                                    return null;
                                })
                                .filter(item => item).join(', ');
                        }
                        return content ? this.createListItemText(index + subIndex, key,
                            <Typography>{content}</Typography>) : null;
                    }).filter(item => item);

                } else if(key === 'common') {

                    return Object.entries(value).map((entry, subIndex) => {

                        const key = entry[0];
                        const item = entry[1];
                        if(key === 'picture') {
                            return this.createListItem(index + subIndex, key, <div>{item
                                .map(pic => this.getAlbumArtPicture(pic, tile.picSummary, subIndex))}
                            </div>);
                        } else if(key === 'starRating' && item.starRating) {

                            return this.getRating(item.starRating);

                        } else {

                            let content;
                            if(Array.isArray(item)) {
                                content = item.map(item => item);
                            } else if(typeof item === 'string') {
                                content = item;
                            } else {
                                content = Object.entries(item)
                                    .map(entry => {
                                        if(entry[1]) {
                                            return entry[0] + ':' + entry[1];
                                        }
                                        return null;
                                    })
                                    .filter(item => item).join(', ');
                            }
                            return content ? this.createListItemText(index + subIndex, key,
                                <Typography>{content}</Typography>) : null;
                        }
                    }).filter(item => item);
                }
            });
        }
    }

    createListItemText(index, key, value) {
        return <ListItem key={index}
                  divider>
            <ListItemText primary={value} secondary={key} />
        </ListItem>
    }

    createListItem(index, key, value) {
        return <ListItem key={index}
                         divider>
            {value}
        </ListItem>
    }

    getAlbumArtPicture(value, summary, index) {
        let base64String = "";
        for (let i = 0; i < value.data.length; i++) {
            base64String += String.fromCharCode(value.data[i]);
        }
        const dataUrl = "data:" + value.format + ";base64," + window.btoa(base64String);
        const description = StringUtil.addEmptySpaces([value.type, value.description]);
        const alt = StringUtil.addEmptySpaces([description, summary]);
        return  <div key={index}>
                <Typography>{description}</Typography>
                <img src={dataUrl} alt={alt} style={{width: '100%'}} />
            </div>;
    }

    getFileNameEntry(name, origName) {

        const fileSuffix = FileUtil.getFileSuffix(origName);
        return <span style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center'
        }}><TextField
            placeholder="File Name"
            margin="normal"
            variant="outlined"
            value={name}
            onChange={(event) =>
                this.debouncedServerPublish(event.target.value)}
        /><span>{fileSuffix}</span></span>
    }

    batchChangeName(value) {

        if(!value) return;

        this.view.setState({fileName: value});
        Logger.info('change name ' + value);
        this.service.update([{
            infoHash: this.tile.infoHash,
            fileName: FileUtil.truncateFileName(value)
        }]);
    }

    getRating(value) {
        const rating = Number(value);

        const stars = this.generateNumbers(rating)
            .map(index => <StarOutlined key={index + 'rate'}/>);
        const missingStars = this.generateNumbers(5 - rating)
            .map(index => <StarBorderOutlined key={index + 'missing'}/>);

        return <span>{stars.concat(missingStars)}</span>
    }

    generateNumbers(rating) {
        return Array.from(Array(rating).keys());
    }

    showTooltipContent(value) {
        return <div>
            <Typography style= {{color: '#ffffff'}}>{'lat: '+ value.lat}</Typography>
            <Typography style= {{color: '#ffffff'}}>{'long: ' + value.long}</Typography>
        </div>
    }

    buildReverseGeocode(value) {
        return <div>
            {`lat: ${value.lat}, long: ${value.long}`}
            {/*<Async
                promise={this.reverseGeocode(value)}
                then={val => {
                    const msg = (val === 'Not found') ? ('lat: ' + value.lat + ', ' + 'long: ' + value.long) : val;
                    return <div>{msg}</div>
                }} />*/}
        </div>
    }

    getLocation(value) {
        const url = 'https://www.google.com/maps/@'+value.lat+','+value.long+',15z';
        return <span>
                <Tooltip title={this.showTooltipContent(value)}>
                <a href={url}
                   target="_blank" rel="noopener noreferrer">{this.buildReverseGeocode(value)}</a>
            </Tooltip>
        </span>
    }

    reverseGeocode(value) {
        const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng='+value.lat+','+value.long;
        const noAddress = 'Not found';
        return fetch(url).then(response => {
            return response.json();
        }).then(json => {
            Logger.info('reverseGeocode ' + json);
            if(json.error_message) return {};
            let address = _.get(json, 'results[0].formatted_address');
            if(!address) {
                address = noAddress;
            }
            return address;
        }).catch(() => {
            return noAddress;
        });
    }
}