import { acentoBarberWeb, plantillaOfrecidaBarberWeb } from "@/lib/barber/landing";
import { cardPath } from "@/lib/barber/stars-core";

/* ═══════════════════════════════════════════════════════════════════════
   «AGREGAR A PANTALLA DE INICIO» — la tarjeta de estrellas como ícono en el
   teléfono del cliente (ws6-t2, punto 5). Núcleo PURO.

   La página de la tarjeta (/b/<slug>/tarjeta/<token>) declara un manifest
   PROPIO: nombre «Estrellas · <barbería>», ícono con el logo de la barbería
   (o su inicial), `start_url` = el enlace personal del cliente y pantalla
   completa. Sin service worker: Chrome ya no lo exige para instalar y aquí
   no hay nada que guardar sin conexión (la tarjeta se lee en vivo).

   🔒 El manifest lleva el token en `start_url`: por eso vive DEBAJO de la
   ruta del token y solo repite lo que ya trae la URL con la que se pidió.
   No consulta al cliente ni dice si el token sirve.
   ═══════════════════════════════════════════════════════════════════════ */

/** Tamaños de ícono que se sirven (192 y 512 para Android, 180 para iPhone). */
export const TARJETA_ICON_SIZES = [180, 192, 512] as const;
export type TarjetaIconSize = (typeof TARJETA_ICON_SIZES)[number];

export function esTamanoDeIcono(v: unknown): v is TarjetaIconSize {
  return TARJETA_ICON_SIZES.includes(Number(v) as TarjetaIconSize) && /^\d+$/.test(String(v));
}

/** Ruta del ícono de la barbería (PNG cuadrado). No lleva nada del cliente. */
export function rutaIconoTarjeta(slug: string, size: TarjetaIconSize): string {
  return `/b/${encodeURIComponent(slug)}/tarjeta-icono/${size}`;
}

/** Ruta del manifest de ESA tarjeta. */
export function rutaManifestTarjeta(slug: string, token: string): string {
  return `${cardPath(slug, token)}/manifest.webmanifest`;
}

/** Fondo de cada plantilla ofrecida (el mismo de su piel en skins.css). */
const FONDO_PLANTILLA: Record<string, string> = {
  oficio: "#1c1410",
  barrio: "#0c0c0c",
  revista: "#fbfaf7",
};

export interface ColoresDeTarjeta {
  /** Fondo de la pantalla de arranque: el de la plantilla de la barbería. */
  fondo: string;
  /** Barra del sistema e ícono: el acento que eligió la barbería. */
  tema: string;
  /** Color de la letra sobre `tema`. */
  sobreTema: string;
}

export function coloresDeTarjeta(template: unknown, acento: string | null | undefined): ColoresDeTarjeta {
  const id = plantillaOfrecidaBarberWeb(template);
  return {
    fondo: FONDO_PLANTILLA[id] ?? FONDO_PLANTILLA.oficio,
    tema: acentoBarberWeb(acento).fuerte,
    sobreTema: "#ffffff",
  };
}

/** Nombre largo (lo que se lee al instalar) y corto (bajo el ícono). */
export function nombresDeTarjeta(shopName: string, locale?: string | null): { name: string; shortName: string } {
  const limpio = (shopName ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const palabra = locale === "en" ? "Stars" : "Estrellas";
  return {
    name: limpio ? `${palabra} · ${limpio}` : palabra,
    // Bajo el ícono caben ~12 letras: el nombre de la barbería si cabe, si no «Estrellas».
    shortName: limpio && limpio.length <= 12 ? limpio : palabra,
  };
}

/** La inicial para el ícono generado (letra o número; «★» si no hay ninguna). */
export function inicialDeTarjeta(shopName: string): string {
  const m = (shopName ?? "").normalize("NFC").match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : "★";
}

export interface ManifestDeTarjeta {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "portrait";
  background_color: string;
  theme_color: string;
  lang: string;
  icons: { src: string; sizes: string; type: "image/png"; purpose: "any" | "maskable" }[];
}

export function manifestDeTarjeta(args: {
  shopName: string;
  slug: string;
  token: string;
  template: unknown;
  acento: string | null | undefined;
  locale?: string | null;
}): ManifestDeTarjeta {
  const inicio = cardPath(args.slug, args.token);
  const { name, shortName } = nombresDeTarjeta(args.shopName, args.locale);
  const c = coloresDeTarjeta(args.template, args.acento);
  return {
    // Una instalación por tarjeta: si la barbería revoca el enlace, el nuevo es otra app.
    id: inicio,
    name,
    short_name: shortName,
    start_url: inicio,
    // Toda la barbería queda dentro de la ventana: desde la tarjeta se va a «Reservar cita».
    scope: `/b/${encodeURIComponent(args.slug)}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: c.fondo,
    theme_color: c.tema,
    lang: args.locale === "en" ? "en" : "es-MX",
    icons: [
      { src: rutaIconoTarjeta(args.slug, 192), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: rutaIconoTarjeta(args.slug, 512), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: rutaIconoTarjeta(args.slug, 512), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
