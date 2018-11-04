import EncrypterUtil from './EncrypterUtil';

it('when encrypt string then encrypt', () => {

    const message = 'my message';
    const secret = 'my secret';

    const encrypted = EncrypterUtil.encryptText(message, secret);
    expect(encrypted).not.toEqual(message);
});

it('when encrypt string then decrypt', () => {

    const message = 'my message';
    const secret = 'my secret';

    const encrypted = EncrypterUtil.encryptText(message, secret);
    const decrypted = EncrypterUtil.decryptText(encrypted, secret);
    expect(decrypted).toEqual(message);
});

it('when encrypt obj then encrypt', () => {

    const message = [{id: 1}, {id: 2}];
    const secret = 'my secret';

    const encrypted = EncrypterUtil.encryptObj(message, secret);
    expect(encrypted).not.toEqual(message);
});

it('when encrypt obj then decrypt', () => {

    const message = [{id: 1}, {id: 2}];
    const secret = 'my secret';

    const encrypted = EncrypterUtil.encryptObj(message, secret);
    const decrypted = EncrypterUtil.decryptObj(encrypted, secret);
    expect(decrypted).toEqual(message);
});
