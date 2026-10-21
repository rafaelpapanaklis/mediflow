// El aviso de una subida de imagen que falló (P4 → editor). PURO: sin React ni
// DOM, para poder probarlo sin montar el editor.

import type { TFunction } from "@/i18n/t";
import { IMAGEN_MAX_BYTES, IMAGEN_MAX_POR_DOCUMENTO } from "@/lib/documentos/limites-imagen";

/**
 * El aviso de una subida que falló, por el `codigo` de `subirImagenDocumento`
 * (P4). Los que conoce el editor van traducidos; los que manda el servidor
 * (cuota del plan, permiso…) traen su texto en español: se enseña tal cual en
 * español y el genérico en inglés.
 */
const CODIGO_A_CLAVE: Record<string, string> = {
  muy_pesada: "editorDocumento.imagen.demasiadoGrande",
  tipo_no_permitido: "editorDocumento.imagen.tipoNoValido",
  tope_por_documento: "editorDocumento.imagen.tope",
  heic_no_legible: "editorDocumento.imagen.heicNoLegible",
  no_se_pudo_leer: "editorDocumento.imagen.noSePudoLeer",
  vacia: "editorDocumento.imagen.noSePudoLeer",
  demasiados_pixeles: "editorDocumento.imagen.demasiadosPixeles",
  sesion: "editorDocumento.imagen.sesion",
  red: "editorDocumento.imagen.red",
};

export function mensajeDeSubida(
  err: unknown,
  t: TFunction,
  locale: string,
): string {
  const e = err as { name?: string; codigo?: unknown; estado?: unknown; message?: unknown } | null;
  const codigo = typeof e?.codigo === "string" ? e.codigo : "";
  const clave = CODIGO_A_CLAVE[codigo];
  if (clave) return t(clave, { mb: Math.round(IMAGEN_MAX_BYTES / (1024 * 1024)), n: IMAGEN_MAX_POR_DOCUMENTO });
  const delServidor = e?.name === "ErrorImagenDocumento" && typeof e.estado === "number" && e.estado >= 400 && e.estado < 500;
  if (delServidor && locale.startsWith("es") && typeof e.message === "string" && e.message) return e.message;
  return t("editorDocumento.imagen.errorSubida");
}
