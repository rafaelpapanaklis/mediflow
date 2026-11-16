"use client";

// ═══════════════════════════════════════════════════════════════════════
// RegistradorUso — registra el uso del panel /barber (ws6-t4, 16-nov-2026):
// entradas, pantallas vistas y toques en botones/enlaces/pestañas.
//
// Ligero a propósito: un solo listener de click en fase de captura (pasivo,
// no frena nada), un lote cada 30 s con fetch keepalive y uno al salir con
// sendBeacon. No pinta nada.
//
// PRIVACIDAD: nunca lee el valor de un campo. De un toque solo toma la ruta,
// la clave data-accion, el texto del botón con los dígitos cambiados por 0
// (el servidor lo guarda SOLO si es un texto del panel) y a qué pantalla
// lleva un enlace (o «externo»: un wa.me o un tel: llevan teléfonos).
// Con la cookie de «Ver como barbería» no hace nada.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  USO_ENDPOINT,
  USO_FLUSH_MS,
  destinoDeEnlace,
  hayVerComo,
  limpiarAccion,
  limpiarEtiqueta,
  normalizarPantalla,
  type UsoLoteCliente,
} from "@/lib/barber/uso/uso-core";
import { crearRegistrador, type Registrador } from "@/lib/barber/uso/registrador-core";

/** Lo que cuenta como «tocó algo». Un input, un select o un campo NO. */
const ACCIONABLE =
  "[data-accion],button,a[href],[role=button],[role=tab],[role=menuitem],[role=radio],[role=switch],[role=checkbox],summary";
const CAMPO = "input,textarea,select,[contenteditable=''],[contenteditable=true]";

function sesionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function nuevoId(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* sigue */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function enviar(lote: UsoLoteCliente, alSalir: boolean): Promise<{ off?: boolean } | null> {
  const body = JSON.stringify(lote);
  if (alSalir && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon(USO_ENDPOINT, new Blob([body], { type: "application/json" }))) return null;
    } catch {
      /* cae a fetch */
    }
  }
  const r = await fetch(USO_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  });
  if (!r.ok) return null;
  return (await r.json().catch(() => null)) as { off?: boolean } | null;
}

/** Lee del elemento tocado SOLO lo permitido (nunca el valor de un campo). */
function describir(el: Element): { a?: string; l?: string; h?: string } {
  const out: { a?: string; l?: string; h?: string } = {};
  const conAccion = el.closest("[data-accion]");
  const accion = limpiarAccion(conAccion?.getAttribute("data-accion"));
  if (accion) out.a = accion;
  const he = el as HTMLElement;
  const texto = he.getAttribute("aria-label") || he.getAttribute("title") || he.innerText || "";
  const etiqueta = limpiarEtiqueta(texto);
  if (etiqueta) out.l = etiqueta;
  if (el.tagName === "A") {
    const destino = destinoDeEnlace(el.getAttribute("href"), window.location.origin);
    if (destino) out.h = destino;
  }
  return out;
}

export function RegistradorUso() {
  const pathname = usePathname();
  const reg = useRef<Registrador | null>(null);

  // Montaje: el registrador, el listener de clics y los envíos.
  useEffect(() => {
    if (typeof window === "undefined" || hayVerComo(document.cookie)) return;
    const r = crearRegistrador({ ahora: () => Date.now(), almacen: sesionStorage(), nuevoId, enviar });
    reg.current = r;
    const p0 = normalizarPantalla(window.location.pathname);
    if (p0) r.pantalla(window.location.pathname);

    const onClick = (ev: MouseEvent) => {
      try {
        const t = ev.target as Element | null;
        if (!t || !t.closest) return;
        if (t.closest(CAMPO)) return;
        const el = t.closest(ACCIONABLE);
        if (!el) return;
        r.clic({ p: window.location.pathname, ...describir(el) });
      } catch {
        /* nunca estorba */
      }
    };
    const salir = () => void r.vaciar(true);
    const onVis = () => {
      if (document.visibilityState === "hidden") salir();
    };
    document.addEventListener("click", onClick, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", salir);
    const tic = window.setInterval(() => void r.vaciar(false), USO_FLUSH_MS);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", salir);
      window.clearInterval(tic);
      void r.vaciar(true);
      reg.current = null;
    };
  }, []);

  // Cambio de pantalla (navegación del App Router).
  useEffect(() => {
    if (pathname) reg.current?.pantalla(pathname);
  }, [pathname]);

  return null;
}
