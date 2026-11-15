"use client";

import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// El contador de «Mensajes» del menú.
//
// Pide SOLO el número: /api/barber/whatsapp/unread devuelve { chats: n },
// que Postgres agrega con las mismas reglas que la lista de la bandeja.
// (Antes pedía /threads cada minuto: ~2 000 mensajes para quedarse con un
// número — revisión ronda 16.) Mismo candado que la bandeja: whatsapp.view
// + whatsappInbox; el menú solo lo pide si «Mensajes» está en el menú.
//
// Cuándo pregunta (lo decide quien llama con `sondear`):
//   · cada 2 min, y NUNCA con la pestaña escondida (el reloj se apaga y al
//     volver se pregunta una vez);
//   · no en /barber/mensajes: ahí la bandeja ya tiene la lista y le pasa el
//     número al menú con un evento;
//   · no en celular con el cajón cerrado: ahí el contador no se ve.
//
// Cuenta CHATS con algo sin leer, no mensajes sueltos: es lo que dice
// WhatsApp Business («3 chats sin leer») y lo que el mostrador atiende.
// ═══════════════════════════════════════════════════════════════════════

export const MENSAJES_SIN_LEER_EVENT = "barber:mensajes-sin-leer";
export const MENSAJES_SIN_LEER_URL = "/api/barber/whatsapp/unread";
export const MENSAJES_SIN_LEER_CADA_MS = 120_000;

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

export function useMensajesSinLeer({ mostrar, sondear }: { mostrar: boolean; sondear: boolean }): number {
  const [count, setCount] = useState(0);

  // Lo que avisa la bandeja llega siempre (es gratis: no hay red).
  useEffect(() => {
    if (!mostrar) return;
    function onAviso(e: Event) {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === "number" && Number.isFinite(n)) setCount(n);
    }
    window.addEventListener(MENSAJES_SIN_LEER_EVENT, onAviso);
    return () => window.removeEventListener(MENSAJES_SIN_LEER_EVENT, onAviso);
  }, [mostrar]);

  useEffect(() => {
    if (!mostrar || !sondear) return;
    let vivo = true;
    let reloj: number | null = null;

    async function leer() {
      try {
        const res = await fetch(MENSAJES_SIN_LEER_URL, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { chats?: unknown };
        if (vivo && typeof data.chats === "number") setCount(data.chats);
      } catch {
        // Un contador que no se pudo leer se queda como estaba: nunca rompe el menú.
      }
    }
    function arrancar() {
      if (reloj !== null) return;
      void leer();
      reloj = window.setInterval(() => void leer(), MENSAJES_SIN_LEER_CADA_MS);
    }
    function parar() {
      if (reloj !== null) window.clearInterval(reloj);
      reloj = null;
    }
    function onVisible() {
      if (document.visibilityState === "visible") arrancar();
      else parar();
    }

    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      vivo = false;
      parar();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mostrar, sondear]);

  return mostrar ? count : 0;
}
