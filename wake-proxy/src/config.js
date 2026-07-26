/**
 * Runtime configuration for the wake proxy.
 * All values are overridable via environment variables for Cloud Run.
 */

function intEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env = process.env) {
  return {
    port: intEnv(env, 'PORT', 8080),
    projectId: env.GCP_PROJECT || env.GOOGLE_CLOUD_PROJECT || 'photogroup-215600',
    zone: env.GCE_ZONE || 'asia-east2-a',
    instance: env.GCE_INSTANCE || 'main',
    /** Origin scheme when talking to the VM (nginx TLS). */
    originScheme: env.ORIGIN_SCHEME || 'http',
    /** Health path on the origin (must return 200 when app is ready). */
    healthPath: env.HEALTH_PATH || '/api/__rtcConfig__',
    /** How long to wait for VM + app readiness before giving up (ms). */
    readyTimeoutMs: intEnv(env, 'READY_TIMEOUT_MS', 180_000),
    /** Interval between health polls (ms). */
    healthPollMs: intEnv(env, 'HEALTH_POLL_MS', 3_000),
    /** Rate-limit VM start attempts (ms). */
    startCooldownMs: intEnv(env, 'START_COOLDOWN_MS', 30_000),
    /**
     * Shared secret for /__wake__/stop (Cloud Scheduler / admin).
     * If empty, stop endpoint is disabled.
     */
    stopSecret: env.WAKE_STOP_SECRET || '',
    /**
     * Idle minutes used only for status reporting; actual auto-stop runs on the VM.
     */
    idleMinutesHint: intEnv(env, 'IDLE_MINUTES', 60),
    /**
     * Hackernews (Hackersbot) runs on a separate always-on VM — proxied directly,
     * without waking the PhotoGroup GCE instance.
     */
    hnOriginIp: env.HN_ORIGIN_IP || '',
    hnOriginScheme: env.HN_ORIGIN_SCHEME || 'http',
  };
}
