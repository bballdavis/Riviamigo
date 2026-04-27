import type { Preview } from '@storybook/react';
import '../src/tokens/globals.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark',  value: '#0A0A0F' },
        { name: 'light', value: '#FAFAF7' },
      ],
    },
    layout: 'padded',
  },
  decorators: [
    (Story, ctx) => {
      const bg = ctx.globals?.backgrounds?.value;
      const isDark = bg !== '#FAFAF7';
      document.documentElement.className = isDark ? 'dark' : 'light';
      return Story();
    },
  ],
};

export default preview;
