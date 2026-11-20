/**
 * Decodes an encoded polyline (the Google format) into points.
 *
 * `precision` is the number of decimal digits the line was encoded with: five
 * for the original format, six for the higher-precision variant. A malformed
 * line decodes to an empty list rather than a partial path.
 */
export function decodePolyline(encoded: string, precision = 5): Array<{ lat: number; lng: number }> {
  const factor = 10 ** precision;
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const nextDelta = (): number | null => {
    let value = 0;
    let shift = 0;
    for (;;) {
      // Six 5-bit groups hold any coordinate at up to six decimal digits.
      if (index >= encoded.length || shift > 25) return null;
      const chunk = encoded.charCodeAt(index) - 63;
      index += 1;
      if (chunk < 0 || chunk > 63) return null;
      value |= (chunk & 0x1f) << shift;
      shift += 5;
      if (chunk < 0x20) break;
    }
    return value & 1 ? ~(value >> 1) : value >> 1;
  };

  while (index < encoded.length) {
    const latDelta = nextDelta();
    const lngDelta = latDelta === null ? null : nextDelta();
    if (latDelta === null || lngDelta === null) return [];
    lat += latDelta;
    lng += lngDelta;
    const point = { lat: lat / factor, lng: lng / factor };
    if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return [];
    points.push(point);
  }
  return points;
}
