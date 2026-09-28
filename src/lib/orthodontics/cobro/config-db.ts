// ═══════════════════════════════════════════════════════════════════════════
// Política de cobro por CLÍNICA (ws1-t1, Ola 1 · Cobro): F9 (catálogo de
// reglas de descuento) y F10 (recargo por atraso, apagado por default).
//
// Tabla `orthodontic_billing_configs` (sql/ortodoncia-cobro.sql), una fila
// por clínica, creada perezosamente al guardar. SQL crudo + sonda
// `to_regclass`, mismo patrón que `lib/invoices/condiciones-pago-db.ts`:
// SIN el SQL aplicado, esto no tumba nada — devuelve la config neutra.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import {
  configDeCobroPorDefecto,
  type ConfigRecargoPorAtraso,
  type ReglaDescuento,
  type TipoValorRecargo,
} from "./reglas";

export interface ConfigDeCobro {
  discountRules: ReglaDescuento[];
  lateFee: ConfigRecargoPorAtraso;
}

let tabla: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function tablaExiste(): Promise<boolean> {
  const t = Date.now();
  if (tabla && (tabla.existe || t - tabla.at < TTL_MS)) return tabla.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.orthodontic_billing_configs') IS NOT NULL AS existe`;
    tabla = { existe: filas[0]?.existe === true, at: t };
    return tabla.existe;
  } catch (e) {
    console.warn("[ortodoncia:cobro-config] no se pudo comprobar la tabla:", e);
    return false;
  }
}

/** Solo para pruebas: olvida lo que se sabía de la tabla. */
export function _olvidarTablaConfig(): void {
  tabla = null;
}

function reglasDesdeJson(raw: unknown): ReglaDescuento[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => r != null && typeof r === "object")
    .map((r) => ({
      id: typeof r.id === "string" && r.id ? r.id : `regla-${Math.random().toString(36).slice(2, 8)}`,
      etiqueta: typeof r.etiqueta === "string" ? r.etiqueta : "Descuento",
      porcentaje: isFinite(Number(r.porcentaje)) ? Number(r.porcentaje) : 0,
    }));
}

interface Fila {
  lateFeeEnabled: boolean;
  lateFeeType: string;
  lateFeeValue: unknown;
  lateFeeGraceDays: number;
  discountRules: unknown;
}

/** Lee la política de cobro de la clínica, o la config neutra si no hay fila (o falta la tabla). */
export async function leerConfigDeCobro(clinicId: string): Promise<ConfigDeCobro> {
  const neutra = configDeCobroPorDefecto();
  if (!clinicId) return neutra;
  if (!(await tablaExiste())) return neutra;
  try {
    const filas = await prisma.$queryRaw<Fila[]>`
      SELECT "lateFeeEnabled", "lateFeeType", "lateFeeValue", "lateFeeGraceDays", "discountRules"
        FROM "orthodontic_billing_configs"
       WHERE "clinicId" = ${clinicId}
       LIMIT 1`;
    const f = filas[0];
    if (!f) return neutra;
    return {
      discountRules: reglasDesdeJson(f.discountRules),
      lateFee: {
        activo: f.lateFeeEnabled === true,
        tipo: f.lateFeeType === "FIJO" ? "FIJO" : "PCT",
        valor: isFinite(Number(f.lateFeeValue)) ? Number(f.lateFeeValue) : 0,
        diasDeGracia: Number.isInteger(f.lateFeeGraceDays) ? f.lateFeeGraceDays : 5,
      },
    };
  } catch (e) {
    console.warn("[ortodoncia:cobro-config] no se pudo leer:", e);
    return neutra;
  }
}

export interface GuardarConfigResultado {
  ok: boolean;
  sinTabla: boolean;
  config: ConfigDeCobro | null;
}

/** Guarda (o crea) la política de cobro de una clínica. */
export async function guardarConfigDeCobro(
  clinicId: string,
  patch: { discountRules: ReglaDescuento[]; lateFeeEnabled: boolean; lateFeeType: TipoValorRecargo; lateFeeValue: number; lateFeeGraceDays: number },
): Promise<GuardarConfigResultado> {
  if (!clinicId) return { ok: false, sinTabla: false, config: null };
  if (!(await tablaExiste())) return { ok: false, sinTabla: true, config: null };
  try {
    const reglasJson = JSON.stringify(patch.discountRules ?? []);
    await prisma.$executeRaw`
      INSERT INTO "orthodontic_billing_configs"
        ("clinicId", "lateFeeEnabled", "lateFeeType", "lateFeeValue", "lateFeeGraceDays", "discountRules", "updatedAt")
      VALUES
        (${clinicId}, ${patch.lateFeeEnabled}, ${patch.lateFeeType}, ${patch.lateFeeValue}::numeric,
         ${patch.lateFeeGraceDays}, ${reglasJson}::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT ("clinicId") DO UPDATE SET
        "lateFeeEnabled" = EXCLUDED."lateFeeEnabled",
        "lateFeeType" = EXCLUDED."lateFeeType",
        "lateFeeValue" = EXCLUDED."lateFeeValue",
        "lateFeeGraceDays" = EXCLUDED."lateFeeGraceDays",
        "discountRules" = EXCLUDED."discountRules",
        "updatedAt" = CURRENT_TIMESTAMP`;
    return {
      ok: true,
      sinTabla: false,
      config: {
        discountRules: patch.discountRules,
        lateFee: { activo: patch.lateFeeEnabled, tipo: patch.lateFeeType, valor: patch.lateFeeValue, diasDeGracia: patch.lateFeeGraceDays },
      },
    };
  } catch (e) {
    console.warn("[ortodoncia:cobro-config] no se pudo guardar:", e);
    return { ok: false, sinTabla: false, config: null };
  }
}
