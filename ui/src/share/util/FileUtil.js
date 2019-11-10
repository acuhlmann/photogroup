import _ from "lodash";

export default class FileUtil {

    static getFileSuffix(name) {
        const matched = name.match(/\.[0-9a-z]+$/i);
        return matched ? matched[0] : '';
    }

    static  getFileNameWithoutSuffix(name) {
        const suffix = FileUtil.getFileSuffix(name);
        return _.replace(name, suffix, '');
    }

    static truncateFileName(name) {
        const fileSuffix = FileUtil.getFileSuffix(name);
        return _.truncate(FileUtil.getFileNameWithoutSuffix(name), {length: 30}) + fileSuffix
    }

    //https://stackoverflow.com/a/34166265
    static formatBytes(bytes) {
        const kb = 1024;
        const ndx = Math.floor( Math.log(bytes) / Math.log(kb) );
        const fileSizeTypes = ["bytes", "kb", "mb", "gb", "tb", "pb", "eb", "zb", "yb"];

        return {
            size: +(bytes / kb / kb).toFixed(2),
            type: fileSizeTypes[ndx]
        };
    }

    static prettyBytes(num) {
        let exponent, unit, neg = num < 0, units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        if (neg) num = -num;
        if (num < 1) return (neg ? '-' : '') + num + ' B';
        exponent = Math.min(Math.floor(Math.log(num) / Math.log(1000)), units.length - 1);
        num = Number((num / Math.pow(1000, exponent)).toFixed(2));
        unit = units[exponent];
        return (neg ? '-' : '') + num + ' ' + unit
    }

    //credits to https://gist.github.com/wuchengwei/b7e1820d39445f431aeaa9c786753d8e
    static blobToDataURL(blob, callback) {
        if(FileUtil.dataUrlByBlob.has(blob)) {
            callback(FileUtil.dataUrlByBlob.get(blob));
        } else {
            const reader = new FileReader();
            reader.onload = function(e) {
                const dataUrl = e.target.result;
                FileUtil.dataUrlByBlob.set(blob, dataUrl);
                callback(dataUrl);
            };
            reader.readAsDataURL(blob);
        }
    }

    static dataURLtoBlob(dataUrl) {
        if(FileUtil.blobByDataUrl.has(dataUrl)) {
            return FileUtil.blobByDataUrl.get(dataUrl);
        } else {
            let arr = dataUrl.split(','), mime = arr[0].match(/:(.*?);/)[1],
                bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
            while(n--){
                u8arr[n] = bstr.charCodeAt(n);
            }
            const blob = new Blob([u8arr], {type:mime});
            FileUtil.blobByDataUrl.set(dataUrl, blob);
            return blob;
        }
    }
}

FileUtil.dataUrlByBlob = new Map();
FileUtil.blobByDataUrl = new Map();