"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Sticky bar that slides away while scrolling down and returns on the way up. Static without script. */
export function RetractingBar({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = window.scrollY;
    let ticking = false;
    const update = () => {
      const y = window.scrollY;
      const down = y > last + 4;
      const up = y < last - 4;
      // stay put near the top, and whenever focus is inside the bar (keyboard users)
      if (y < 240 || el.contains(document.activeElement)) el.dataset.hidden = "false";
      else if (down) el.dataset.hidden = "true";
      else if (up) el.dataset.hidden = "false";
      if (down || up) last = y;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    const onFocus = () => (el.dataset.hidden = "false");
    window.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("scroll", onScroll);
      el.removeEventListener("focusin", onFocus);
    };
  }, []);

  return (
    <div ref={ref} className={className} data-hidden="false">
      {children}
    </div>
  );
}
