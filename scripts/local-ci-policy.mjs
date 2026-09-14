export function selectHookGate(env = {}) {
  if (env.SKIP_LOCAL_CI === '1') return 'bypass';
  if (env.RIVIAMIGO_FULL_LOCAL_CI === '1') return 'full';
  return 'local';
}
