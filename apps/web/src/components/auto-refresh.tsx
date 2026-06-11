"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch server-component data on an interval while a job is running. */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
