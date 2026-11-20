import { describe, expect, it } from 'vitest';
import { decodePolyline } from './polyline';

describe('decodePolyline', () => {
  it('decodes the published example at five digits', () => {
    // The worked example from Google's encoded polyline format documentation.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });

  it('reads the same digits at six-digit precision as a tenth of the distance', () => {
    expect(decodePolyline('_p~iF~ps|U', 6)).toEqual([{ lat: 3.85, lng: -12.02 }]);
  });

  it('decodes nothing rather than a partial path from a malformed line', () => {
    expect(decodePolyline('')).toEqual([]);
    // Ends in the middle of a number.
    expect(decodePolyline('_p~iF~ps|')).toEqual([]);
    // A latitude with no longitude.
    expect(decodePolyline('_p~iF')).toEqual([]);
    // Characters outside the encoding's alphabet.
    expect(decodePolyline('_p~iF ~ps|U')).toEqual([]);
    // A number that never terminates.
    expect(decodePolyline('~'.repeat(40))).toEqual([]);
    // Off the globe: the example read with one digit too few.
    expect(decodePolyline('_p~iF~ps|U', 4)).toEqual([]);
  });
});
