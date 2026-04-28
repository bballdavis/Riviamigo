import type { Meta, StoryObj } from '@storybook/react';
import { LoginPage } from './login';

/**
 * Login page with modern branding treatment.
 *
 * Features:
 * - Amber R monogram with glow ring
 * - Glass morphism card with backdrop-blur
 * - Feature callouts (Trip analytics, Charge history, Battery health)
 * - Responsive layout with ambient gradient background
 * - Styled error messages with red inline box
 * - Toggle between login and register modes
 */
const meta = {
  title: 'Pages/Login',
  component: LoginPage,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof LoginPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default login page view showing the login form.
 * The component uses Zustand + React Router for auth state management,
 * so interactions (submit, toggle mode) work directly.
 */
export const Default: Story = {};
