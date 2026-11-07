import { useEffect, useState, type CSSProperties } from 'react';

/**
 * While `active`, the part of the page on screen, as a fixed element's position and size. On a phone
 * zoomed into the page, `inset: 0` covers the whole page width, which leaves its edges, and the
 * controls placed there, off screen.
 */
export function useVisibleArea(active: boolean): CSSProperties | undefined {
  const [area, setArea] = useState<CSSProperties>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const update = () =>
      setArea({ left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height });
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [active]);
  return active ? area : undefined;
}
