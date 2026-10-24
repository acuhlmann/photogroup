import { describe, it, expect } from 'vitest';
import { requestPersistentStorage, persistentStorageGranted } from '../PersistentStorage';

const storage = (over = {}) => ({
    persist: async () => true,
    persisted: async () => false,
    ...over,
});

describe('requestPersistentStorage', () => {
    it('asks the browser to keep what this device saved', async () => {
        const asked = [];
        const granted = await requestPersistentStorage(storage({
            persist: async () => { asked.push(1); return true; },
        }));
        expect(asked).toHaveLength(1);
        expect(granted).toBe(true);
    });

    it('does not ask twice when it already has it', async () => {
        const asked = [];
        const granted = await requestPersistentStorage(storage({
            persist: async () => { asked.push(1); return true; },
            persisted: async () => true,
        }));
        expect(asked).toHaveLength(0);
        expect(granted).toBe(true);
    });

    it('reports a refusal instead of throwing', async () => {
        expect(await requestPersistentStorage(storage({ persist: async () => false }))).toBe(false);
    });

    it('survives a browser that cannot answer', async () => {
        expect(await requestPersistentStorage({})).toBe(false);
        expect(await requestPersistentStorage(undefined)).toBe(false);
        expect(await requestPersistentStorage(storage({ persist: async () => { throw new Error('denied'); } }))).toBe(false);
    });

    it('reads the granted state without asking for it', async () => {
        expect(await persistentStorageGranted(storage({ persisted: async () => true }))).toBe(true);
        expect(await persistentStorageGranted({})).toBe(false);
        expect(await persistentStorageGranted(storage({
            persisted: async () => { throw new Error('nope'); },
        }))).toBe(false);
    });
});
