"use client";

// Aviso ANTES de cobrar en efectivo con la caja cerrada (ws1-t6, H25).
// Hasta ahora solo quedaba una nota en el pago («Efectivo cobrado sin caja
// abierta») y quien cobraba se enteraba tarde. Aquí se le pregunta antes; el
// cobro NO se bloquea: puede abrir la caja o cobrar de todos modos.
//
// Tolerante: si la caja no se pudo leer (sin permiso de Caja, red, servidor
// lento) el estado es `null` = «no sé», y entonces NO se avisa nada. Un aviso
// falso es peor que ninguno.

import { useCallback, useEffect, useRef, useState } from "react";

export const RUTA_CAJA = "/dashboard/caja";

/** ¿Hay que frenar un momento antes de confirmar este cobro? */
export function debeAvisarCajaCerrada(method: string, cajaAbierta: boolean | null): boolean {
  return method === "cash" && cajaAbierta === false;
}

/** `true` = caja abierta · `false` = cerrada · `null` = no se pudo saber. */
export function cajaAbiertaDeRespuesta(status: number, cuerpo: unknown): boolean | null {
  if (status < 200 || status >= 300) return null;
  if (!cuerpo || typeof cuerpo !== "object" || !("register" in cuerpo)) return null;
  return (cuerpo as { register: unknown }).register ? true : false;
}

const TOPE_ESPERA_MS = 10000;

async function leerCaja(): Promise<boolean | null> {
  try {
    const r = await fetch("/api/caja/current", { cache: "no-store" });
    return cajaAbiertaDeRespuesta(r.status, await r.json().catch(() => null));
  } catch {
    return null;
  }
}

/**
 * `abierta`: `true` abierta · `false` cerrada · `null` no se sabe (aún no llegó
 * o no se pudo leer). `comprobar()` da la respuesta YA: si la lectura todavía
 * viaja, la espera (con tope) — con un servidor lento, el clic en «Registrar
 * pago» puede llegar antes que la respuesta, y entonces no se avisaba.
 */
export function useCajaAbierta(open: boolean): { abierta: boolean | null; comprobar: () => Promise<boolean | null> } {
  const [abierta, setAbierta] = useState<boolean | null>(null);
  const enVuelo = useRef<Promise<boolean | null> | null>(null);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setAbierta(null);
    const lectura = leerCaja();
    enVuelo.current = lectura;
    lectura.then((v) => { if (vivo) setAbierta(v); });
    return () => { vivo = false; };
  }, [open]);

  const comprobar = useCallback(async (): Promise<boolean | null> => {
    const espera = new Promise<null>((res) => setTimeout(() => res(null), TOPE_ESPERA_MS));
    return Promise.race([enVuelo.current ?? leerCaja(), espera]);
  }, []);

  return { abierta, comprobar };
}

/**
 * El freno de «caja cerrada» para CUALQUIER camino de cobro en efectivo (una
 * sola pieza, ws1-t6 H25): la ventana «Registrar pago», el cobro dentro del
 * detalle de la factura, «Marcar pagada» y el anticipo recibido usan ésta y el
 * componente `AvisoCajaCerrada`; nadie copia el texto ni la regla.
 *
 * `frenar()` se llama justo antes de enviar el cobro: `true` = hay que parar y
 * mostrar el aviso (el cobro NO se envía todavía); `false` = seguir. El aviso
 * no bloquea: «Cobrar de todos modos» vuelve a llamar al cobro saltándose el freno.
 */
export function useFrenoCajaCerrada(open: boolean, esEfectivo: boolean): {
  visible: boolean;
  frenar: () => Promise<boolean>;
  ocultar: () => void;
} {
  const { abierta, comprobar } = useCajaAbierta(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => { if (!open) setVisible(false); }, [open]);
  // Cambiar de método (o de efectivo a otro) retira el aviso.
  useEffect(() => { if (!esEfectivo) setVisible(false); }, [esEfectivo]);

  const frenar = useCallback(async (): Promise<boolean> => {
    if (!esEfectivo) return false;
    // Si la lectura de la caja aún no llegó, se espera (con tope) antes de decidir.
    const ab = abierta ?? (await comprobar());
    const parar = debeAvisarCajaCerrada("cash", ab);
    setVisible(parar);
    return parar;
  }, [esEfectivo, abierta, comprobar]);

  const ocultar = useCallback(() => setVisible(false), []);

  return { visible: visible && esEfectivo, frenar, ocultar };
}
