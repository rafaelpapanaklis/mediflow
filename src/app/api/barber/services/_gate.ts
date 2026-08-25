import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  assertBarberPermission,
  getBarberContext,
  BarberForbiddenError,
  type BarberContext,
  type BarberPermissionKey,
} from "@/lib/barber-auth";
import { rutaWebBarberia } from "@/lib/barber/landing";

/**
 * Puerta ÚNICA de /api/barber/services/*.
 *
 *   1. Sesión de barbería (getBarberContext). De aquí sale el barbershopId
 *      que usa TODA lectura y TODA escritura; body y query no participan.
 *   2. Permiso del rol (assertBarberPermission — el punto único del vertical).
 *
 * El catálogo no tiene feature de plan: todos los planes tienen servicios
 * (sin ellos no hay agenda ni reserva). El caller hace
 * `if ("response" in gate) return gate.response;`.
 */
export type ServicesGate = { ctx: BarberContext } | { response: NextResponse };

export async function gateServices(
  permission: BarberPermissionKey = "services.manage",
): Promise<ServicesGate> {
  const ctx = await getBarberContext();
  if (!ctx) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  try {
    assertBarberPermission(ctx, permission);
  } catch (e) {
    if (e instanceof BarberForbiddenError) {
      return {
        response: NextResponse.json(
          { error: "No tienes permiso para administrar los servicios.", permission: e.permission },
          { status: 403 },
        ),
      };
    }
    throw e;
  }
  return { ctx };
}

/** JSON del body, tolerante: un cuerpo vacío o roto es {} y no un 500. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * La mini-web /b/<slug> es ISR de 5 minutos y pinta el catálogo con sus
 * precios. Cada cambio del catálogo la revalida (best-effort: el cambio YA
 * está en la base; como mucho tarda lo que tarde el ISR en caducar).
 */
export function revalidateShopWeb(slug: string): void {
  try {
    revalidatePath(rutaWebBarberia(slug));
  } catch (e) {
    console.error("[barber/services] revalidatePath falló:", e);
  }
}
