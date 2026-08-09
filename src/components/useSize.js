import { useLayoutEffect, useRef, useState } from 'react';

const round = (n) => Math.round(n);

/**
 * Element size. Measured synchronously on mount, then kept current by a
 * ResizeObserver.
 *
 * The synchronous first measurement matters: ResizeObserver callbacks are
 * delivered as part of the rendering steps, which a browser skips entirely for
 * a backgrounded or hidden tab. Relying on the observer alone leaves the size
 * at 0 forever in that case, and anything gated on a non-zero size (the card
 * grid, every chart) silently never renders.
 */
export function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (width, height) =>
      setSize((prev) =>
        prev.width === round(width) && prev.height === round(height)
          ? prev
          : { width: round(width), height: round(height) }
      );

    const rect = el.getBoundingClientRect();
    apply(rect.width, rect.height);

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      apply(width, height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}
