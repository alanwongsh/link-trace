"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-renders the page every few seconds while active, such as while a bulk upload runs.
export function AutoRefresh({ active, seconds = 3 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [active, seconds, router]);
  return null;
}
