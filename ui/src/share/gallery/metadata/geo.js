import Logger from 'js-logger';

// Where a photo or video was taken: reading coordinates in the shapes EXIF,
// XMP and QuickTime store them, describing them, and naming the place.

/** A number from a plain value or an EXIF {numerator, denominator} rational. */
function toNumber(value) {
    if (value && typeof value === 'object' && 'numerator' in value) {
        return Number(value.numerator) / Number(value.denominator);
    }
    return typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
}

function signed(decimal, hemisphere) {
    const ref = String(hemisphere || '').trim().toUpperCase()[0];
    return ref === 'S' || ref === 'W' ? -Math.abs(decimal) : decimal;
}

/**
 * Decimal degrees from any of the usual shapes: a number, a [deg, min, sec]
 * array (numbers or rationals), XMP's "47,22.6N" / "47,22,36N", or text such
 * as "47 deg 22' 36.00\" N" or "-8.5417". The reference (N/S/E/W) can come
 * separately or as a trailing letter. Returns NaN when nothing fits.
 */
export function parseCoordinate(value, reference) {
    if (value == null) return NaN;
    if (Array.isArray(value)) {
        if (!value.length) return NaN;
        const [degrees, minutes = 0, seconds = 0] = value.map(toNumber);
        const decimal = degrees + minutes / 60 + seconds / 3600;
        return Number.isFinite(decimal) ? signed(decimal, reference) : NaN;
    }
    if (typeof value === 'number' || typeof value === 'object') {
        const decimal = toNumber(value);
        return Number.isFinite(decimal) ? signed(decimal, reference) : NaN;
    }
    const text = String(value).trim();
    const hemisphere = (text.match(/[NSEW]\s*$/i) || [])[0] || reference;
    const parts = text.replace(/[NSEW]\s*$/i, '').match(/[-+]?\d+(?:\.\d+)?/g);
    if (!parts || parts.length > 3) return NaN;
    const [degrees, minutes = 0, seconds = 0] = parts.map(Number);
    const decimal = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    return signed(degrees < 0 || /^\s*-/.test(text) ? -decimal : decimal, hemisphere);
}

/** Valid coordinates; 0,0 is what cameras without a fix often write, so it counts as none. */
export function isValidLocation(lat, long) {
    return Number.isFinite(lat) && Number.isFinite(long)
        && Math.abs(lat) <= 90 && Math.abs(long) <= 180
        && !(lat === 0 && long === 0);
}

const NUMBER = '[-+]?\\d{1,3}(?:\\.\\d+)?';
const PASTED = [
    // Google Maps: the pin's own place, then the map's centre.
    new RegExp(`!3d(${NUMBER})!4d(${NUMBER})`),
    new RegExp(`@(${NUMBER}),(${NUMBER})`),
    // ?q=, ?ll=, ?query= and geo: links.
    new RegExp(`(?:[?&](?:q|ll|query|center)=|geo:)(${NUMBER})(?:,|%2C)\\s*(${NUMBER})`, 'i'),
    // "47.37, 8.54" or "47.37 8.54".
    new RegExp(`^\\s*(${NUMBER})\\s*[,;\\s]\\s*(${NUMBER})\\s*$`),
];

/**
 * Coordinates from pasted text: "47.37, 8.54", a Google Maps link, or a
 * geo: link. Null when the text is a place name to search for.
 */
export function parseLocationText(text) {
    const value = String(text || '').trim();
    for (const pattern of PASTED) {
        const match = pattern.exec(value);
        if (!match) continue;
        const lat = Number(match[1]);
        const long = Number(match[2]);
        if (isValidLocation(lat, long)) return { lat, long };
    }
    return null;
}

