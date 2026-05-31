export const colors = {
  accent: {
    50:  '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D',
    400: '#FDBA74', 500: '#FD8304', 600: '#EA580C', 700: '#C2410C',
    800: '#92400E', 900: '#78350F',
  },
  slate: {
    50:  '#FAFAF7', 100: '#F4F4EE', 200: '#E5E5DD', 300: '#D4D4C8',
    400: '#A1A1A1', 500: '#71717A', 600: '#52525B', 700: '#3F3F46',
    800: '#27272A', 850: '#1A1A24', 900: '#12121A', 950: '#0A0A0F',
  },
  soc: {
    high: '#10B981',
    mid:  '#FD8304',
    low:  '#F87171',
  },
  charging: {
    active:  'var(--rm-charging-active)',
    done:    'var(--rm-charging-done)',
    limited: 'var(--rm-charging-limited)',
    ac:      'var(--rm-charging-ac)',
    dc:      'var(--rm-charging-dc)',
    dcfc:    'var(--rm-charging-dcfc)',
  },
  dataViz: {
    amber:   '#FD8304',
    yellow:  '#FACC15',
    sky:     '#60A5FA',
    emerald: '#10B981',
    violet:  '#A78BFA',
    rose:    '#F87171',
    teal:    '#34D399',
    orange:  '#FB923C',
    indigo:  '#818CF8',
  },
  bg: {
    page:     'var(--rm-bg-page)',
    surface:  'var(--rm-bg-surface)',
    elevated: 'var(--rm-bg-elevated)',
    glass:    'var(--rm-bg-glass)',
    overlay:  'var(--rm-bg-overlay)',
  },
  text: {
    primary:   'var(--rm-text-primary)',
    secondary: 'var(--rm-text-secondary)',
    tertiary:  'var(--rm-text-tertiary)',
    disabled:  'var(--rm-text-disabled)',
    onAccent:  'var(--rm-text-on-accent)',
  },
  border: {
    default: 'var(--rm-border-default)',
    strong:  'var(--rm-border-strong)',
    accent:  'var(--rm-border-accent)',
    focus:   '#FD8304',
  },
} as const;

export type DataVizKey = keyof typeof colors.dataViz;
export const dataViz = colors.dataViz;
