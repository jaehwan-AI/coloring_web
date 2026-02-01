import { useEffect } from "react";

export function useViewportVars(headerSelector = ".appHeader") {
  useEffect(() => {
    const setVars = () => {
      const vv = window.visualViewport;
      const height = vv?.height ?? window.innerHeight;

      document.documentElement.style.setProperty("--vvh", `${Math.round(height)}px`);

      const header = document.querySelector(headerSelector) as HTMLElement | null;
      if (header) {
        const h = Math.ceil(header.getBoundingClientRect().height);
        document.documentElement.style.setProperty("--header-h", `${h}px`);
      }
    };

    setVars();

    const vv = window.visualViewport;
    const onVV = () => setVars();

    vv?.addEventListener("resize", onVV);
    vv?.addEventListener("scroll", onVV);
    window.addEventListener("resize", onVV);
    window.addEventListener("orientationchange", () => setTimeout(onVV, 200));

    return () => {
      vv?.removeEventListener("resize", onVV);
      vv?.removeEventListener("scroll", onVV);
      window.removeEventListener("resize", onVV);
    };
  }, [headerSelector]);
}