/** "+31.2304+121.4737+012.000/" (ISO 6709, as QuickTime and Android write it). */
export function parseIso6709(text) {
    const match = String(text || '').match(/^\s*([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/);
    if (!match) return null;
    const lat = Number(match[1]);
    const long = Number(match[2]);
    if (!isValidLocation(lat, long)) return null;
    const location = { lat, long };
    if (match[3] !== undefined) location.altitude = Number(match[3]);
    return location;
}

function gpsTime(date, time) {
    if (!date) return null;
    const day = String(date).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    let clock = '00:00:00';
    if (Array.isArray(time)) {
        clock = time.map(part => String(Math.floor(toNumber(part))).padStart(2, '0')).join(':');
    } else if (time) {
        clock = String(time).split('.')[0];
    }
    const parsed = new Date(`${day}T${clock}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Raw GPS fields (and exifr's derived latitude/longitude), folded into the location instead of shown as rows. */
export function isGpsKey(key) {
    return key.startsWith('GPS') || key === 'latitude' || key === 'longitude';
}

/**
 * The location in exifr output (EXIF GPS or XMP exif:GPS*), as
 * {lat, long, altitude?, direction?, accuracy?, time?}, or null.
 */
export function extractLocation(data) {
    const lat = Number.isFinite(data.latitude) ? data.latitude : parseCoordinate(data.GPSLatitude, data.GPSLatitudeRef);
    const long = Number.isFinite(data.longitude) ? data.longitude : parseCoordinate(data.GPSLongitude, data.GPSLongitudeRef);
    if (!isValidLocation(lat, long)) return null;

    const location = { lat, long };
    const altitude = toNumber(data.GPSAltitude);
    if (Number.isFinite(altitude)) {
        // exifr returns the ref as a one-byte buffer ({0: 1}) or a number; 1 means below sea level.
        const ref = data.GPSAltitudeRef;
        const below = ref === 1 || ref === '1' || (ref && typeof ref === 'object' && ref[0] === 1);
        location.altitude = below ? -Math.abs(altitude) : altitude;
    }
    const direction = toNumber(data.GPSImgDirection);
    if (Number.isFinite(direction)) location.direction = direction;
    const accuracy = toNumber(data.GPSHPositioningError);
    if (Number.isFinite(accuracy) && accuracy > 0) location.accuracy = accuracy;
    const time = gpsTime(data.GPSDateStamp, data.GPSTimeStamp);
    if (time) location.time = time;
    return location;
}

function dms(value, positive, negative) {
    const abs = Math.abs(value);
    let degrees = Math.floor(abs);
    let minutes = Math.floor((abs - degrees) * 60);
    let seconds = Math.round(((abs - degrees) * 60 - minutes) * 60 * 10) / 10;
    if (seconds >= 60) { seconds = 0; minutes += 1; }
    if (minutes >= 60) { minutes = 0; degrees += 1; }
    return `${degrees}°${minutes}′${seconds}″${value < 0 ? negative : positive}`;
}

/** "31.23040° N, 121.47370° E" */
export function formatDecimal(lat, long) {
    return `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(long).toFixed(5)}° ${long < 0 ? 'W' : 'E'}`;
}

/** "31°13′49.4″N 121°28′25.3″E" */
export function formatDms(lat, long) {
    return `${dms(lat, 'N', 'S')} ${dms(long, 'E', 'W')}`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** "123° SE" for the direction the camera faced. */
export function formatDirection(degrees) {
    const normalized = ((degrees % 360) + 360) % 360;
    return `${Math.round(normalized)}° ${COMPASS[Math.round(normalized / 45) % 8]}`;
}

/** Links to the place in Google Maps, Amap and OpenStreetMap. */
export function mapLinks(lat, long, label) {
    const latText = lat.toFixed(6);
    const longText = long.toFixed(6);
    const name = encodeURIComponent(label || 'Photo location');
    return [
        { id: 'google', label: 'Google Maps', href: `https://www.google.com/maps/search/?api=1&query=${latText},${longText}` },
        // Amap shifts WGS-84 (GPS) to its own datum when told the source is GPS.
        { id: 'amap', label: 'Amap 高德', href: `https://uri.amap.com/marker?position=${longText},${latText}&name=${name}&coordinate=wgs84&callnative=0` },
        { id: 'osm', label: 'OpenStreetMap', href: `https://www.openstreetmap.org/?mlat=${latText}&mlon=${longText}#map=16/${latText}/${longText}` },
    ];
}

/** Slippy-map tile position (fractional) of a point at a zoom level. */
export function tilePosition(lat, long, zoom) {
    const scale = 2 ** zoom;
    const latRad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
    return {
        x: ((long + 180) / 360) * scale,
        y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
    };
}

/** The point at a fractional slippy-map tile position; the inverse of tilePosition. */
export function fromTilePosition(x, y, zoom) {
    const scale = 2 ** zoom;
    const wrapped = ((x % scale) + scale) % scale;
    const clampedY = Math.max(0, Math.min(scale, y));
    return {
        lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * clampedY) / scale))) * 180) / Math.PI,
        long: (wrapped / scale) * 360 - 180,
    };
}

