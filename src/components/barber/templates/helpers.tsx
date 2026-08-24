/* ═══════════════════════════════════════════════════════════════════════
   LO QUE LAS OCHO PLANTILLAS HACEN IGUAL.

   Resolver un texto, saber qué secciones se pintan y en qué orden, y
   traducir el acento elegido a variables CSS. Nada visual: lo visual es
   justo lo que tiene que ser distinto en cada plantilla.

   ── EL DEFAULT SE LEE DEL MANIFIESTO, NO SE ESCRIBE EN EL JSX ─────
   `copia(data, "servicios", "servicios.cta")` va al manifiesto de ESTA
   plantilla, encuentra el `porDefecto` de esa clave y devuelve lo que
   escribió la barbería o ese literal.

   Esto no es comodidad: es lo que hace IMPOSIBLE que el editor mienta.
   El placeholder gris que ve la barbería ("esto sale si lo dejas
   vacío") sale del manifiesto; si el JSX escribiera su propio literal,
   los dos se separarían al primer cambio y nadie se enteraría hasta que
   una barbería borrara el campo y viera aparecer un texto que no
   esperaba.
   ═══════════════════════════════════════════════════════════════════════ */

import type { CSSProperties, ReactNode } from "react";
import {
  acentoBarberWeb,
  copiaBarberWeb,
  seccionesVisibles,
  subtituloSeccion,
  tituloSeccion,
  tieneHorario,
  type BarberWebFuente,
  type BarberWebManifestSeccion,
} from "@/lib/barber/landing";
import type { BarberWebData } from "./types";

/* ══════════════════════════════════════════════════════════════
   Texto
   ══════════════════════════════════════════════════════════════ */

function seccionDelManifiesto(data: BarberWebData, seccionId: string) {
  return data.manifest.secciones.find((s) => s.id === seccionId);
}

/** El texto suelto de una clave: lo escrito, o el literal real de esta plantilla. */
export function copia(data: BarberWebData, seccionId: string, clave: string): string {
  const decl = seccionDelManifiesto(data, seccionId)?.copia?.find((c) => c.clave === clave);
  return copiaBarberWeb(data.config, clave) ?? decl?.porDefecto ?? "";
}

/** El título de una sección: el escrito, o el de esta plantilla. */
export function titulo(data: BarberWebData, seccionId: string): string {
  const decl = seccionDelManifiesto(data, seccionId)?.textos?.find((t) => t.campo === "titulo");
  return tituloSeccion(data.config, seccionId, decl?.porDefecto ?? "");
}

/** La bajada de una sección, o null si ni la barbería ni la plantilla ponen una. */
export function subtitulo(data: BarberWebData, seccionId: string): string | null {
  const decl = seccionDelManifiesto(data, seccionId)?.textos?.find((t) => t.campo === "subtitulo");
  return subtituloSeccion(data.config, seccionId, decl?.porDefecto ?? undefined);
}

/** La foto de una ranura, o null. */
export function foto(data: BarberWebData, slot: string): string | null {
  const u = data.config.fotos[slot];
  return typeof u === "string" && u.trim() ? u : null;
}

/**
 * El logo que se pinta: el que subió al editor, o el de la barbería.
 *
 * Dos fuentes a propósito. `Barbershop.logoUrl` es el logo del NEGOCIO y lo
 * administra la pantalla de configuración, que no es de esta terminal; la
 * ranura `logo` deja que la web use otro (con fondo transparente, recortado
 * distinto) sin escribir en la fila de la barbería.
 */
export function logo(data: BarberWebData): string | null {
  return foto(data, "logo") ?? data.shop.logoUrl;
}

/** El nombre humano de una ranura, para el hueco que se ve en el editor. */
export function nombreRanura(data: BarberWebData, seccionId: string, slot: string): string {
  const decl = seccionDelManifiesto(data, seccionId)?.fotos?.find((f) => f.id === slot);
  return decl?.nombre ?? slot;
}

/* ══════════════════════════════════════════════════════════════
   Secciones
   ══════════════════════════════════════════════════════════════ */

/**
 * ¿Hay datos de esta fuente?
 *
 * En el EDITOR devuelve siempre true: la barbería que aún no ha subido
 * fotos ni dado de alta barberos necesita ver dónde van a caer. En público
 * una sección sin datos no se pinta — un título con un hueco debajo es
 * exactamente lo que hace que un sitio parezca abandonado.
 */
export function hayDatosDe(data: BarberWebData): (f: BarberWebFuente) => boolean {
  if (data.editando) return () => true;
  return (f: BarberWebFuente) => {
    switch (f) {
      case "servicios":
        return data.servicios.length > 0;
      case "barberos":
        return data.barberos.length > 0;
      case "galeria":
        return data.config.galeria.length > 0;
      case "resenas":
        return data.config.resenas.length > 0;
      case "horario":
        return tieneHorario(data.config);
      case "contacto":
        return true;
      default:
        return false;
    }
  };
}

/** Las secciones que se pintan, en el orden real. */
export function secciones(data: BarberWebData): BarberWebManifestSeccion[] {
  return seccionesVisibles(data.manifest, data.config, hayDatosDe(data));
}

/** ¿Esta plantilla pinta esta sección ahora mismo? Para el menú de anclas. */
export function tieneSeccion(lista: BarberWebManifestSeccion[], id: string): boolean {
  return lista.some((s) => s.id === id);
}

/* ══════════════════════════════════════════════════════════════
   Acento → variables CSS

   Las pieles de skins.css NUNCA escriben un color de acento: leen estas
   cuatro variables. Así cambiar el acento en el editor repinta las ocho
   plantillas sin tocar una línea de CSS.
   ══════════════════════════════════════════════════════════════ */

export function varsDeAcento(data: BarberWebData): CSSProperties {
  const a = acentoBarberWeb(data.config.acento);
  return {
    ["--dcbw-acento" as any]: a.base,
    ["--dcbw-acento-fuerte" as any]: a.fuerte,
    ["--dcbw-acento-suave" as any]: a.suave,
    ["--dcbw-acento-claro" as any]: a.claro,
  };
}

/* ══════════════════════════════════════════════════════════════
   Envoltorio de sección
   ══════════════════════════════════════════════════════════════ */

export function Sec({
  id,
  className,
  style,
  children,
}: {
  id: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`dcbw-sec dcbw-sec-${id} ${className ?? ""}`} style={style}>
      {children}
    </section>
  );
}

/** Título + bajada de una sección, con el kicker opcional de la plantilla. */
export function Encabezado({
  kicker,
  titulo: t,
  subtitulo: s,
  className,
}: {
  kicker?: string | null;
  titulo: string;
  subtitulo?: string | null;
  className?: string;
}) {
  if (!t && !s && !kicker) return null;
  return (
    <header className={`dcbw-encabezado ${className ?? ""}`}>
      {kicker ? <p className="dcbw-kicker">{kicker}</p> : null}
      {t ? <h2 className="dcbw-h2">{t}</h2> : null}
      {s ? <p className="dcbw-bajada">{s}</p> : null}
    </header>
  );
}
