"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const GO_TO_MAP: Record<string, string> = {
  h: "/dashboard",
  a: "/dashboard/appointments",
  p: "/dashboard/patients",
  m: "/dashboard/whatsapp",
  f: "/dashboard/billing",
  e: "/dashboard/clinical",
  r: "/dashboard/xrays",
  i: "/dashboard/ai-assistant",
  s: "/dashboard/settings",
};

function isTypingContext(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

interface UseGoToShortcutsOptions {
  enabled: boolean;
}

export function useGoToShortcuts({ enabled }: UseGoToShortcutsOptions) {
  const router = useRouter();
  const awaitingG = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const clearPending = () => {
      awaitingG.current = false;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const handler = (e: KeyboardEvent) => {
      if (isTypingContext()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (awaitingG.current) {
        const key = e.key.toLowerCase();
        if (GO_TO_MAP[key]) {
          e.preventDefault();
          router.push(GO_TO_MAP[key]);
        }
        clearPending();
        return;
      }

      if (e.key.toLowerCase() === "g" && !e.shiftKey) {
        awaitingG.current = true;
        timeoutRef.current = window.setTimeout(clearPending, 600);
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearPending();
    };
  }, [enabled, router]);
}

interface UseCreateShortcutsOptions {
  enabled: boolean;
  onCreateAppointment?: () => void;
  onCreatePatient?: () => void;
  onCreateInvoice?: () => void;
  onCreateSoap?: () => void;
  onToggleTheme?: () => void;
}

export function useCreateShortcuts(opts: UseCreateShortcutsOptions) {
  const { enabled } = opts;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      if (e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case "p":
            e.preventDefault();
            opts.onCreatePatient?.();
            break;
          case "f":
            e.preventDefault();
            opts.onCreateInvoice?.();
            break;
          case "s":
            e.preventDefault();
            opts.onCreateSoap?.();
            break;
          case "d":
            e.preventDefault();
            opts.onToggleTheme?.();
            break;
        }
      } else {
        if (e.key.toLowerCase() === "n") {
          e.preventDefault();
          opts.onCreateAppointment?.();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, opts]);
}
