// Lo común de las rutas de /api/documentos/imagenes: sesión, permiso clínico y
// límite por usuario. `clinicId` y `userId` salen SIEMPRE de la sesión.
//
// Las imágenes viven dentro de plantillas y notas de evolución, que hoy se
// escriben con `medicalRecord.edit` y se leen con `medicalRecord.view`: no se
// inventa un permiso. Subir pide escribir; ver pide leer.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { denyIfNotClinical, type ModoClinico } from "@/lib/auth/guardia-clinica";
import { persistentRateLimit } from "@/lib/failban";
import { extractAuditMeta } from "@/lib/audit";
import { MENSAJES_IMAGEN, esClinicaParaClave, type CodigoImagen } from "@/lib/documentos/imagenes";
import { ESTADO_POR_CODIGO, type QuienSube } from "@/lib/documentos/imagenes.server";

/**
 * Límites por usuario (ventana de 10 min). Un documento admite 40 imágenes:
 * subir 60 en 10 minutos es trabajo de verdad; más es un script. Ver cubre una
 * hoja con 40 imágenes abierta y recargada varias veces.
 */
export const LIMITES = {
  subir: { scope: "documentos-imagenes-subir", limit: 60 },
  original: { scope: "documentos-imagenes-original", limit: 60 },
  ver: { scope: "documentos-imagenes-ver", limit: 1200 },
} as const;

const VENTANA_SEG = 600;

export async function entrar(
  req: NextRequest,
  modo: ModoClinico,
  limite: { scope: string; limit: number },
): Promise<{ ctx: AuthContext; res?: undefined } | { res: Response; ctx?: undefined }> {
  const ctx = await getAuthContext();
  if (!ctx) return { res: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  const denied = denyIfNotClinical(ctx, modo);
  if (denied) return { res: denied };
  const limited = await persistentRateLimit(req, { id: ctx.userId, limit: limite.limit, windowSec: VENTANA_SEG, scope: limite.scope });
  if (limited) return { res: limited };
  // La clínica es la carpeta del bucket: un id con caracteres raros no se usa
  // para armar rutas (no pasa con los ids de hoy; si pasara, se corta aquí).
  if (!esClinicaParaClave(ctx.clinicId)) {
    console.error("[documentos/imagenes] clinicId no apto para la clave:", ctx.clinicId);
    return { res: NextResponse.json({ error: "No se pudo guardar la imagen." }, { status: 500 }) };
  }
  return { ctx };
}

export function quienSube(ctx: AuthContext, req: NextRequest): QuienSube {
  return { clinicId: ctx.clinicId, userId: ctx.userId, ...extractAuditMeta(req) };
}

export function respuestaDeCodigo(codigo: CodigoImagen): Response {
  return NextResponse.json({ error: MENSAJES_IMAGEN[codigo], code: codigo }, { status: ESTADO_POR_CODIGO[codigo] });
}

/** El mismo 404 para «no existe», «es de otra clínica» y «clave mal formada»: sin oráculo. */
export const noEncontrada = () => NextResponse.json({ error: "Imagen no encontrada" }, { status: 404 });

export async function leerJson(req: NextRequest): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

/** El tope de 40 por documento, cuando el editor dice cuántas lleva ya (cortesía: el corte duro es al guardar). */
export function excedeTope(enDocumento: unknown, tope: number): boolean {
  const n = Number(enDocumento);
  return Number.isFinite(n) && n >= tope;
}
