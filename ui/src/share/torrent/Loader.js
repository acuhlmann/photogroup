import moment from 'moment';
import FileUtil from "../util/FileUtil";

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
        const downloaded = FileUtil.prettyBytes(torrent.downloaded);
        const total = FileUtil.prettyBytes(torrent.length);

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
        const downloadSpeed = FileUtil.prettyBytes(torrent.downloadSpeed) + '/s';
        const uploadSpeed = FileUtil.prettyBytes(torrent.uploadSpeed) + '/s';

        this.parent.setState({
            peers: peers, completed: completed,
            downloaded: downloaded, total: total,
            remaining: remaining,
            downloadSpeed: downloadSpeed, uploadSpeed: uploadSpeed
        });
    }
}