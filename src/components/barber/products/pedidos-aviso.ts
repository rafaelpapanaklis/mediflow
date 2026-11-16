"use client";

import { useEffect, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════
// El numerito de «Productos» del menú: pedidos de la tienda POR ATENDER.
//
// (16-nov-2026: «el apartado y pagar en tienda de un producto, ¿dónde le
// llega al dueño?». Solo caía en Productos → Pedidos y nadie avisaba.)
//
// Pide SOLO el número: GET /api/barber/product-orders/pending → { count }.
// La regla de qué cuenta es una y vive en el servidor (tienda-core.ts,
// orderNeedsAction): nuevos sin atender + pagados en línea sin entregar, de
// la sede en sesión. El menú solo lo pide si «Productos» está en el menú
// (plan con productos + products.view); sin la tabla de pedidos llega 0.
//
// Cuándo pregunta (lo decide quien llama con `sondear`):
//   · al montar y en CADA navegación interna (cambia `ruta`);
//   · cada minuto, y NUNCA con la pestaña escondida (el reloj se apaga y al
//     volver se pregunta una vez);
//   · no en celular con el cajón cerrado: ahí el contador no se ve (al
//     abrirlo se pregunta en ese momento).
// Y la pestaña Pedidos le pasa su número con un evento cada vez que recarga
// su lista: el contador baja en cuanto se atiende, sin esperar al sondeo.
// ═══════════════════════════════════════════════════════════════════════

export const PEDIDOS_POR_ATENDER_EVENT = "barber:pedidos-por-atender";
export const PEDIDOS_POR_ATENDER_URL = "/api/barber/product-orders/pending";
export const PEDIDOS_POR_ATENDER_CADA_MS = 60_000;

/** Lo que el menú escribe en la pastilla: «99+» de 100 en adelante. */
export function textoContador(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Un número de pedidos que se puede pintar (entero ≥ 0); otra cosa, null. */
export function leerContador(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null;
}

/** La pestaña Pedidos avisa al menú cada vez que recarga su lista. */
export function avisarPedidosPorAtender(count: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(PEDIDOS_POR_ATENDER_EVENT, { detail: count }));
}

export function usePedidosPorAtender({
  mostrar,
  sondear,
  ruta,
}: {
  /** «Productos» está en el menú de esta sesión. */
  mostrar: boolean;
  /** El contador se ve ahora (escritorio, o celular con el cajón abierto). */
  sondear: boolean;
  /** La ruta actual: al cambiar, se vuelve a preguntar. */
  ruta: string | null;
}): number {
  const [count, setCount] = useState(0);

  // Lo que avisa la pestaña Pedidos llega siempre (es gratis: no hay red).
  useEffect(() => {
    if (!mostrar) return;
    function onAviso(e: Event) {
      const n = leerContador((e as CustomEvent<number>).detail);
      if (n !== null) setCount(n);
    }
    window.addEventListener(PEDIDOS_POR_ATENDER_EVENT, onAviso);
    return () => window.removeEventListener(PEDIDOS_POR_ATENDER_EVENT, onAviso);
  }, [mostrar]);

  useEffect(() => {
    if (!mostrar || !sondear) return;
    let vivo = true;
    let reloj: number | null = null;

    async function leer() {
      try {
        const res = await fetch(PEDIDOS_POR_ATENDER_URL, { cache: "no-store" });
        if (!res.ok) return;
        const n = leerContador(((await res.json()) as { count?: unknown }).count);
        if (vivo && n !== null) setCount(n);
      } catch {
        // Un contador que no se pudo leer se queda como estaba: nunca rompe el menú.
      }
    }
    function arrancar() {
      if (reloj !== null) return;
      void leer();
      reloj = window.setInterval(() => void leer(), PEDIDOS_POR_ATENDER_CADA_MS);
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
    // `ruta` va en las dependencias a propósito: navegar reinicia el reloj y pregunta ya.
  }, [mostrar, sondear, ruta]);

  return mostrar ? count : 0;
}
