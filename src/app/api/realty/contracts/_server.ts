// ═══════════════════════════════════════════════════════════════════════
// PUERTA ÚNICA de las APIs de contratos del panel.
//
// Las tres comprobaciones en un solo sitio y en este orden:
//   1. SESIÓN  → 401. De aquí sale el accountId, y de ningún otro lado.
//   2. PLAN    → 403. La feature `rentals` ("Contratos de renta y
//                cobranza") es la que gatea este módulo. No se inventó una
//                feature nueva: `REALTY_FEATURE_KEYS` vive en
//                plan-shared.ts, que esta terminal no toca, y `rentals` es
//                exactamente lo que describe.
//   3. PERMISO → 403, vía assertRealtyPermission. Se usa `leases.manage`
//                ("Administrar contratos de arrendamiento") por el mismo
//                motivo: es el permiso que ya existe y que ya significa
//                esto. Por defecto lo tienen OWNER, MANAGER y ASSISTANT;
//                un AGENT no genera contratos vinculantes, y eso es lo
//                correcto.
//
// ⚠️ NO hay item de menú para esta sección: REALTY_NAV_ITEMS vive en
// src/lib/realty/types.ts y esta terminal tiene prohibido tocarlo. La
// sección funciona por URL y las páginas la enlazan entre sí. Queda
// anotado en ORQUESTA.md como el ÚNICO paso pendiente para que aparezca
// en el sidebar (una línea).
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import {
  RealtyForbiddenError,
  assertRealtyPermission,
  getRealtyContext,
  type RealtyContext,
} from "@/lib/realty-auth";
import { ContractError, ContractTablesMissingError } from "@/lib/realty/contracts";

export type ContractGate = { ctx: RealtyContext } | { response: NextResponse };

export async function gateContracts(): Promise<ContractGate> {
  const ctx = await getRealtyContext();
  if (!ctx) {
    return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }
  if (ctx.plan.features.rentals !== true) {
    return {
      response: NextResponse.json(
        { error: "Tu plan todavía no incluye los contratos.", code: "PLAN_LOCKED" },
        { status: 403 },
      ),
    };
  }
  try {
    assertRealtyPermission(ctx, "leases.manage");
  } catch (e) {
    if (e instanceof RealtyForbiddenError) {
      return {
        response: NextResponse.json(
          { error: "No tienes permiso para hacer eso.", code: "FORBIDDEN" },
          { status: 403 },
        ),
      };
    }
    throw e;
  }
  return { ctx };
}

/**
 * El origen desde el que se está sirviendo la petición.
 *
 * Sirve para armar la liga de firma cuando NEXT_PUBLIC_APP_URL no está
 * puesta (no lo está en todos los ambientes). Se prefiere `origin`, que
 * manda el navegador; `host` + protocolo es la red de abajo detrás de un
 * proxy que lo quita. Si no hay ninguno, se devuelve null y signatureUrl
 * arma una ruta relativa antes que una URL inventada.
 */
export function requestOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!host) return null;
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

/** Body JSON tolerante: un cuerpo vacío o roto es {} y no un 500. */
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
 * Traduce el error al JSON que espera la pantalla.
 *
 * ContractTablesMissingError sale APARTE y con su propio código porque no
 * es "algo falló": es "falta correr el .sql", y la pantalla enseña el
 * comando en vez de un error genérico que nadie sabría diagnosticar.
 *
 * El resto de las excepciones se registran en el log del servidor y salen
 * como un 500 sin detalle: una traza filtra rutas, nombres de tabla y a
 * veces fragmentos de la consulta.
 */
export function contractsApiError(e: unknown, scope: string): NextResponse {
  if (e instanceof ContractError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ContractTablesMissingError) {
    console.error(`[api/realty/contracts/${scope}] tablas ausentes:`, e.detail);
    return NextResponse.json(
      {
        error:
          "Los contratos todavía no están listos en esta base de datos. " +
          "Hay que correr sql/realty-contratos.sql.",
        code: "TABLES_MISSING",
      },
      { status: 503 },
    );
  }
  console.error(`[api/realty/contracts/${scope}]`, e);
  return NextResponse.json({ error: "Algo salió mal. Inténtalo otra vez." }, { status: 500 });
}
