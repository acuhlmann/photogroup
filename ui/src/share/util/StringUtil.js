import _ from 'lodash';

export default class StringUtil {

    static addEmptySpaces(values) {
        return values
            .filter(item => item)
            .map(value => value && value !== null ? value + ' ' : '')
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

        let country = StringUtil.addEmptySpaces([
            noStripping ? item.typeDetail : StringUtil.stripSrflx(item.typeDetail),
            _.get(item, 'network.location.country_flag_emoji'),
            _.get(item, 'network.city')
        ]).trim();

        const host = StringUtil.addEmptySpaces([
            (_.get(item, 'network.connection.isp') || item.ip) + ispSeparator,
            _.get(item, 'network.hostname')
        ]);

        country = country ? country + ', ' : country;
        return country + host;
    }
}