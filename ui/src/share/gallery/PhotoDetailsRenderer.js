import {get} from 'lodash';
import ListItem from "@material-ui/core/ListItem/ListItem";
import ListItemText from "@material-ui/core/ListItemText/ListItemText";
import React from "react";
import StarOutlined from "@material-ui/icons/StarOutlined";
import StarBorderOutlined from "@material-ui/icons/StarBorderOutlined";
import Logger from "js-logger";
import Tooltip from '@material-ui/core/Tooltip';
import Async from 'react-promise';
import Typography from '@material-ui/core/Typography';

export default class PhotoDetailsRenderer {

    static render(metadata) {
        return metadata.map((item, index) => {
            let content = item.value;
            if(item.key === 'Rating XMP') {
                content = PhotoDetailsRenderer.getRating(item.value);
            } else if(item.key === 'x-Location') {
                content = PhotoDetailsRenderer.getLocation(item.value);
            } else if(item.key === 'GPSAltitude') {
                content = item.value + 'm'
            }

            return <ListItem key={index}
                             divider>
                <ListItemText primary={content} secondary={item.key} />
            </ListItem>
        });
    }

    static getRating(value) {
        const rating = Number(value);

        const stars = PhotoDetailsRenderer.generateNumbers(rating)
            .map(index => <StarOutlined key={index + 'rate'}/>);
        const missingStars = PhotoDetailsRenderer.generateNumbers(5 - rating)
            .map(index => <StarBorderOutlined key={index + 'missing'}/>);

        return <span>{stars.concat(missingStars)}</span>
    }

    static generateNumbers(rating) {
        return Array.from(Array(rating).keys());
    }

    static showTooltipContent(value) {
        return <div>
            <Typography style= {{color: '#ffffff'}}>{'lat: '+ value.lat}</Typography>
            <Typography style= {{color: '#ffffff'}}>{'long: ' + value.long}</Typography>
        </div>
    }

    static buildReverseGeocode(value) {
        return <div>
            <Async
                promise={PhotoDetailsRenderer.reverseGeocode(value)}
                then={val => {
                    val = val === 'Not found' ? 'lat: '+ value.lat + ', ' + 'long: ' + value.long : val;
                    return <div>{val}</div>
                }} />
        </div>
    }

    static getLocation(value) {
        const url = 'https://www.google.com/maps/@'+value.lat+','+value.long+',15z';
        return <span>
                <Tooltip title={PhotoDetailsRenderer.showTooltipContent(value)}>
                <a href={url}
                   target="_blank" rel="noopener noreferrer">{PhotoDetailsRenderer.buildReverseGeocode(value)}</a>
            </Tooltip>
        </span>
    }

    static reverseGeocode(value) {
        const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng='+value.lat+','+value.long;
        const noAddress = 'Not found';
        return fetch(url).then(response => {
            return response.json();
        }).then(json => {
            Logger.info('reverseGeocode ' + json);
            let address = get(json, 'results[0].formatted_address');
            if(!address) {
                address = noAddress;
            }
            return address;
        }).catch(() => {
            return noAddress;
        });
    }
}