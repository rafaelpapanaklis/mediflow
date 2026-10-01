import { NextResponse } from "next/server";
import type { AuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { ErrorAprende } from "./tablas";

/**
 * Permisos de «Aprende de tu equipo» (ws1-t11). La pantalla muestra textos que
 * salen de las conversaciones del Inbox (anonimizados), así que VER pide los
 * dos permisos: el del bot (`whatsapp.view`) y el del Inbox (`inbox.view`).
 * CAMBIAR algo que el bot le dirá a pacientes (aprobar, corregir, tono) pide
 * `whatsapp.send`, el mismo permiso que editar las FAQ.
 */
export function denegarSiNoPuedeVer(ctx: AuthContext): NextResponse | null {
  return denyIfMissingPermission(ctx, "whatsapp.view") ?? denyIfMissingPermission(ctx, "inbox.view");
}

export function denegarSiNoPuedeEditar(ctx: AuthContext): NextResponse | null {
  return denegarSiNoPuedeVer(ctx) ?? denyIfMissingPermission(ctx, "whatsapp.send");
}

export function respuestaDeError(e: unknown, donde: string): NextResponse {
  if (e instanceof ErrorAprende) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  console.error(`[bot/aprende] ${donde}:`, e);
  return NextResponse.json({ error: "No se pudo completar. Intenta de nuevo." }, { status: 500 });
}

export async function leerJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
