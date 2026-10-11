"use client";

import { useEffect } from "react";

/**
 * iOS Safari does not resize the layout viewport when the keyboard opens, so a
 * bottom composer in a fixed shell sits under it. While the keyboard is up this
 * writes the visible area to --kb-top / --kb-height on <html> and sets
 * data-kb; CSS then sizes the shell to it. Browsers that resize the layout
 * viewport themselves (interactive-widget=resizes-content) never trip the
 * threshold, so nothing changes there.
 */
const KEYBOARD_MIN_PX = 120;

export function useKeyboardViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const sync = () => {
      const open = root.clientHeight - vv.height > KEYBOARD_MIN_PX;
      if (open) {
        root.style.setProperty("--kb-top", `${vv.offsetTop}px`);
        root.style.setProperty("--kb-height", `${vv.height}px`);
        root.dataset.kb = "";
      } else {
        delete root.dataset.kb;
        root.style.removeProperty("--kb-top");
        root.style.removeProperty("--kb-height");
      }
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      delete root.dataset.kb;
      root.style.removeProperty("--kb-top");
      root.style.removeProperty("--kb-height");
    };
  }, []);
}
