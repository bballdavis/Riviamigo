import type { VehicleImages, VehicleStatus } from '@riviamigo/types';

export type DoorKey = 'front_left' | 'front_right' | 'rear_left' | 'rear_right' | 'frunk' | 'rear_gate' | 'tonneau' | 'side_bin_left' | 'side_bin_right';

export function getOpenDoorStates(status: VehicleStatus | null | undefined): DoorKey[] {
  const states: Array<{ key: DoorKey; open: boolean }> = [
    { key: 'front_left', open: status?.door_front_left_closed === false },
    { key: 'front_right', open: status?.door_front_right_closed === false },
    { key: 'rear_left', open: status?.door_rear_left_closed === false },
    { key: 'rear_right', open: status?.door_rear_right_closed === false },
    { key: 'frunk', open: status?.closure_frunk_closed === false },
    { key: 'rear_gate', open: status?.closure_liftgate_closed === false || status?.closure_tailgate_closed === false },
    { key: 'tonneau', open: status?.tonneau_closed === false },
    { key: 'side_bin_left', open: status?.side_bin_left_closed === false },
    { key: 'side_bin_right', open: status?.side_bin_right_closed === false },
  ];
  return states.filter((state) => state.open).map((state) => state.key);
}

export function getDoorOverlayUrls(images: VehicleImages['all'] | undefined, openDoors: DoorKey[], designPreference: 'light' | 'dark'): string[] {
  if (!images || openDoors.length === 0) return [];
  const overheadImages = images.filter((image) => normalizePlacement(image.placement) === 'overhead');
  const urls = openDoors.map((door) => findBestDoorOverlay(overheadImages, door, designPreference)).filter((url): url is string => Boolean(url));
  return Array.from(new Set(urls));
}

export function findFirstOverheadImage(images: VehicleImages['all'] | undefined, design?: 'light' | 'dark'): string | undefined {
  if (!images) return undefined;
  if (design) {
    const preferred = images.find((image) => normalizePlacement(image.placement) === 'overhead' && designMatches(image.design, design));
    if (preferred?.url) return preferred.url;
  }
  return images.find((image) => normalizePlacement(image.placement) === 'overhead')?.url;
}

export function findFirstSideImage(images: VehicleImages['all'] | undefined, design?: 'light' | 'dark'): string | undefined {
  if (!images) return undefined;
  if (design) {
    const preferred = images.find((image) => normalizePlacement(image.placement) === 'side' && !isChargingSidePlacement(image.placement) && designMatches(image.design, design));
    if (preferred?.url) return preferred.url;
  }
  return images.find((image) => normalizePlacement(image.placement) === 'side' && !isChargingSidePlacement(image.placement))?.url;
}

export function findSideChargingImage(images: VehicleImages['all'] | undefined, design?: 'light' | 'dark'): string | undefined {
  if (!images) return undefined;
  if (design) {
    const preferred = images.find((image) => isChargingSideImage(image) && designMatches(image.design, design));
    if (preferred?.url) return preferred.url;
  }
  return images.find((image) => isChargingSideImage(image))?.url;
}

export function findBestChargingSideOverlay(images: VehicleImages['all'] | undefined, designPreference: 'light' | 'dark') {
  if (!images) return undefined;
  const sideImages = images.filter((image) => normalizePlacement(image.placement) === 'side');
  const tokenSets = [
    ['charging', 'light'],
    ['charge', 'light'],
    ['charge', 'port'],
    ['port', 'open'],
  ];

  for (const tokens of tokenSets) {
    const preferred = sideImages.find((image) => designMatches(image.design, designPreference) && tokens.every((token) => imageText(image).includes(token)));
    if (preferred?.url) return preferred.url;
  }

  for (const tokens of tokenSets) {
    const fallback = sideImages.find((image) => tokens.every((token) => imageText(image).includes(token)));
    if (fallback?.url) return fallback.url;
  }

  return undefined;
}

function findBestDoorOverlay(images: VehicleImages['all'], door: DoorKey, designPreference: 'light' | 'dark'): string | undefined {
  const tokenSets = doorImageTokenSets(door);
  for (const tokens of tokenSets) {
    const preferred = images.find((image) => designMatches(image.design, designPreference) && tokens.every((token) => imageText(image).includes(token)));
    if (preferred?.url) return preferred.url;
  }
  for (const tokens of tokenSets) {
    const fallback = images.find((image) => tokens.every((token) => imageText(image).includes(token)));
    if (fallback?.url) return fallback.url;
  }
  return undefined;
}

function doorImageTokenSets(door: DoorKey): string[][] {
  switch (door) {
    case 'front_left':
      return [['front', 'left', 'open']];
    case 'front_right':
      return [['front', 'right', 'open']];
    case 'rear_left':
      return [['rear', 'left', 'open']];
    case 'rear_right':
      return [['rear', 'right', 'open']];
    case 'frunk':
      return [['frunk', 'open']];
    case 'rear_gate':
      return [['tailgate', 'open'], ['liftgate', 'open'], ['hatch', 'open']];
    case 'tonneau':
      return [['tonneau', 'open']];
    case 'side_bin_left':
      return [['side', 'bin', 'left', 'open'], ['side_bin_left_open']];
    case 'side_bin_right':
      return [['side', 'bin', 'right', 'open'], ['side_bin_right_open']];
    default:
      return [['open']];
  }
}

function normalizePlacement(value: string | null | undefined): 'side' | 'overhead' | 'front' | 'rear' | 'unknown' {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('side')) return 'side';
  if (normalized.includes('overhead') || normalized.includes('top') || normalized.includes('bird')) return 'overhead';
  if (normalized.includes('front')) return 'front';
  if (normalized.includes('rear') || normalized.includes('back')) return 'rear';
  return 'unknown';
}

function isChargingSidePlacement(value: string | null | undefined) {
  const normalized = (value ?? '').toLowerCase();
  return normalized.includes('side') && (normalized.includes('charging') || normalized.includes('charge'));
}

function isChargingSideImage(image: VehicleImages['all'][number]) {
  const text = imageText(image);
  return isChargingSidePlacement(image.placement) || text.includes('side-charging') || text.includes('side_charging');
}

function designMatches(value: string | null | undefined, expected: 'light' | 'dark') {
  return (value ?? '').toLowerCase().includes(expected);
}

function imageText(image: VehicleImages['all'][number]) {
  return `${image.placement ?? ''} ${image.design ?? ''} ${image.url ?? ''} ${JSON.stringify(image.metadata ?? {})}`.toLowerCase();
}
