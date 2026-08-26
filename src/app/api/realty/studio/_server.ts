import "server-only";
// ═══════════════════════════════════════════════════════════════════════
// Puerta ÚNICA de las rutas del ESTUDIO IA del vertical INMUEBLES.
//
// Las comprobaciones que TODA ruta de aquí necesita, en un solo sitio:
//   1. sesión (el accountId sale de aquí, JAMÁS del request);
//   2. MODO de la cuenta;
//   3. FEATURE `aiStudio` del plan — vive solo en INMOBILIARIA. Se comprueba
//      por la feature, NUNCA por el id del plan: los planes se editan en
//      realty_plan_configs sin desplegar, y un `plan === "INMOBILIARIA"` a
//      mano se queda viejo el día que alguien mueva la escalera;
//   4. PERMISO del rol;
//   5. suscripción activa y cuenta activa.
//
// ⚠️ EL PERMISO ES `properties.edit`, NO uno propio. El estudio genera
// contenido PARA un inmueble y todo lo que produce se cuelga de él, así que
// quien puede editar el inmueble puede generarlo. La alternativa —una llave
// nueva en REALTY_PERMISSIONS— exigía tocar src/lib/realty/permissions.ts,
// que está fuera del allowlist de esta terminal. El corte queda razonable:
// AGENT sí (tiene properties.edit), ASSISTANT no (solo properties.view).
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { getRealtyContext, type RealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { isRealtySubscriptionActive, realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import {
  REALTY_STUDIO_FEATURE,
  REALTY_STUDIO_PERMISSION,
} from "@/lib/realty/studio/types";

// Las dos llaves viven en el contrato PURO (studio/types.ts) para que la
// pagina pueda comprobar lo mismo sin arrastrar `server-only`. Aqui solo se
// re-exportan, para que quien lea esta puerta las tenga a la mano.
export { REALTY_STUDIO_FEATURE, REALTY_STUDIO_PERMISSION } from "@/lib/realty/studio/types";

export interface StudioGateOk {
  ok: true;
  ctx: RealtyContext;
}
export interface StudioGateErr {
  ok: false;
  response: NextResponse;
}
export type StudioGate = StudioGateOk | StudioGateErr;

/**
 * 🔴 Guarda de tipo EXPLÍCITA y no `if (gate.ok)`. El repo compila con
 * `strict: false` y ahí TypeScript NO estrecha una unión por un booleano
 * discriminante: sin esto, `gate.ctx` no compila en la rama buena.
 */
export function isStudioGateOk(gate: StudioGate): gate is StudioGateOk {
  return gate.ok === true;
}

export async function openStudioGate(): Promise<StudioGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  // El modo: si algún día el estudio se recorta por modo, sale del contrato
  // y no de un if inventado aquí. Hoy el item no existe, así que no recorta.
  const item = REALTY_NAV_ITEMS.find((i) => i.key === "estudio");
  if (item && !navItemAllowsMode(item, ctx.mode)) {
    return { ok: false, response: NextResponse.json({ error: "No disponible" }, { status: 403 }) };
  }

  if (!realtyPlanHasFeature(ctx.plan, REALTY_STUDIO_FEATURE)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Tu plan no incluye el Estudio con IA.", reason: "plan" },
        { status: 403 },
      ),
    };
  }

  if (
    !hasRealtyPermission(
      { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
      REALTY_STUDIO_PERMISSION,
    )
  ) {
    return { ok: false, response: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) };
  }

  if (!isRealtySubscriptionActive(ctx.account)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "La suscripción no está activa.", reason: "subscription" },
        { status: 403 },
      ),
    };
  }

  if (!ctx.account.isActive) {
    return {
      ok: false,
      response: NextResponse.json({ error: "La cuenta está desactivada." }, { status: 403 }),
    };
  }

  return { ok: true, ctx };
}

/**
 * Un inmueble de ESTA cuenta, o null. El accountId sale de la sesión: un
 * propertyId de otra inmobiliaria no resuelve, no importa qué mande quien
 * llama.
 */
export async function ownedProperty(accountId: string, propertyId: string) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.realtyProperty.findFirst({
    where: { id: propertyId, accountId },
    select: {
      id: true,
      title: true,
      kind: true,
      operation: true,
      price: true,
      rentPrice: true,
      currency: true,
      bedrooms: true,
      bathrooms: true,
      parking: true,
      builtM2: true,
      landM2: true,
      colonia: true,
      city: true,
      state: true,
      amenities: true,
      description: true,
      // Las fotos que va a MIRAR el modelo al redactar. En el orden de la
      // galería (portada primero), que es el que el asesor ya decidió: la
      // portada es la foto que él considera que vende el inmueble.
      //
      // Se piden 3 y no todas: cada imagen se paga por su tamaño en tokens
      // de entrada (ver VISION_MAX_PHOTOS en studio/copy.ts).
      photos: {
        select: { url: true },
        orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
        take: 3,
      },
    },
  });
}

/** Errores de base por SQL sin aplicar → 503 con un motivo legible. */
export function studioServerError(scope: string, err: unknown): NextResponse {
  const code = (err as { code?: string })?.code;
  if (code === "P2021" || code === "42P01" || code === "P2022" || code === "42703") {
    return NextResponse.json(
      { error: "La base todavía no tiene las tablas de inmuebles.", code: "schema_not_migrated" },
      { status: 503 },
    );
  }
  console.error(`[realty/studio/${scope}]`, err);
  return NextResponse.json({ error: "Algo salió mal." }, { status: 500 });
}
