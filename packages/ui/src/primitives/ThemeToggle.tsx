import * as React from 'react';
import { Sun, Moon } from 'lucide-react';
import { cn } from '../lib/utils';

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    return document.documentElement.classList.contains('dark') ||
      !document.documentElement.classList.contains('light');
  });

  const toggle = React.useCallback(() => {
    const html = document.documentElement;
    if (isDark) {
      html.classList.remove('dark');
      html.classList.add('light');
      localStorage.setItem('rm-theme', 'light');
    } else {
      html.classList.remove('light');
      html.classList.add('dark');
      localStorage.setItem('rm-theme', 'dark');
    }
    setIsDark(!isDark);
  }, [isDark]);

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-lg',
        'text-fg-tertiary hover:text-fg hover:bg-bg-elevated',
        'transition-colors duration-150',
        className
      )}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
