import _ from 'lodash';

export default class StringUtil {

    static addEmptySpaces(values, separator = ' ') {
        return values
            .filter(item => item)
            .map(value => value && value !== null ? value + separator : '')
            .join('').replace(/ $/,'');
    }

    static slimPlatform(platform) {
        let slimmed = platform.replace(' Windows ', ' Win ');

        let index, extract;
        index = slimmed.indexOf('Chrome Mobile');
        if(index > -1) {
            extract = slimmed.slice(index + 16, index + 26);
            slimmed = platform.replace(extract, '');
        } else if(slimmed.indexOf('Chrome ') > -1) {
            index = slimmed.indexOf('Chrome ');
            extract = slimmed.slice(index + 9, index + 19);
            slimmed = platform.replace(extract, '');
        }

        return slimmed;
    }

    static stripSrflx(label) {
        return label.replace(/srflx/, '');
    }

    static createNetworkLabel(item, ispSeparator='', noStripping) {
        // Always show IP address on first line
        const ip = item.ip || _.get(item, 'network.ip') || '';
        
        // Build location line: city, region, country with flag emoji
        const locationParts = [];
        if (noStripping ? item.typeDetail : StringUtil.stripSrflx(item.typeDetail)) {
            locationParts.push(noStripping ? item.typeDetail : StringUtil.stripSrflx(item.typeDetail));
        }
        const countryFlag = _.get(item, 'network.location.country_flag_emoji');
        if (countryFlag) {
            locationParts.push(countryFlag);
        }
        const city = _.get(item, 'network.city');
        const regionName = _.get(item, 'network.region_name');
        const country = _.get(item, 'network.country');
        
        const locationDetails = [];
        if (city) locationDetails.push(city);
        if (regionName) locationDetails.push(regionName);
        if (country) locationDetails.push(country);
        
        const locationLine = locationParts.length > 0 
            ? locationParts.join(' ') + (locationDetails.length > 0 ? ' ' + locationDetails.join(', ') : '')
            : locationDetails.join(', ');
        
        // Build ISP line
        const isp = _.get(item, 'network.connection.isp') || _.get(item, 'network.connection.org') || null;
        const hostname = _.get(item, 'network.hostname');
        
        // Build the full label with IP on first line
        const lines = [ip];
        
        if (locationLine) {
            lines.push(locationLine);
        }
        
        if (isp) {
            lines.push(isp);
        } else if (hostname) {
            lines.push(hostname);
        }
        
        return lines.join(ispSeparator || '\n');
    }
}