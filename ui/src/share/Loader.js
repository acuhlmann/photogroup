import moment from 'moment';

export default class Loader {

    start(torrent) {
        //torrent.on('done', this.onDone.bind(this, torrent));
        this.timer = setInterval(this.onProgress.bind(this), 500, torrent);
        this.parent.setState({show: true});
        this.onProgress(torrent);
    }

    onDone (torrent) {
        //this.onProgress(torrent);
        this.parent.setState({show: false});
        clearInterval(this.timer);
    }

    onProgress (torrent) {

        // Peers
        const peers = torrent.numPeers + (torrent.numPeers === 1 ? ' peer' : ' peers');

        // Progress
        const completed = Math.round(torrent.progress * 100 * 100) / 100;
        //const percent = completed + '%';
        const downloaded = this.prettyBytes(torrent.downloaded);
        const total = this.prettyBytes(torrent.length);

        // Remaining time
        let remaining;
        if (torrent.done) {
            remaining = 'Done.';
            this.onDone(torrent);
        } else {
            remaining = moment.duration(torrent.timeRemaining / 1000, 'seconds').humanize();
            remaining = remaining[0].toUpperCase() + remaining.substring(1) + ' remaining.'
        }

        // Speed rates
        const downloadSpeed = this.prettyBytes(torrent.downloadSpeed) + '/s';
        const uploadSpeed = this.prettyBytes(torrent.uploadSpeed) + '/s';

        this.parent.setState({
            peers: peers, completed: completed,
            downloaded: downloaded, total: total,
            remaining: remaining,
            downloadSpeed: downloadSpeed, uploadSpeed: uploadSpeed
        });
    }

    prettyBytes(num) {
        let exponent, unit, neg = num < 0, units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        if (neg) num = -num;
        if (num < 1) return (neg ? '-' : '') + num + ' B';
        exponent = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
        num = Number((num / Math.pow(1000, exponent)).toFixed(2));
        unit = units[exponent];
        return (neg ? '-' : '') + num + ' ' + unit
    }

}