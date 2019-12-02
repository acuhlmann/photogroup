import _ from "lodash";
import prettyBytes from 'pretty-bytes';

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

    static formatBytes(bytes) {
        return prettyBytes(bytes);
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