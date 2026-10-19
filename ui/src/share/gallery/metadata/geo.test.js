import { describe, it, expect, vi } from 'vitest';
import {
    describeAddress, extractLocation, formatDecimal, formatDirection, formatDms, fromTilePosition, isValidLocation, mapLinks,
    parseCoordinate, parseIso6709, reverseGeocode, searchPlaces, tilePosition,
} from './geo';
import ExifParser from './ExifParser';

describe('parseCoordinate', () => {
    it('reads EXIF degree/minute/second arrays, rationals included', () => {
        expect(parseCoordinate([31, 13, 49.44], 'N')).toBeCloseTo(31.2304, 4);
        expect(parseCoordinate([33, 52, 4.2], 'S')).toBeCloseTo(-33.86783, 4);
        expect(parseCoordinate([{ numerator: 151, denominator: 1 }, { numerator: 12, denominator: 1 }, { numerator: 264, denominator: 10 }], 'E'))
            .toBeCloseTo(151.20733, 4);
    });

    it("reads XMP's degrees,minutes text with the hemisphere letter at the end", () => {
        expect(parseCoordinate('47,22.6N')).toBeCloseTo(47.37667, 4);
        expect(parseCoordinate('8,32.5W')).toBeCloseTo(-8.54167, 4);
        expect(parseCoordinate('33,52,4.2S')).toBeCloseTo(-33.86783, 4);
    });

    it('reads plain decimals and descriptive text', () => {
        expect(parseCoordinate('-74.0060')).toBeCloseTo(-74.006, 4);
        expect(parseCoordinate(40.7128, 'S')).toBeCloseTo(-40.7128, 4);
        expect(parseCoordinate('47 deg 22\' 36.00" N')).toBeCloseTo(47.37667, 4);
    });

    it('gives NaN for anything else', () => {
        expect(parseCoordinate('junk')).toBeNaN();
        expect(parseCoordinate(undefined)).toBeNaN();
        expect(parseCoordinate([])).toBeNaN();
    });
});

describe('extractLocation', () => {
    it('collects altitude, direction, accuracy and GPS time from exifr output', () => {
        const location = extractLocation({
            latitude: 31.2304, longitude: 121.4737, GPSAltitude: 12, GPSAltitudeRef: { 0: 0 },
            GPSImgDirection: 123.4, GPSHPositioningError: 5, GPSDateStamp: '2024:05:01', GPSTimeStamp: '10:20:30',
        });
        expect(location).toEqual({
            lat: 31.2304, long: 121.4737, altitude: 12, direction: 123.4, accuracy: 5, time: '2024-05-01T10:20:30.000Z',
        });
    });

    it('puts altitudes below sea level below zero', () => {
        expect(extractLocation({ latitude: 31.5, longitude: 35.5, GPSAltitude: 430, GPSAltitudeRef: { 0: 1 } }).altitude).toBe(-430);
    });

    it('ignores 0,0, which cameras without a fix write', () => {
        expect(extractLocation({ GPSLatitude: [0, 0, 0], GPSLongitude: [0, 0, 0] })).toBeNull();
        expect(isValidLocation(0, 0)).toBe(false);
        expect(isValidLocation(91, 0)).toBe(false);
    });

    it('lets ExifParser keep XMP-only GPS instead of dropping it', () => {
        const data = { GPSLatitude: '47,22.6N', GPSLongitude: '8,32.5E' };
        ExifParser.parse(data);
        expect(data['x-Location'].lat).toBeCloseTo(47.37667, 4);
        expect(data['x-Location'].long).toBeCloseTo(8.54167, 4);
        expect(data.GPSLatitude).toBeUndefined();
    });
});

describe('ISO 6709', () => {
    it('reads QuickTime location strings with and without altitude', () => {
        expect(parseIso6709('+31.2304+121.4737/')).toEqual({ lat: 31.2304, long: 121.4737 });
        expect(parseIso6709('+47.3769+008.5417+408.000/')).toEqual({ lat: 47.3769, long: 8.5417, altitude: 408 });
        expect(parseIso6709('-33.8678+151.2073/')).toEqual({ lat: -33.8678, long: 151.2073 });
        expect(parseIso6709('nowhere')).toBeNull();
    });
});

