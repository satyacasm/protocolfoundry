"use client";

/**
 * Global feedback toast. Server actions redirect with ?notice=… (success) or
 * ?error=… (failure); this surfaces them as a fixed overlay that auto-dismisses
 * and strips the param from the URL, so the user always gets confirmation —
 * even when the triggering control is far down the page.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function ToastInner() {
  const router = useRouter();
  const params = useSearchParams();
  const notice = params.get("notice");
  const error = params.get("error");
  const message = error ?? notice;
  const kind = error ? "error" : "ok";

  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setShown(message);
    // strip the param so a refresh / back doesn't replay the toast
    const next = new URLSearchParams(Array.from(params.entries()));
    next.delete("notice");
    next.delete("error");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    const t = setTimeout(() => setShown(null), error ? 9000 : 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!shown) return null;
  return (
    <div className={`toast toast-${kind}`} role="status" aria-live="polite">
      <span className="toast-icon">{kind === "error" ? "!" : "✓"}</span>
      <span className="toast-msg">{shown}</span>
      <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setShown(null)}>
        ✕
      </button>
    </div>
  );
}

export function Toast() {
  // useSearchParams must sit inside a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <ToastInner />
    </Suspense>
  );
}
