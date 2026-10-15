import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityStore } from '../src/activity.js';

describe('ActivityStore', () => {
  it('reads and writes GCE instance metadata', async () => {
    let items = [];
    let fingerprint = 'fp1';
    const gce = {
      getInstance: async () => ({
        metadata: { fingerprint, items: [...items] },
      }),
      setMetadata: mock.fn(async (metadata) => {
        items = metadata.items;
        fingerprint = 'fp2';
      }),
    };
    const store = new ActivityStore({ gce });
    assert.equal(await store.getLastActivityMs(), 0);
    const ts = await store.touch();
    assert.ok(ts > 0);
    assert.equal(gce.setMetadata.mock.callCount(), 1);
    assert.equal(await store.getLastActivityMs(), ts);
    assert.equal(items.find((i) => i.key === 'wake-last-activity-ms')?.value, String(ts));
  });
});
