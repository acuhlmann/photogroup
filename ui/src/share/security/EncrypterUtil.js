import aes from 'crypto-js/aes';
import CryptoJS from 'crypto-js';

export default class EncrypterUtil {

    static encryptText(message, secret) {

        const encrypted = aes.encrypt(message, secret).toString();
        return encrypted;
    }

    static decryptText(encrypted, secret) {

        const bytes = aes.decrypt(encrypted, secret);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        return decrypted;
    }

    static encryptObj(message, secret) {

        const encrypted = aes.encrypt(JSON.stringify(message), secret).toString();
        return encrypted;
    }

    static decryptObj(encrypted, secret) {

        const bytes = aes.decrypt(encrypted, secret);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        return JSON.parse(decrypted);
    }
}