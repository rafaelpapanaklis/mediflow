// ═══════════════════════════════════════════════════════════════════════════
// Lee y guarda las «Condiciones del convenio» de una clínica (ws1-t4).
//
// Columna "agreementTerms" de "orthodontic_billing_configs"
// (sql/ortodoncia-condiciones-convenio.sql). SQL crudo + sonda de columna,
// mismo patrón que `config-db.ts`: sin el SQL pegado nada se cae — la lectura
// devuelve null (= el ejemplo) y el guardado responde `sinColumna`.
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { normalizarCondicionesConvenio } from "./condiciones-convenio";

let sonda: { existe: boolean; at: number } | null = null;
const TTL_MS = 60_000;

async function columnaExiste(): Promise<boolean> {
  const t = Date.now();
  if (sonda && (sonda.existe || t - sonda.at < TTL_MS)) return sonda.existe;
  try {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'orthodontic_billing_configs'
           AND column_name = 'agreementTerms'
      ) AS existe`;
    sonda = { existe: filas[0]?.existe === true, at: t };
    return sonda.existe;
  } catch (e) {
    console.warn("[ortodoncia:condiciones-convenio] no se pudo comprobar la columna:", e);
    return false;
  }
}

/** Solo para pruebas. */
export function _olvidarSondaCondiciones(): void {
  sonda = null;
}

/**
 * Las condiciones guardadas de la clínica. `null` = nunca las editó (o falta
 * el SQL): quien llama usa el ejemplo. `""` = las dejó en blanco a propósito.
 */
export async function leerCondicionesDelConvenio(
  clinicId: string,
): Promise<{ texto: string | null; columnaLista: boolean }> {
  if (!clinicId) return { texto: null, columnaLista: false };
  if (!(await columnaExiste())) return { texto: null, columnaLista: false };
  try {
    const filas = await prisma.$queryRaw<{ agreementTerms: string | null }[]>`
      SELECT "agreementTerms" FROM "orthodontic_billing_configs" WHERE "clinicId" = ${clinicId} LIMIT 1`;
    return { texto: filas[0]?.agreementTerms ?? null, columnaLista: true };
  } catch (e) {
    console.warn("[ortodoncia:condiciones-convenio] no se pudieron leer:", e);
    return { texto: null, columnaLista: true };
  }
}

/** Guarda (o crea la fila de) las condiciones. Solo toca "agreementTerms": la política de cobro queda igual. */
export async function guardarCondicionesDelConvenio(
  clinicId: string,
  texto: string,
): Promise<{ ok: boolean; sinColumna: boolean; texto: string | null }> {
  if (!clinicId) return { ok: false, sinColumna: false, texto: null };
  if (!(await columnaExiste())) return { ok: false, sinColumna: true, texto: null };
  const limpio = normalizarCondicionesConvenio(texto);
  try {
    await prisma.$executeRaw`
      INSERT INTO "orthodontic_billing_configs" ("clinicId", "agreementTerms", "updatedAt")
      VALUES (${clinicId}, ${limpio}, CURRENT_TIMESTAMP)
      ON CONFLICT ("clinicId") DO UPDATE SET
        "agreementTerms" = EXCLUDED."agreementTerms",
        "updatedAt" = CURRENT_TIMESTAMP`;
    return { ok: true, sinColumna: false, texto: limpio };
  } catch (e) {
    console.error("[ortodoncia:condiciones-convenio] no se pudieron guardar:", e);
    return { ok: false, sinColumna: false, texto: null };
  }
}
