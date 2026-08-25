/* ═══════════════════════════════════════════════════════════════════════
   HELPERS DE LOS BLOQUES DE LA WEB PÚBLICA DE INMUEBLES.

   Los bloques NUNCA escriben su propio literal por defecto: se lo piden al
   manifiesto de la plantilla ACTIVA. El placeholder gris que ve la
   inmobiliaria en el editor ("esto sale si lo dejas vacío") sale del mismo
   sitio; si el JSX escribiera el suyo, los dos se separarían al primer
   cambio y el editor empezaría a mentir.

   Sin "use client": esto corre en el servidor (la página pública) y en el
   navegador (la vista previa del editor).
   ═══════════════════════════════════════════════════════════════════════ */

import type { CSSProperties, ReactNode } from "react";
import {
  acentoRealtyWeb,
  copiaRealtyWeb,
  fotoRealtyWeb,
  subtituloBloque,
  tituloBloque,
  type RealtyWebData,
  type RealtyWebManifestBloque,
} from "@/lib/realty/landing";

/** El bloque del manifiesto de la plantilla activa, por id. */
function bloqueDelManifiesto(
  data: RealtyWebData,
  id: string,
): RealtyWebManifestBloque | undefined {
  return data.manifest.bloques.find((b) => b.id === id);
}

/** El texto suelto de una clave: lo escrito, o el literal real de ESTA plantilla. */
export function copia(data: RealtyWebData, bloqueId: string, clave: string): string {
  const decl = bloqueDelManifiesto(data, bloqueId)?.copia?.find((c) => c.clave === clave);
  return copiaRealtyWeb(data.config, clave) ?? decl?.porDefecto ?? "";
}

/** El título de un bloque: el escrito, o el de esta plantilla. */
export function titulo(data: RealtyWebData, bloqueId: string): string {
  const decl = bloqueDelManifiesto(data, bloqueId)?.textos?.find((t) => t.campo === "titulo");
  return tituloBloque(data.config, bloqueId, decl?.porDefecto ?? "");
}

/** La bajada de un bloque, o null si ni la cuenta ni la plantilla ponen una. */
export function subtitulo(data: RealtyWebData, bloqueId: string): string | null {
  const decl = bloqueDelManifiesto(data, bloqueId)?.textos?.find((t) => t.campo === "subtitulo");
  return subtituloBloque(data.config, bloqueId, decl?.porDefecto || undefined);
}

/** La variante de maquetado que ESTA plantilla le pide al bloque. */
export function variante(data: RealtyWebData, bloqueId: string): string {
  return bloqueDelManifiesto(data, bloqueId)?.variante ?? "";
}

/** La foto de una ranura. */
export function foto(data: RealtyWebData, slot: string): string | null {
  return fotoRealtyWeb(data.config, slot);
}

/** El logo: el de la web si lo subieron, y si no el de la cuenta. */
export function logo(data: RealtyWebData): string | null {
  return foto(data, "logo") ?? data.cuenta.logo;
}

/** El WhatsApp de la web; si está vacío, el teléfono de la cuenta. */
export function whatsappDe(data: RealtyWebData): string {
  return data.config.whatsapp || (data.cuenta.telefono ?? "");
}

/**
 * Acento → variables CSS.
 *
 * Las pieles de skin.css NUNCA escriben un color de acento: leen estas
 * cuatro variables. Así cambiar el acento en el editor repinta las nueve
 * plantillas sin tocar una línea de CSS.
 */
export function varsDeAcento(data: RealtyWebData): CSSProperties {
  const a = acentoRealtyWeb(data.config.acento);
  return {
    ["--dcrw-acento" as string]: a.base,
    ["--dcrw-acento-fuerte" as string]: a.fuerte,
    ["--dcrw-acento-suave" as string]: a.suave,
    ["--dcrw-acento-claro" as string]: a.claro,
  } as CSSProperties;
}

/* ── Piezas de estructura ─────────────────────────────────────────── */

/** Una sección de la página. El id sirve de ancla del menú. */
export function Sec({
  id,
  variante: v,
  className,
  children,
}: {
  id: string;
  variante?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-variante={v || undefined}
      className={`dcrw-sec dcrw-sec-${id} ${className ?? ""}`.trim()}
    >
      <div className="dcrw-ancho">{children}</div>
    </section>
  );
}

/**
 * Encabezado de bloque. Devuelve null si los tres van vacíos: un hueco con
 * aire de más se ve peor que no tener encabezado.
 */
export function Encabezado({
  kicker,
  titulo: t,
  subtitulo: s,
  centrado,
}: {
  kicker?: string | null;
  titulo?: string | null;
  subtitulo?: string | null;
  centrado?: boolean;
}) {
  if (!kicker && !t && !s) return null;
  return (
    <header className={`dcrw-encabezado ${centrado ? "dcrw-encabezado-centro" : ""}`.trim()}>
      {kicker ? <p className="dcrw-kicker">{kicker}</p> : null}
      {t ? <h2 className="dcrw-titulo">{t}</h2> : null}
      {s ? <p className="dcrw-bajada">{s}</p> : null}
    </header>
  );
}
