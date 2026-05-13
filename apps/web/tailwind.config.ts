import type { Config } from 'tailwindcss';
import { tailwindBase } from '@riviamigo/config/tailwind/base';

export default {
  ...tailwindBase,
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '../../packages/dashboards/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
