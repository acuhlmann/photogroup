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

export default class PhotoDetailsRenderer {

    constructor(service) {
        this.service = service;
    }

    render(metadata, tile) {

        this.tile = tile;

        if(!metadata || (metadata && metadata.length < 1)) return;

        if(metadata[0] && metadata[0].key !== 'Shared by ') {
            //const shared = sharedBy ? (sharedBy.name ? sharedBy.name : sharedBy.originPlatform) : '';
            //metadata.unshift({key: 'Shared by ', value: shared + ' ' + fileSize});
        }

        return metadata.map((item, index) => {
            let content = item.value;
            if(item.key === 'Rating XMP') {
                content = this.getRating(item.value);
            } else if(item.key === 'x-Location') {
                content = this.getLocation(item.value);
            } else if(item.key === 'GPSAltitude') {
                content = item.value + 'm'
            } else if(item.key === 'x-file name') {
                content = this.getFileNameEntry(tile && tile.fileName ? tile.fileName : item.value, item.value);
            }

            return <ListItem key={index}
                             divider>
                <ListItemText primary={content} secondary={item.key} />
            </ListItem>
        });
    }

    getFileNameEntry(name, fullName) {
        const fileSuffix = FileUtil.getFileSuffix(fullName);
        return <span style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center'
        }}><TextField
            placeholder="File Name"
            margin="normal"
            variant="outlined"
            defaultValue={FileUtil.getFileNameWithoutSuffix(name)}
            onChange={
                //_.debounce(this.batchChangeName.bind(this), 2000, { 'leading': true })
                this.batchChangeName.bind(this)
            }
        /><span>{fileSuffix}</span></span>
    }

    batchChangeName(event) {

        if(!event.target) return;

        console.log('change name ' + event.target.value);
        this.service.update(this.tile.infoHash, {
            fileName: FileUtil.truncateFileName(event.target.value)
        });
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
            {'lat: ' + value.lat + ', ' + 'long: ' + value.long}
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