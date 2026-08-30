import { useEffect, useState } from "react";

/** Keeps responsive-only DOM out of desktop and test renders, not merely hidden with CSS. */
export function useMobileLayout(maxWidth = 680): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const getMatches = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
