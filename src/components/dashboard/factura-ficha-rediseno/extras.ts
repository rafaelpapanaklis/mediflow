"use client";

// Las dos conversaciones con el servidor que tienen la ficha y el popup:
//  · leer, en UN lote, las condiciones de pago y el contacto de los pacientes
//    (GET /api/invoices/condiciones);
//  · mandar una factura al paciente, por correo o por WhatsApp.
//
// La pieza de WhatsApp YA EXISTÍA (POST /api/invoices/[id]/send-whatsapp, la que
// usa el detalle de factura): aquí solo se llama. La de correo es su hermana.

import { useEffect, useMemo, useState } from "react";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import type { ContactoPaciente, ViaEnvio } from "./datos";

export interface ExtrasDeFacturas {
  condiciones: Record<string, CondicionesPago>;
  contacto: Record<string, ContactoPaciente>;
  /** Todavía no contesta el servidor: los botones de envío esperan. */
  cargando: boolean;
  /** No se pudo leer: la ficha lo dice en vez de pintar «sin plan» como si lo supiera. */
  fallo: boolean;
}

/** Lo que atiende GET /api/invoices/condiciones por petición (su MAX_IDS). */
const LOTE = 100;
const ESPERA_MS = 250;

const VACIO: ExtrasDeFacturas = { condiciones: {}, contacto: {}, cargando: false, fallo: false };

export function useExtrasDeFacturas(ids: string[]): ExtrasDeFacturas {
  // La lista llega como arreglo nuevo en cada render: se compara por contenido.
  const clave = useMemo(() => Array.from(new Set(ids)).sort().join(","), [ids]);
  // Nace «cargando» si hay algo que pedir: si no, el primer pintado enseñaría
  // los botones de envío habilitados un instante antes de saber si se puede.
  const [extras, setExtras] = useState<ExtrasDeFacturas>(() => ({ ...VACIO, cargando: clave.length > 0 }));

  useEffect(() => {
    if (!clave) { setExtras(VACIO); return; }
    const ctrl = new AbortController();
    setExtras((prev) => ({ ...prev, cargando: true }));
    const ids = clave.split(",");

    // En tandas de LOTE y una detrás de otra: la ruta atiende 100 ids por
    // petición y el pooler no aguanta ráfagas. Un paciente con 250 facturas son
    // tres peticiones seguidas, no fichas sin frase al azar.
    async function leer() {
      const condiciones: Record<string, CondicionesPago> = {};
      const contacto: Record<string, ContactoPaciente> = {};
      let fallo = false;
      for (let i = 0; i < ids.length; i += LOTE) {
        const res = await fetch(`/api/invoices/condiciones?ids=${encodeURIComponent(ids.slice(i, i + LOTE).join(","))}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        Object.assign(condiciones, data?.condiciones ?? {});
        Object.assign(contacto, data?.contacto ?? {});
        if (data?.fallo === true) fallo = true;
      }
      setExtras({ condiciones, contacto, cargando: false, fallo });
    }

    // Con espera: el buscador de Caja cambia la lista en cada tecla, y abortar
    // corta al cliente pero no al servidor, que ya hizo sus consultas.
    const reloj = setTimeout(() => {
      leer().catch((err) => {
        if (err?.name === "AbortError") return;
        setExtras({ condiciones: {}, contacto: {}, cargando: false, fallo: true });
      });
    }, ESPERA_MS);
    return () => { clearTimeout(reloj); ctrl.abort(); };
  }, [clave]);

  return extras;
}

/** ¿Tiene correo y teléfono el paciente elegido en el popup? `null` = aún no se sabe. */
export function useContactoDePaciente(patientId: string, activo: boolean): ContactoPaciente | null {
  const [contacto, setContacto] = useState<ContactoPaciente | null>(null);
  useEffect(() => {
    setContacto(null);
    if (!activo || !patientId) return;
    const ctrl = new AbortController();
    fetch(`/api/invoices/condiciones?patientId=${encodeURIComponent(patientId)}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.contacto) setContacto(data.contacto); })
      .catch(() => { /* sin dato: no se deshabilita nada y la ruta de envío responde con su motivo */ });
    return () => ctrl.abort();
  }, [patientId, activo]);
  return contacto;
}

const RUTA: Record<ViaEnvio, string> = { correo: "send-email", whatsapp: "send-whatsapp" };

/** `error` es el motivo que dio el servidor (o null si ni siquiera contestó).
 *  Un solo tipo, sin unión: el repo no compila en `strict` y no estrecha por `ok`. */
export interface Resultado { ok: boolean; error: string | null }

/** Manda la factura al paciente. Nunca lanza: devuelve el motivo del servidor. */
export async function enviarFactura(invoiceId: string, via: ViaEnvio): Promise<Resultado> {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/${RUTA[via]}`, { method: "POST" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof out?.error === "string" ? out.error : null };
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: null };
  }
}

/** Guarda el trato de una factura recién creada. Nunca lanza. */
export async function guardarCondiciones(invoiceId: string, condiciones: CondicionesPago): Promise<Resultado & { condiciones: CondicionesPago | null }> {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/condiciones`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ condiciones }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof out?.error === "string" ? out.error : null, condiciones: null };
    return { ok: true, error: null, condiciones: out?.condiciones ?? null };
  } catch {
    return { ok: false, error: null, condiciones: null };
  }
}