describe('describing a location', () => {
    it('formats coordinates, direction and map links', () => {
        expect(formatDecimal(-33.86783, 151.20733)).toBe('33.86783° S, 151.20733° E');
        expect(formatDms(31.2304, 121.4737)).toBe('31°13′49.4″N 121°28′25.3″E');
        expect(formatDirection(359)).toBe('359° N');
        expect(formatDirection(123.4)).toBe('123° SE');
        const [google, amap, osm] = mapLinks(31.2304, 121.4737, 'Bund');
        expect(google.href).toBe('https://www.google.com/maps/search/?api=1&query=31.230400,121.473700');
        expect(amap.href).toBe('https://uri.amap.com/marker?position=121.473700,31.230400&name=Bund&coordinate=wgs84&callnative=0');
        expect(osm.href).toContain('mlat=31.230400&mlon=121.473700');
    });

    it('finds the map tile under a point', () => {
        const { x, y } = tilePosition(0, 0, 1);
        expect(x).toBeCloseTo(1, 6);
        expect(y).toBeCloseTo(1, 6);
    });

    it('turns map tile positions back into coordinates', () => {
        const { x, y } = tilePosition(31.2304, 121.4737, 15);
        const back = fromTilePosition(x, y, 15);
        expect(back.lat).toBeCloseTo(31.2304, 6);
        expect(back.long).toBeCloseTo(121.4737, 6);
        // Dragging past the date line wraps around
        expect(fromTilePosition(-0.25, 0.5, 0).long).toBeCloseTo(90, 6);
    });

    it('searches places and names them briefly', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ([
                { name: 'The Bund', display_name: 'The Bund, Zhongshan East 1st Road, Huangpu, Shanghai, China',
                    lat: '31.2400', lon: '121.4905', address: { suburb: 'Huangpu', city: 'Shanghai', country: 'China' } },
                { name: '', display_name: 'Nowhere', lat: 'x', lon: '0' },
            ]),
        });
        const found = searchPlaces('bund shanghai', fetcher);
        await vi.runAllTimersAsync();
        expect(await found).toEqual([{
            name: 'The Bund, Huangpu, Shanghai, China',
            label: 'The Bund, Zhongshan East 1st Road, Huangpu, Shanghai, China',
            lat: 31.24, long: 121.4905,
        }]);
        expect(fetcher.mock.calls[0][0]).toContain('/search?format=jsonv2&addressdetails=1&limit=6&q=bund%20shanghai');
        expect(await searchPlaces('   ', fetcher)).toEqual([]);
        vi.useRealTimers();
    });

    it('names a place from district, city and country', () => {
        expect(describeAddress({ address: { suburb: 'Huangpu', city: 'Shanghai', state: 'Shanghai', country: 'China' } }))
            .toBe('Huangpu, Shanghai, China');
        expect(describeAddress({ address: { state: 'Valais', country: 'Switzerland' } })).toBe('Valais, Switzerland');
        expect(describeAddress({ display_name: 'Somewhere at sea' })).toBe('Somewhere at sea');
    });

    it('looks a place up once and retries after a failure', async () => {
        vi.useFakeTimers();
        const ok = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ address: { town: 'Zermatt', country: 'Switzerland' } }) });
        const first = reverseGeocode(46.0207, 7.7491, ok);
        const again = reverseGeocode(46.0207, 7.7491, ok);
        await vi.runAllTimersAsync();
        expect(await first).toBe('Zermatt, Switzerland');
        expect(await again).toBe('Zermatt, Switzerland');
        expect(ok).toHaveBeenCalledTimes(1);

        const failing = vi.fn().mockResolvedValue({ ok: false, status: 429 });
        const failed = reverseGeocode(10.5, 20.5, failing);
        await vi.runAllTimersAsync();
        expect(await failed).toBeNull();
        const retried = reverseGeocode(10.5, 20.5, ok);
        await vi.runAllTimersAsync();
        expect(await retried).toBe('Zermatt, Switzerland');
        vi.useRealTimers();
    });
});
