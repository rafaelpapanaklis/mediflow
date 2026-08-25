import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  assertBarberPermission,
  getBarberContext,
  BarberForbiddenError,
  type BarberContext,
} from "@/lib/barber-auth";
import { rutaWebBarberia } from "@/lib/barber/landing";

/**
 * Puerta ÚNICA de /api/barber/settings/*.
 *
 *   1. Sesión de barbería (getBarberContext): el barbershopId de TODA
 *      lectura y escritura sale de aquí; body y query no participan.
 *   2. Permiso `settings.edit` (assertBarberPermission, el punto único).
 *
 * La configuración no depende del plan: cada barbería administra la suya.
 */
export type SettingsGate = { ctx: BarberContext } | { response: NextResponse };

export async function gateSettings(): Promise<SettingsGate> {
  const ctx = await getBarberContext();
  if (!ctx) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  try {
    assertBarberPermission(ctx, "settings.edit");
  } catch (e) {
    if (e instanceof BarberForbiddenError) {
      return {
        response: NextResponse.json(
          { error: "No tienes permiso para cambiar la configuración de la barbería.", permission: e.permission },
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
 * La mini-web /b/<slug> es ISR de 5 minutos y pinta nombre, teléfono,
 * dirección y logo. Cada cambio de esos datos la revalida (best-effort).
 */
export function revalidateShopWeb(slug: string): void {
  try {
    revalidatePath(rutaWebBarberia(slug));
  } catch (e) {
    console.error("[barber/settings] revalidatePath falló:", e);
  }
}
