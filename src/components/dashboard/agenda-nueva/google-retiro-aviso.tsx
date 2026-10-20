"use client";

/**
 * WS1-T9 · tercera vuelta t8, N3-G2: el aviso de que los eventos de Google ya
 * NO cierran la agenda. Tras un día sin sincronizar bien (o al desconectar
 * Google) el cron retira sus bloqueos y el bot ofrece esas horas: antes nadie
 * se enteraba. Dice desde cuándo, por qué y qué hacer.
 *
 * Lo enseñan la agenda (`SincronizarGoogleAlAbrir`, en google-calendario.tsx) y
 * Configuración → Integraciones (`AvisoRetiroGoogle`). El dato es `retiro` de
 * `/api/google/agenda/sincronizar`, con la MISMA regla que usa el cron para
 * retirar (`retiroDeBloqueos` en src/lib/google/entrante-core.ts).
 *
 * Aquí vive también el aviso de la conexión de la agenda (`avisoDeConexion`):
 * sin React ni la agenda, para probarlos con los diccionarios reales
 * (src/lib/google/__tests__/tercera-vuelta.test.ts).
 */

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import type { TVars } from "@/i18n/t";
import type { CausaRetiro } from "@/lib/google/entrante-core";

export interface RetiroPantalla {
  /** Cuándo se retiraron (la fecha real del retiro). */
  desde: string;
  causa: CausaRetiro;
  /** La zona de la clínica: la hora se pinta en ella, no en la del navegador. */
  zona?: string;
}

const CAUSAS: readonly CausaRetiro[] = ["desconectada", "conexion", "permisos", "calendario", "parcial", "google", "reponiendo"];

export function leerRetiro(raw: unknown): RetiroPantalla | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const causa = CAUSAS.find((c) => c === r.causa);
  if (!causa || typeof r.desde !== "string" || Number.isNaN(Date.parse(r.desde))) return null;
  return { desde: r.desde, causa, ...(typeof r.zona === "string" && r.zona ? { zona: r.zona } : {}) };
}

/** El texto entero: qué pasó (desde cuándo), por qué y qué hacer. */
export function textoRetiro(
  r: RetiroPantalla,
  t: (clave: string, vars?: TVars) => string,
  locale: string,
  zona?: string,
): string {
  let fecha: string;
  try {
    fecha = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: zona ?? r.zona })
      .format(new Date(r.desde));
  } catch {
    // Una zona que el navegador no conoce: la suya.
    fecha = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(r.desde));
  }
  return `${t("agenda.google.retiroDesde", { fecha })} ${t(`agenda.google.retiro_${r.causa}`)}`;
}

/**
 * El aviso de la agenda. Si los eventos de Google ya no la cierran (sus
 * bloqueos se retiraron), eso va primero, con desde cuándo, por qué y qué
 * hacer (tercera vuelta, N3-G2); si no, el de la conexión.
 */
export function textoAvisoAgenda(
  estado: { encendida: boolean; error: string | null; retiro?: RetiroPantalla | null } | null,
  t: (clave: string, vars?: Record<string, string | number>) => string,
  locale: string,
  zona?: string,
): string | null {
  if (!estado?.encendida) return null;
  // Desconectar Google a propósito no es una alerta para todo el equipo en
  // la agenda (no se puede descartar); lo dice Configuración, junto a «Conectar».
  if (estado.retiro && estado.retiro.causa !== "desconectada") return textoRetiro(estado.retiro, t, locale, zona);
  const clave = avisoDeConexion(estado.error);
  return clave ? t(clave) : null;
}

/**
 * Qué aviso enseña la agenda según el error (revisión t8, G3). Con «permisos»
 * solo falla LEER (las citas sí se copian a Google); con la conexión caída o
 * rechazada no va nada en ningún sentido, y no se puede decir lo contrario.
 */
export function avisoDeConexion(error: string | null): string | null {
  if (error === "permisos") return "agenda.google.reconectar";
  if (error === "autorizacion" || error === "conexion_caida") return "agenda.google.reconectarCaida";
  if (error === "calendario_personal" || error === "calendario_compartido") return "agenda.google.calendarioNoValido";
  return null;
}

export function AvisoRetiroVista({ texto }: { texto: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle size={16} aria-hidden className="mt-0.5 flex-none" />
      <span>{texto}</span>
    </div>
  );
}

/**
 * Lo que pide Configuración: como la agenda al abrirse, sincroniza primero
 * (con el freno de 60 s de la ruta) y luego dice el estado. Así, recién
 * reconectado Google, no enseña el aviso viejo hasta que pase el cron.
 * Sin permiso, sin red o sin retiro: null.
 */
export async function cargarRetiro(f: typeof fetch = fetch): Promise<RetiroPantalla | null> {
  try {
    const res = await f("/api/google/agenda/sincronizar", { method: "POST", credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const b = (await res.json()) as { encendida?: unknown; retiro?: unknown } | null;
    return b?.encendida === true ? leerRetiro(b.retiro) : null;
  } catch {
    return null;
  }
}

/** Para Configuración → Integraciones. Sin la bandera, sin permiso o sin retiro, no pinta nada. */
export function AvisoRetiroGoogle() {
  const t = useT();
  const locale = useLocale();
  const [retiro, setRetiro] = useState<RetiroPantalla | null>(null);

  useEffect(() => {
    let vivo = true;
    void cargarRetiro().then((r) => { if (vivo) setRetiro(r); });
    return () => { vivo = false; };
  }, []);

  if (!retiro) return null;
  return <AvisoRetiroVista texto={textoRetiro(retiro, t, locale)} />;
}
