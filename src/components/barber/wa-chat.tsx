"use client";

// Botón «WhatsApp» de UN cliente en el panel (ws6-t8). La regla vive en
// @/lib/barber/wa-chat-core (pura y probada); aquí solo se pinta:
//   · Mensajes  → <Link> en la misma pestaña.
//   · wa.me     → <a target="_blank"> como siempre.
// Sin proveedor (arneses, pantallas fuera del panel) todo es wa.me.

import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  barberWaChatDestino,
  BARBER_WA_CHAT_SIN_ACCESO,
  type BarberWaChatAcceso,
} from "@/lib/barber/wa-chat-core";

const AccesoCtx = createContext<BarberWaChatAcceso>(BARBER_WA_CHAT_SIN_ACCESO);

export function BarberWaChatProvider({ value, children }: { value: BarberWaChatAcceso; children: ReactNode }) {
  return <AccesoCtx.Provider value={value}>{children}</AccesoCtx.Provider>;
}

export function useBarberWaChatAcceso(): BarberWaChatAcceso {
  return useContext(AccesoCtx);
}

// ── ¿Ventana de 24 h abierta? Una sola lectura de la bandeja por página ──
// (los hilos ya traen windowOpen), compartida por todos los botones con texto.
const VIGENCIA_MS = 60_000;
let ventanas: { at: number; p: Promise<Map<string, boolean>> } | null = null;

async function leerHilos(archivados: boolean): Promise<Array<{ phone: string; windowOpen: boolean }>> {
  const res = await fetch(`/api/barber/whatsapp/threads?archived=${archivados ? 1 : 0}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { threads?: Array<{ phone: string; windowOpen: boolean }> } | null;
  return Array.isArray(data?.threads) ? data.threads : [];
}

function ventanasAbiertas(): Promise<Map<string, boolean>> {
  if (ventanas && Date.now() - ventanas.at < VIGENCIA_MS) return ventanas.p;
  const p = Promise.all([leerHilos(false), leerHilos(true)])
    .then(([a, b]) => {
      const m = new Map<string, boolean>();
      for (const th of [...a, ...b]) {
        const tel = mxTenDigits(th.phone);
        if (tel) m.set(tel, m.get(tel) === true || th.windowOpen === true);
      }
      return m;
    })
    .catch(() => new Map<string, boolean>());
  ventanas = { at: Date.now(), p };
  return p;
}

/** null mientras no se sabe; false si no hay hilo o ya pasó la ventana. */
function useVentanaAbierta(phone: string | null | undefined, activo: boolean): boolean | null {
  const tel = mxTenDigits(phone);
  const [abierta, setAbierta] = useState<boolean | null>(null);
  useEffect(() => {
    if (!activo || !tel) return;
    let vivo = true;
    void ventanasAbiertas().then((m) => {
      if (vivo) setAbierta(m.get(tel) === true);
    });
    return () => {
      vivo = false;
    };
  }, [activo, tel]);
  return abierta;
}

/**
 * Enlace al chat de un cliente. Con `texto` (ticket, pedido) solo entra a
 * Mensajes si ese texto se puede mandar ya (ventana abierta + permiso de
 * contestar); mientras se averigua, y si no, es wa.me con el texto.
 */
export function ChatClienteLink({
  phone,
  texto,
  className,
  style,
  title,
  children,
  ...rest
}: {
  phone: string | null | undefined;
  texto?: string | null;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
  "aria-label"?: string;
  "data-accion"?: string;
}) {
  const acceso = useBarberWaChatAcceso();
  const ventanaAbierta = useVentanaAbierta(phone, Boolean(texto) && acceso.send);
  const d = barberWaChatDestino({ acceso, phone, texto, ventanaAbierta });
  const destino = d.interno ? "mensajes" : "wa.me";
  if (d.interno) {
    return (
      <Link href={d.href} className={className} style={style} title={title} data-wa-destino={destino} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={d.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      title={title}
      data-wa-destino={destino}
      {...rest}
    >
      {children}
    </a>
  );
}
