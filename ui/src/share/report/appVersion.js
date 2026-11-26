/* global __APP_VERSION__ */

/** "1.4.2.317": the package version and, on a CI build, the build number. */
export function appVersion() {
    const base = (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) ? __APP_VERSION__ : 'dev';
    const build = import.meta?.env?.VITE_APP_VERSION;
    return build ? `${base}.${build}` : base;
}
