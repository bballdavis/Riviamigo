export type VehicleGateCapability = 'liftgate' | 'tailgate';

/**
 * Resolve the single rear-closure capability that a known Rivian model should
 * display. Unknown models intentionally return null so observed telemetry can
 * decide which field is available instead of assuming both gates exist.
 */
export function resolveVehicleGateCapability(
  model: string | null | undefined
): VehicleGateCapability | null {
  const normalized = model?.trim().toUpperCase() ?? '';
  if (normalized.includes('R1T')) return 'tailgate';
  if (normalized.includes('R1S') || normalized.includes('R2S')) return 'liftgate';
  return null;
}
