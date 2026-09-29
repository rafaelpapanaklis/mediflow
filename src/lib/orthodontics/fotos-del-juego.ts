// Ortodoncia — quitar una foto de un juego y fotos extra (ws1-t12).
// PURO: lo usan las acciones, el cargador y SectionPhotos, y lo prueban los
// tests en node. Nada de base ni de React.
//
// Regla clínica (NOM-004): una foto que se quita NO se borra —ni el archivo
// ni su fila—: deja de mostrarse y queda anotado quién, cuándo y por qué.

import type { OrthoPhotoView, PhotoSetIdColumns } from "./photo-set-helpers";
import { VIEW_TO_ID_COLUMN } from "./photo-set-helpers";

/** Vista de la pantalla (id del slot) → vista del API. Solo las 8 que tienen columna. */
export const SLOT_A_VISTA: Readonly<Record<string, OrthoPhotoView>> = {
  normal: "EXTRA_FRONTAL",
  lateral: "EXTRA_PROFILE",
  sonrisa: "EXTRA_SMILE",
  frontal: "INTRA_FRONTAL_OCCLUSION",
  lat_der: "INTRA_LATERAL_RIGHT",
  lat_izq: "INTRA_LATERAL_LEFT",
  oclusal_sup: "INTRA_OCCLUSAL_UPPER",
  oclusal_inf: "INTRA_OCCLUSAL_LOWER",
};

/** Columna `*Id` del juego donde vive la foto de esa vista, o null si la vista no se guarda. */
export function columnaDeVista(slotId: string): keyof PhotoSetIdColumns | null {
  // `slotId` viene del cliente: «constructor» o «__proto__» no son vistas.
  if (!Object.prototype.hasOwnProperty.call(SLOT_A_VISTA, slotId)) return null;
  return VIEW_TO_ID_COLUMN[SLOT_A_VISTA[slotId]!] ?? null;
}

/**
 * Las 2 vistas del catálogo de la pantalla que NO tienen columna en
 * `ortho_photo_sets` (el juego guarda 8 columnas tipadas). Se guardan como
 * filas de `ortho_photo_extras` con `slotId` (sql/ortodoncia-fotos-sobremordida-
 * resalte.sql): una sola vigente por juego y vista, y se quitan igual que las
 * demás (se marcan, no se borran).
 */
export const SLOTS_EN_EXTRAS: readonly string[] = ["sobremordida", "resalte"];

export function esVistaEnExtras(slotId: unknown): boolean {
  return typeof slotId === "string" && SLOTS_EN_EXTRAS.includes(slotId);
}

export const MOTIVO_MAX = 300;
export const ETIQUETA_MAX = 60;
/** Tope de fotos extra por juego (el juego es un expediente, no una galería sin fondo). */
export const EXTRAS_MAX_POR_JUEGO = 30;

/** Texto libre opcional: sin espacios de más, sin saltos, recortado; vacío → null. */
export function limpiarTexto(valor: unknown, max: number): string | null {
  if (typeof valor !== "string") return null;
  const t = valor.replace(/\s+/g, " ").trim().slice(0, max).trim();
  return t === "" ? null : t;
}

export const limpiarMotivo = (v: unknown) => limpiarTexto(v, MOTIVO_MAX);
export const limpiarEtiqueta = (v: unknown) => limpiarTexto(v, ETIQUETA_MAX);

/** Nombre con el que se ve una foto extra: su etiqueta, o «Extra N». */
export function nombreDeExtra(etiqueta: string | null | undefined, indice: number): string {
  return etiqueta && etiqueta.trim() ? etiqueta.trim() : `Extra ${indice + 1}`;
}

export interface FotoExtra {
  id: string;
  url: string;
  label: string | null;
  uploadedAt: string;
}

/** ¿La tabla de fotos extra / quitadas todavía no existe (SQL sin pegar)? */
export function faltaLaTablaDeFotos(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  if (err.code === "P2010" && err.meta?.code === "42P01") return true;
  if (err.code === "42P01" || err.meta?.code === "42P01" || err.code === "P2021") return true;
  return typeof err.message === "string" && /ortho_photo_(extras|removals).*does not exist|42P01/i.test(err.message);
}

/** ¿Falta la columna `slotId` de `ortho_photo_extras` (segundo SQL sin pegar)? */
export function faltaLaColumnaDeFotos(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: string; meta?: { code?: string }; message?: string };
  if (err.code === "P2010" && err.meta?.code === "42703") return true;
  if (err.code === "42703" || err.meta?.code === "42703" || err.code === "P2022") return true;
  return typeof err.message === "string" && /slotId.*does not exist|42703/i.test(err.message);
}

export const MENSAJE_SIN_COLUMNA_DE_VISTA =
  "Sobremordida y resalte todavía no se pueden guardar en esta clínica: falta aplicar la actualización de la base.";

export const MENSAJE_SIN_TABLA_DE_FOTOS =
  "Esta función todavía no está disponible en esta clínica: falta aplicar la actualización de la base.";