/** "Huangpu, Shanghai, China" from a Nominatim address. */
export function describeAddress(result) {
    const address = (result && result.address) || {};
    const area = address.suburb || address.city_district || address.neighbourhood || address.quarter;
    const locality = address.city || address.town || address.village || address.municipality || address.hamlet
        || address.county;
    const region = locality ? null : address.state;
    const parts = [area, locality, region, address.country].filter(Boolean);
    const unique = parts.filter((part, index) => parts.indexOf(part) === index);
    if (unique.length) return unique.join(', ');
    return (result && result.display_name) || null;
}

const placeCache = new Map();
const knownPlaces = new Map();
const placeListeners = new Set();

/** The place name already looked up for these coordinates, without asking again; undefined if not yet. */
export function knownPlaceName(lat, long) {
    return knownPlaces.get(`${lat},${long}`);
}

/** Be told whenever a place name arrives; returns the unsubscribe function. */
export function onPlaceName(listener) {
    placeListeners.add(listener);
    return () => placeListeners.delete(listener);
}
let queue = Promise.resolve();
const NOMINATIM_SPACING_MS = 1100; // its usage policy allows one request per second

const language = () => (typeof navigator !== 'undefined' && navigator.language) || 'en';

/** Run a Nominatim request in turn, one per second, as its usage policy asks. */
function inTurn(request) {
    const result = queue.then(request);
    queue = result.then(() => new Promise(resolve => setTimeout(resolve, NOMINATIM_SPACING_MS)));
    return result;
}

/**
 * Places matching a search, as [{name, label, lat, long}], from Nominatim.
 * `name` is short ("The Bund, Huangpu, Shanghai, China"); `label` is its
 * full address. Throws when the service can't be reached.
 */
export function searchPlaces(query, fetcher = (...args) => fetch(...args)) {
    const text = String(query || '').trim();
    if (!text) return Promise.resolve([]);
    return inTurn(async () => {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6`
            + `&q=${encodeURIComponent(text)}&accept-language=${encodeURIComponent(language())}`;
        const response = await fetcher(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Place search failed (' + response.status + ')');
        const results = await response.json();
        return (Array.isArray(results) ? results : []).map(result => {
            const area = describeAddress({ address: result.address });
            const name = result.name && !(area || '').startsWith(result.name)
                ? [result.name, area].filter(Boolean).join(', ') : (area || result.display_name);
            return { name, label: result.display_name, lat: Number(result.lat), long: Number(result.lon) };
        }).filter(place => isValidLocation(place.lat, place.long));
    });
}

/**
 * The place name for coordinates from OpenStreetMap's Nominatim, or null.
 * Lookups are cached and spaced out to respect the service's rate limit.
 */
export function reverseGeocode(lat, long, fetcher = (...args) => fetch(...args)) {
    const key = `${lat},${long}`;
    if (placeCache.has(key)) return placeCache.get(key);

    const lookup = inTurn(async () => {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${long}`
            + `&accept-language=${encodeURIComponent(language())}`;
        try {
            const response = await fetcher(url, { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('status ' + response.status);
            const name = describeAddress(await response.json());
            knownPlaces.set(key, name);
            placeListeners.forEach(listener => listener(key, name));
            return name;
        } catch (error) {
            Logger.warn('reverse geocode failed: ' + error.message);
            placeCache.delete(key); // try again next time
            return null;
        }
    });
    placeCache.set(key, lookup);
    return lookup;
}
