//credits https://github.com/sh-dv/hat.sh/blob/master/src/js/app.js
export default class WebCrypto {

    constructor() {
        //declarations
        this.DEC = {
            signature: "RW5jcnlwdGVkIFVzaW5nIEhhdC5zaA", //add a line in the file that says "encrypted by Hat.sh :)"
            hash: "SHA-512",
            algoName1: "PBKDF2",
            algoName2: "AES-GCM",
            algoLength: 256,
            itr: 80000,
            salt: window.crypto.getRandomValues(new Uint8Array(16)),
            perms1: ["deriveKey"],
            perms2: ['encrypt', 'decrypt'],
        }
    }

    //import key
    // import the entered key from the password input
    importSecretKey(password) {
        let rawPassword = this.str2ab(password); // convert the password entered in the input to an array buffer
        return window.crypto.subtle.importKey(
            "raw", //raw
            rawPassword, // array buffer password
            {
                name: this.DEC.algoName1
            }, //the algorithm you are using
            false, //whether the derived key is extractable
            this.DEC.perms1 //limited to the option deriveKey
        );
    }

    //better function to convert string to array buffer
    //as done in the webcrypto documentation
    str2ab(str) {
        const buf = new ArrayBuffer(str.length);
        const bufView = new Uint8Array(buf);
        for (let i = 0, strLen = str.length; i < strLen; i++) {
            bufView[i] = str.charCodeAt(i);
        }
        return buf;
    }

    async deriveEncryptionSecretKey(password) { //derive the secret key from a master key.

        let getSecretKey = await this.importSecretKey(password);

        return window.crypto.subtle.deriveKey({
                name: this.DEC.algoName1,
                salt: this.DEC.salt,
                iterations: this.DEC.itr,
                hash: {
                    name: this.DEC.hash
                },
            },
            getSecretKey, //your key from importKey
            { //the key type you want to create based on the derived bits
                name: this.DEC.algoName2,
                length: this.DEC.algoLength,
            },
            false, //whether the derived key is extractable
            this.DEC.perms2 //limited to the options encrypt and decrypt
        )
    }

    //file encryption function
    async encryptFile(files, password) {

        const derivedKey = await this.deriveEncryptionSecretKey(password); //requiring the key
        const file = files[0]; //file input
        const fr = new FileReader(); //request a file read

        const self = this;
        return new Promise((resolve, reject) => {

            fr.onloadstart = async () => {
                console.log('encrypting...');
            };

            fr.onload = async () => { //load

                const iv = window.crypto.getRandomValues(new Uint8Array(16)); //generate a random iv
                const content = new Uint8Array(fr.result); //encoded file content
                // encrypt the file
                await window.crypto.subtle.encrypt({
                    iv,
                    name: self.DEC.algoName2
                }, derivedKey, content)
                    .then(function (encrypted) {
                        //returns an ArrayBuffer containing the encrypted data
                        resolve(self.processFinished('Encrypted-' + file.name,
                            [window.atob(self.DEC.signature),
                                iv, self.DEC.salt, new Uint8Array(encrypted)], 1,
                            password.value)); //create the new file buy adding signature and iv and content
                        //console.log("file has been successuflly encrypted");
                        //resetInputs(); // reset file and key inputs when done
                    })
                    .catch(function (err) {
                        const msg = 'An error occured while Encrypting the file, try again! ' + err;
                        console.error(msg);
                        reject(msg);
                    });
                console.log('done encrypting.');
            };
            //read the file as buffer
            fr.readAsArrayBuffer(file)
        });
    }

    //file decryption function

    async decryptFile(files, password, name) {

        const file = files[0]; //file input
        const fr = new FileReader(); //request a file read

        const self = this;
        return new Promise((resolve, reject) => {

            fr.onloadstart = async () => {
                console.log('decrypting...');
            };

            fr.onload = async () => { //load

                async function deriveDecryptionSecretKey() { //derive the secret key from a master key.

                    let getSecretKey = await self.importSecretKey(password);

                    return window.crypto.subtle.deriveKey({
                            name: self.DEC.algoName1,
                            salt: new Uint8Array(fr.result.slice(38, 54)), //get salt from encrypted file.
                            iterations: self.DEC.itr,
                            hash: {
                                name: self.DEC.hash
                            },
                        },
                        getSecretKey, //your key from importKey
                        { //the key type you want to create based on the derived bits
                            name: self.DEC.algoName2,
                            length: self.DEC.algoLength,
                        },
                        false, //whether the derived key is extractable
                        self.DEC.perms2 //limited to the options encrypt and decrypt
                    )
                    //console.log the key
                    // .then(function(key){
                    //     //returns the derived key
                    //     console.log(key);
                    // })
                    // .catch(function(err){
                    //     console.error(err);
                    // });

                }

                //console.log(fr.result);
                const derivedKey = await deriveDecryptionSecretKey(); //requiring the key

                const iv = new Uint8Array(fr.result.slice(22, 38)); //take out encryption iv

                const content = new Uint8Array(fr.result.slice(54)); //take out encrypted content

                await window.crypto.subtle.decrypt({
                    iv,
                    name: self.DEC.algoName2
                }, derivedKey, content)
                    .then(function (decrypted) {
                        //returns an ArrayBuffer containing the decrypted data


                        resolve(self.processFinished(name.replace('Encrypted-', ''),
                            [new Uint8Array(decrypted)], 2, password)); //create new file from the decrypted content
                        //console.log("file has been successuflly decrypted");
                        //resetInputs(); // reset file and key inputs when done
                    })
                    .catch(function (err) {
                        const msg = "Error while decrypting. " + err;
                        console.error(msg);
                        reject(msg);
                    });

                console.log('done decrypting.');
            };

            fr.readAsArrayBuffer(file) //read the file as buffer
        });
    }

    //this function generates the html tag and provieds the file that needs to be downloaded as an html tag
    processFinished(name, data, method, dKey) {
        //methods 1->encryption , 2->decryption

        const blob = new Blob(data, {
            type: 'application/octet-stream'
        }); // meaning download this file
        const url = URL.createObjectURL(blob); //create a url for blob
        console.log('url ' + url);
        return {data: data, blob: blob, url: url};
    }
}