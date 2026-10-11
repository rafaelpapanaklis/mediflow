"use client";

import type { CSSProperties, ReactNode } from "react";
import { registrarPaso, type OrigenBoton } from "@/lib/analytics/embudo";
import { enlaceWhatsapp } from "./landing-data";
import { WhatsappGlyph } from "./whatsapp-glyph";

/**
 * Los dos botones medidos de la portada (11-oct-2026, ws1-t4, puntos 1 y 3 del
 * encargo de ws7). Cada clic llama a `registrarPaso` (embudo.ts, ws1-t9), que
 * reparte a GA4, a la analítica propia y a los destinos extra (Meta Lead y
 * «Clic en WhatsApp» de Google Ads, ws1-t5). Aquí NO se llama a gtag ni a fbq:
 * un solo punto de salida por clic, para que cada evento salga UNA vez.
 *
 * Son "use client" solo por el onClick. El hero (servidor, LCP) los recibe ya
 * renderizados; el marcado sigue viajando en el HTML inicial.
 *
 * Nunca bloquean la navegación: el ancla sigue su curso y, si gtag/fbq no
 * cargaron, el clic funciona igual.
 */

/** «Empezar»: ancla a #precios (o a /signup) + `clic_empezar` con su origen. */
export function EnlaceEmpezar({
  origen,
  plan,
  href,
  className,
  style,
  children,
}: {
  origen: OrigenBoton;
  plan?: string;
  href: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <a href={href} className={className} style={style} onClick={() => registrarPaso("clic_empezar", { origen, plan })}>
      {children}
    </a>
  );
}

/** Botón/enlace de WhatsApp: mensaje precargado del origen + `whatsapp_clic`. */
export function BotonWhatsapp({
  origen,
  plan,
  planNombre,
  className,
  style,
  glyphSize = 18,
  children,
}: {
  origen: OrigenBoton;
  /** Id del plan (BASIC | PRO | CLINIC) para el evento, igual que en clic_empezar. */
  plan?: string;
  /** Nombre legible del plan («Profesional») para el mensaje precargado. */
  planNombre?: string;
  className?: string;
  style?: CSSProperties;
  glyphSize?: number;
  children: ReactNode;
}) {
  return (
    <a
      href={enlaceWhatsapp(origen, planNombre)}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={style}
      onClick={() => registrarPaso("whatsapp_clic", { origen, plan })}
    >
      <WhatsappGlyph size={glyphSize} />
      {children}
    </a>
  );
}
