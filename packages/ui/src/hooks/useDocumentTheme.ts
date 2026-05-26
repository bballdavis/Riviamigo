import * as React from 'react';

/** Returns `true` when the document root has the `dark` class (or lacks `light`). */
export function useDocumentTheme(): boolean {
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window === 'undefined') return true;
    const html = document.documentElement;
    return html.classList.contains('dark') || !html.classList.contains('light');
  });

  React.useEffect(() => {
    const html = document.documentElement;
    const update = () => {
      setIsDark(html.classList.contains('dark') || !html.classList.contains('light'));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
