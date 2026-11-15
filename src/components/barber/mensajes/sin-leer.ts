"use client";

import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// El contador de «Mensajes» del menú.
//
// Sale de la MISMA API que pinta la bandeja (/api/barber/whatsapp/threads),
// con su mismo candado (whatsapp.view + whatsappInbox): el menú solo pide
// si la entrada «Mensajes» está en el menú, y esa entrada ya pasó ese
// candado en el layout. Nada nuevo en el servidor.
//
// Cuenta CHATS con algo sin leer, no mensajes sueltos: es lo que dice
// WhatsApp Business («3 chats sin leer») y lo que el mostrador atiende.
// ═══════════════════════════════════════════════════════════════════════

export const MENSAJES_SIN_LEER_EVENT = "barber:mensajes-sin-leer";

/** Chats con al menos un mensaje sin leer. */
export function chatsSinLeer(threads: ReadonlyArray<{ unread: number }>): number {
  return threads.filter((th) => th.unread > 0).length;
}

/**
 * La bandeja avisa al menú cada vez que recarga la lista: así el contador
 * baja en cuanto se contesta, sin esperar al siguiente sondeo.
 */
export function avisarSinLeer(count: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(MENSAJES_SIN_LEER_EVENT, { detail: count }));
}

const CADA_MS = 60_000;

export function useMensajesSinLeer(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let vivo = true;

    async function leer() {
      // Pestaña escondida: no se gasta una consulta que nadie va a ver.
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/barber/whatsapp/threads?archived=0", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { threads?: Array<{ unread: number }> };
        if (vivo && Array.isArray(data.threads)) setCount(chatsSinLeer(data.threads));
      } catch {
        // Un contador que no se pudo leer se queda como estaba: nunca rompe el menú.
      }
    }

    function onAviso(e: Event) {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === "number" && Number.isFinite(n)) setCount(n);
    }
    function onVisible() {
      if (document.visibilityState === "visible") void leer();
    }

    void leer();
    const id = window.setInterval(() => void leer(), CADA_MS);
    window.addEventListener(MENSAJES_SIN_LEER_EVENT, onAviso);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      vivo = false;
      window.clearInterval(id);
      window.removeEventListener(MENSAJES_SIN_LEER_EVENT, onAviso);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
