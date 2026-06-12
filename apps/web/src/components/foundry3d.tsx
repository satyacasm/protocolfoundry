"use client";

/**
 * Real CSS 3D for the porcelain design language.
 * - <FoundryPrism/>: a machined hexagonal prism with orbital rings, built from
 *   preserve-3d faces. Spins slowly on its own and tilts toward the pointer.
 * - <Tilt/>: wraps a card; tilts it in 3D toward the cursor with a moving
 *   glare highlight. Used by the project cards on the overview page.
 * Both bail out under prefers-reduced-motion.
 */

import { useEffect, useRef, type ReactNode } from "react";

const FACES = 6;
/** Half the face width over tan(30°): circumradius of the hex cross-section. */
const FACE_W = 92;
const APOTHEM = FACE_W / 2 / Math.tan(Math.PI / FACES);

export function FoundryPrism() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    const animate = () => {
      curX += (targetX - curX) * 0.06;
      curY += (targetY - curY) * 0.06;
      scene.style.setProperty("--tilt-x", `${curY.toFixed(2)}deg`);
      scene.style.setProperty("--tilt-y", `${curX.toFixed(2)}deg`);
      raf = requestAnimationFrame(animate);
    };
    const onMove = (e: PointerEvent) => {
      // Tilt toward the pointer from anywhere on the page, gently.
      targetX = (e.clientX / innerWidth - 0.5) * 26;
      targetY = (0.5 - e.clientY / innerHeight) * 18;
    };
    addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(animate);
    return () => {
      removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={sceneRef} className="f3d-scene" aria-hidden="true">
      <div className="f3d-tilt">
        <div className="f3d-spin">
          {Array.from({ length: FACES }, (_, i) => (
            <div
              key={i}
              className="f3d-face"
              style={{
                transform: `rotateY(${i * (360 / FACES)}deg) translateZ(${APOTHEM.toFixed(1)}px)`,
              }}
            >
              <span className="f3d-etch" />
            </div>
          ))}
          <div className="f3d-cap f3d-cap-top" />
          <div className="f3d-cap f3d-cap-bottom" />
        </div>
        <div className="f3d-ring f3d-ring-a" />
        <div className="f3d-ring f3d-ring-b" />
        <div className="f3d-mote f3d-mote-a" />
        <div className="f3d-mote f3d-mote-b" />
      </div>
      <div className="f3d-shadow" />
    </div>
  );
}

export function Tilt({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--card-rx", `${((0.5 - py) * 5).toFixed(2)}deg`);
        el.style.setProperty("--card-ry", `${((px - 0.5) * 6).toFixed(2)}deg`);
        el.style.setProperty("--glare-x", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--glare-y", `${(py * 100).toFixed(1)}%`);
      });
    };
    const onLeave = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.style.setProperty("--card-rx", "0deg");
      el.style.setProperty("--card-ry", "0deg");
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className={`tilt${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
