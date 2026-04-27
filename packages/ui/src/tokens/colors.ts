export const colors = {
  accent: {
    50:  '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D',
    400: '#FBBF24', 500: '#F59E0B', 600: '#D97706', 700: '#B45309',
    800: '#92400E', 900: '#78350F',
  },
  slate: {
    50:  '#FAFAF7', 100: '#F4F4EE', 200: '#E5E5DD', 300: '#D4D4C8',
    400: '#A1A1A1', 500: '#71717A', 600: '#52525B', 700: '#3F3F46',
    800: '#27272A', 850: '#1A1A24', 900: '#12121A', 950: '#0A0A0F',
  },
  soc: {
    high: '#10B981',
    mid:  '#F59E0B',
    low:  '#F87171',
  },
  charging: {
    active:  '#F59E0B',
    done:    '#10B981',
    limited: '#F87171',
    ac:      '#60A5FA',
    dc:      '#A78BFA',
    dcfc:    '#C084FC',
  },
  dataViz: {
    amber:   '#F59E0B',
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
    focus:   '#F59E0B',
  },
} as const;

export type DataVizKey = keyof typeof colors.dataViz;
export const dataViz = colors.dataViz;
