"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";

/** Vuelve a pedir el resumen al servidor (router.refresh: sin perder scroll). */
export function RefreshButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn-new btn-new--secondary btn-new--sm bdash-btn-icon"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      aria-live="polite"
    >
      <RefreshCw size={14} className={pending ? "bdash-spin" : undefined} aria-hidden />
      {pending ? busyLabel : label}
    </button>
  );
}
