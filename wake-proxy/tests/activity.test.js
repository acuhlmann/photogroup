import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityStore } from '../src/activity.js';

describe('ActivityStore', () => {
  it('reads and writes GCE instance metadata', async () => {
    let items = [];
    let fingerprint = 'fp1';
    const gce = {
      projectId: 'p',
      zone: 'z',
      instance: 'main',
      getInstance: async () => ({
        metadata: { fingerprint, items: [...items] },
      }),
      instances: {
        setMetadata: mock.fn(async ({ metadataResource }) => {
          items = metadataResource.items;
          fingerprint = 'fp2';
        }),
      },
    };
    const store = new ActivityStore({ gce });
    assert.equal(await store.getLastActivityMs(), 0);
    const ts = await store.touch();
    assert.ok(ts > 0);
    assert.equal(gce.instances.setMetadata.mock.callCount(), 1);
    assert.equal(await store.getLastActivityMs(), ts);
    assert.equal(items.find((i) => i.key === 'wake-last-activity-ms')?.value, String(ts));
  });
});
