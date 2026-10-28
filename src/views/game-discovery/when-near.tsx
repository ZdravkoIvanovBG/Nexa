import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollRootContext } from "@/components/row";

/**
 * Mounts children once they scroll within `margin` of the page's scroll
 * container. Unlike LazyMount there is no safety timer: every Games row costs
 * a RAWG request, so rows the user never scrolls to are never fetched.
 */
export function WhenNear({
  children,
  fallback,
  minHeight,
  margin = "400px",
}: {
  children: ReactNode;
  fallback?: ReactNode;
  minHeight: number;
  margin?: string;
}) {
  const root = useContext(ScrollRootContext);
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near || !root) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { root, rootMargin: `${margin} 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, root, margin]);

  if (near) return <>{children}</>;
  return (
    <div ref={ref} style={{ minHeight }} aria-hidden>
      {fallback}
    </div>
  );
}
