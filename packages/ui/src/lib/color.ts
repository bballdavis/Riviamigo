export interface RgbColor { r: number; g: number; b: number }
export interface HslColor { h: number; s: number; l: number }
export interface OklchColor { l: number; c: number; h: number }

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 3) => Number(value.toFixed(digits));

export function normalizeHex(value: string): `#${string}` | null {
  const text = value.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(text)?.[1];
  if (short) return `#${[...short].map((digit) => digit + digit).join('').toLowerCase()}`;
  const full = /^#([0-9a-f]{6})$/i.exec(text)?.[1];
  return full ? `#${full.toLowerCase()}` : null;
}

export function hexToRgb(value: string): RgbColor | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: RgbColor): `#${string}` {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function parseCssColor(value: string): RgbColor | null {
  const hex = hexToRgb(value);
  if (hex) return hex;
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(value.trim());
  if (rgb) return { r: clamp(Number(rgb[1]), 0, 255), g: clamp(Number(rgb[2]), 0, 255), b: clamp(Number(rgb[3]), 0, 255) };
  const hsl = /^hsla?\(\s*([\d.-]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(value.trim());
  return hsl ? hslToRgb({ h: Number(hsl[1]), s: Number(hsl[2]), l: Number(hsl[3]) }) : null;
}

export function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const red = r / 255; const green = g / 255; const blue = b / 255;
  const max = Math.max(red, green, blue); const min = Math.min(red, green, blue);
  const delta = max - min; const l = (max + min) / 2;
  let h = 0;
  if (delta) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: round(h, 1), s: round(s * 100, 1), l: round(l * 100, 1) };
}

export function hslToRgb({ h, s, l }: HslColor): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s / 100); const lightness = clamp(l / 100);
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const srgbToLinear = (value: number) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const linearToSrgb = (value: number) => 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }: RgbColor): OklchColor {
  const lr = srgbToLinear(r); const lg = srgbToLinear(g); const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const yellowBlue = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.sqrt(a * a + yellowBlue * yellowBlue);
  let hue = Math.atan2(yellowBlue, a) * 180 / Math.PI;
  if (hue < 0) hue += 360;
  return { l: round(lightness * 100, 2), c: round(chroma, 4), h: round(hue, 2) };
}

function rawOklchToRgb({ l, c, h }: OklchColor): RgbColor {
  const lightness = l / 100; const radians = h * Math.PI / 180;
  const a = c * Math.cos(radians); const b = c * Math.sin(radians);
  const ll = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const ss = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: linearToSrgb(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
    g: linearToSrgb(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
    b: linearToSrgb(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
  };
}

export function oklchToHex(value: OklchColor): `#${string}` {
  const normalized = { l: clamp(value.l, 0, 100), c: Math.max(0, value.c), h: ((value.h % 360) + 360) % 360 };
  let rgb = rawOklchToRgb(normalized);
  const inGamut = ({ r, g, b }: RgbColor) => [r, g, b].every((channel) => channel >= 0 && channel <= 255);
  if (!inGamut(rgb)) {
    let low = 0; let high = normalized.c;
    for (let index = 0; index < 18; index += 1) {
      const candidate = (low + high) / 2;
      const next = rawOklchToRgb({ ...normalized, c: candidate });
      if (inGamut(next)) { low = candidate; rgb = next; } else high = candidate;
    }
  }
  return rgbToHex(rgb);
}

export function canonicalColor(value: string, fallback = '#fd8304'): `#${string}` {
  return normalizeHex(value) ?? rgbToHex(parseCssColor(value) ?? hexToRgb(fallback)!);
}

export function contrastRatio(first: string, second: string): number {
  const luminance = (value: string) => {
    const rgb = parseCssColor(value) ?? { r: 0, g: 0, b: 0 };
    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(srgbToLinear);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
