import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  /** Fixed row height in px — every row must render at exactly this height */
  itemHeight: number;
  /** Vertical gap between rows in px */
  gap?: number;
  /** Extra rows rendered above/below the viewport */
  overscan?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  ariaLabel?: string;
}

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const overflowY = getComputedStyle(el).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Windowed list for long, fixed-height rows. Uses the nearest scrollable ancestor as the viewport,
 * so it can sit inside a modal body that also contains other content.
 */
export function VirtualList<T>({ items, itemHeight, gap = 0, overscan = 8, renderItem, ariaLabel }: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, 40) });
  const step = itemHeight + gap;
  const totalHeight = Math.max(0, items.length * step - gap);

  const update = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const scrollParent = findScrollParent(container);
    if (!scrollParent) {
      setRange({ start: 0, end: items.length });
      return;
    }
    const listTop =
      container.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop;
    const viewTop = scrollParent.scrollTop - listTop;
    const start = Math.max(0, Math.floor(viewTop / step) - overscan);
    const end = Math.min(items.length, Math.ceil((viewTop + scrollParent.clientHeight) / step) + overscan);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [items.length, step, overscan]);

  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    const container = containerRef.current;
    const scrollParent = findScrollParent(container);
    if (!scrollParent) return;

    // setRange bails out when the window is unchanged, so updating on every scroll event is cheap
    scrollParent.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scrollParent.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [update]);

  const visible = items.slice(range.start, range.end);

  return (
    <div ref={containerRef} role="list" aria-label={ariaLabel} style={{ position: 'relative', height: totalHeight }}>
      {visible.map((item, i) => {
        const index = range.start + i;
        return (
          <div
            key={index}
            role="listitem"
            aria-posinset={index + 1}
            aria-setsize={items.length}
            style={{ position: 'absolute', top: index * step, left: 0, right: 0, height: itemHeight }}
          >
            {renderItem(item, index)}
          </div>
        );
      })}
    </div>
  );
}
