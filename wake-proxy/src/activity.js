/**
 * Persist last user-activity timestamp using GCE instance metadata so the
 * wake runtime SA (which already has compute.instanceAdmin) can read/write
 * without needing extra Storage IAM.
 */
export class ActivityStore {
  /**
   * @param {{ gce: { getInstance: Function, instances: { setMetadata: Function }, projectId: string, zone: string, instance: string }, metadataKey?: string }} opts
   */
  constructor(opts) {
    this.gce = opts.gce;
    this.metadataKey = opts.metadataKey || 'wake-last-activity-ms';
    this._memoryTs = 0;
  }

  /**
   * @returns {Promise<number>} epoch ms of last activity (0 if unknown)
   */
  async getLastActivityMs() {
    try {
      const vm = await this.gce.getInstance();
      const items = vm.metadata?.items || [];
      const hit = items.find((i) => i.key === this.metadataKey);
      const ts = Number(hit?.value) || 0;
      this._memoryTs = Math.max(this._memoryTs, ts);
      return this._memoryTs;
    } catch (err) {
      console.error('[wake-proxy] activity read failed:', err.message);
      return this._memoryTs;
    }
  }

  /**
   * Record activity now (best-effort).
   * @returns {Promise<number>}
   */
  async touch() {
    const ts = Date.now();
    this._memoryTs = ts;
    try {
      const vm = await this.gce.getInstance();
      const fingerprint = vm.metadata?.fingerprint;
      if (!fingerprint) {
        console.error('[wake-proxy] activity write skipped: no metadata fingerprint');
        return ts;
      }
      const items = [...(vm.metadata?.items || [])].filter((i) => i.key !== this.metadataKey);
      items.push({ key: this.metadataKey, value: String(ts) });
      await this.gce.instances.setMetadata({
        project: this.gce.projectId,
        zone: this.gce.zone,
        instance: this.gce.instance,
        metadataResource: { fingerprint, items },
      });
      // Intentionally do not wait on the zone operation — best-effort for idle tracking.
    } catch (err) {
      console.error('[wake-proxy] activity write failed:', err.message);
    }
    return ts;
  }
}
