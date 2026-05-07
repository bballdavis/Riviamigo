import React from 'react';

export function useMeasuredWidgetHeight(fallback = 260, minimum = 140) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = React.useState(fallback);

  React.useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    const update = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.height > 0) {
        setHeight(Math.floor(bounds.height));
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, height: Math.max(minimum, height || fallback) };
}
