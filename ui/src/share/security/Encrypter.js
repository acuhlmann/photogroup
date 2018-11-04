import Logger from "js-logger";
import FileUtil from "../util/FileUtil";
import EncrypterUtil from "../util/EncrypterUtil";

export default class Encrypter {

    static encryptPic(file, secure, password, callback) {
        if(secure) {
            FileUtil.blobToDataURL(file, dataUrl => {

                const encrypted = EncrypterUtil.encryptText(dataUrl, password);
                const encryptedUrl = 'data:image/jpeg;base64,sec' + encrypted;
                const blob = FileUtil.dataURLtoBlob(encryptedUrl);

                callback(blob);
            });
        } else {
            callback(file);
        }
    }

    static decryptPic(elem, password, callback) {
        FileUtil.blobToDataURL(elem, dataUrl => {

            const withoutHeader = dataUrl.substring(40, dataUrl.length);
            try {
                const decrypted = EncrypterUtil.decryptText(withoutHeader, password);
                const blob = FileUtil.dataURLtoBlob(decrypted);
                callback(blob);
            } catch (e) {
                Logger.error('Wrong Password?');
            }
        });
    }

    static isSecure(blob, callback) {

        FileUtil.blobToDataURL(blob, dataUrl => {
            const marker = dataUrl.substring(37, 40);
            return callback(marker === 'sec');
        });
    }
}