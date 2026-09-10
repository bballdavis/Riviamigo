/** Original Riviamigo RAD vector masters. No fonts, images, or external references. */
const gold = '#FFB000';
const red = '#E34427';
const teal = '#087F83';
const ink = '#10363B';
const white = '#FFFFFF';
const faviconInk = '#123B43';
const faviconRed = '#F26A2E';
const faviconTeal = '#008F8C';

// The open road forms the leg of the R; three terrain bands carry the RAD palette.
const badge = `<path fill="${ink}" d="M24 0h208l24 24v208l-24 24H24L0 232V24Z"/>
  <path fill="${gold}" d="M24 16h69v224H24l-8-8V24Z"/>
  <path fill="${red}" d="M93 16h70v224H93Z"/>
  <path fill="${teal}" d="M163 16h69l8 8v208l-8 8h-69Z"/>
  <path fill="${white}" fill-rule="evenodd" d="M52 56h96c38 0 56 18 56 48 0 23-13 40-34 46l42 50h-44l-43-50H88v50H52Zm36 32v34h58c15 0 22-6 22-17 0-12-7-17-22-17Z"/>`;

// Purpose-drawn extended lettering. Outlines keep every host's rendering identical.
const letters = {
  R: 'M0 0H42Q60 0 60 18V22Q60 36 46 39L64 60H46L29 40H14V60H0ZM14 12V28H40Q46 28 46 22V18Q46 12 40 12Z',
  I: 'M0 0H14V60H0Z',
  V: 'M0 0H15L32 44 49 0H64L40 60H24Z',
  A: 'M24 0H40L66 60H51L46 48H18L13 60H0ZM23 36H41L32 14Z',
  M: 'M0 60V0H15L34 26 53 0H68V60H54V22L34 48 14 22V60Z',
  G: 'M20 0H58V12H22Q14 12 14 20V40Q14 48 22 48H46V36H31V24H60V60H20Q0 60 0 40V20Q0 0 20 0Z',
  O: 'M20 0H42Q62 0 62 20V40Q62 60 42 60H20Q0 60 0 40V20Q0 0 20 0ZM22 12Q14 12 14 20V40Q14 48 22 48H40Q48 48 48 40V20Q48 12 40 12Z',
};
const widths = { R: 64, I: 14, V: 64, A: 66, M: 68, G: 60, O: 62 };
function wordmark(paint) {
  let x = 0;
  const paths = [...'RIVIAMIGO'].map((letter) => {
    const path = `<path transform="translate(${x} 0)" d="${letters[letter]}"/>`;
    x += widths[letter] + 12;
    return path;
  }).join('\n    ');
  return `<g transform="translate(4 8)" fill="${paint}" fill-rule="evenodd">${paths}</g>
  <path fill="${gold}" d="M4 84h170v10H4Z"/>
  <path fill="${red}" d="M178 84h170v10H178Z"/>
  <path fill="${teal}" d="M352 84h174v10H352Z"/>`;
}
const svg = (title, viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title">
  <title id="title">${title}</title>
  ${body}
</svg>
`;

export function radAssets() {
  return {
    'rad-logo.svg': svg('Riviamigo RAD logo', '0 0 256 256', badge),
    'rad-icon.svg': svg('Riviamigo RAD icon', '0 0 256 256', badge),
    // The favicon is intentionally simplified so the R and color signature remain legible at 16px.
    'rad-favicon.svg': svg('Riviamigo RAD favicon', '0 0 32 32', `<rect x="1" y="1" width="30" height="30" rx="6" fill="${faviconInk}"/><path fill="${white}" fill-rule="evenodd" d="M7 6h11.25C23.5 6 26 8.7 26 12.5c0 2.7-1.2 4.9-3.8 6.2l4.5 7.3h-5.8l-4-6.3H12v6.3H7V6Zm5 4.5v4.7h5.6c2.1 0 3.4-.8 3.4-2.35s-1.3-2.35-3.4-2.35Z"/><path fill="${gold}" d="M4 27h8v2H4Z"/><path fill="${faviconRed}" d="M12 27h8v2h-8Z"/><path fill="${faviconTeal}" d="M20 27h8v2h-8Z"/>`),
    'rad-text_white.svg': svg('Riviamigo RAD wordmark', '0 0 530 104', wordmark(white)),
    'rad-text_black.svg': svg('Riviamigo RAD wordmark', '0 0 530 104', wordmark(ink)),
  };
}
