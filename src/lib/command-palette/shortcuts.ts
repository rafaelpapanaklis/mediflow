"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const GO_TO_MAP: Record<string, string> = {
  h: "/dashboard",
  a: "/dashboard/appointments",
  p: "/dashboard/patients",
  m: "/dashboard/whatsapp",
  f: "/dashboard/billing",
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
  /**
   * A dónde manda «G A». La barra del menú de dos niveles pasa la agenda
   * nueva (`/dashboard/agenda`); sin esto —la barra de siempre— «G A» sigue
   * mandando a la agenda de siempre, como hasta hoy.
   */
  rutaAgenda?: string;
}

export function useGoToShortcuts({ enabled, rutaAgenda }: UseGoToShortcutsOptions) {
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
        const destino = key === "a" && rutaAgenda ? rutaAgenda : GO_TO_MAP[key];
        if (destino) {
          e.preventDefault();
          router.push(destino);
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
  }, [enabled, router, rutaAgenda]);
}

interface UseCreateShortcutsOptions {
  enabled: boolean;
  onCreateAppointment?: () => void;
  onCreatePatient?: () => void;
  onCreateInvoice?: () => void;
  onCreateSoap?: () => void;
  onToggleTheme?: () => void;
}

/**
 * Shortcuts de creación con letras sueltas (sin Cmd/Ctrl).
 * Pattern de Linear/Superhuman: single-letter cuando no hay foco en input.
 * No chocan con shortcuts del browser.
 *
 * Letras:
 *   C  → Cita nueva
 *   N  → Nuevo paciente
 *   I  → Invoice/factura
 *   T  → Toggle tema
 *   S  → SOAP (requiere paciente activo, activo cuando useActiveConsult
 *        retorne valor en Fase 2.3)
 */
export function useCreateShortcuts(opts: UseCreateShortcutsOptions) {
  const { enabled } = opts;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (isTypingContext()) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

      const key = e.key.toLowerCase();

      switch (key) {
        case "c":
          e.preventDefault();
          opts.onCreateAppointment?.();
          break;
        case "n":
          e.preventDefault();
          opts.onCreatePatient?.();
          break;
        case "i":
          e.preventDefault();
          opts.onCreateInvoice?.();
          break;
        case "t":
          e.preventDefault();
          opts.onToggleTheme?.();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, opts]);
}
