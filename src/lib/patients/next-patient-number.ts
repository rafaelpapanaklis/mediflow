import { prisma } from "@/lib/prisma";
import {
  MAX_FOLIO_DIGITS,
  nextPatientNumberFrom,
} from "./next-patient-number-core";

/**
 * Folio de paciente (patientNumber) — FUENTE ÚNICA para todo el repo.
 *
 * Antes cada generador hacía `count + 1` sobre las filas de la clínica. Con
 * cualquier baja definitiva quedan huecos y ese `count + 1` apunta a un folio YA
 * emitido → viola @@unique([clinicId, patientNumber]) → P2002 → alta imposible.
 * Aquí el folio sale del MÁXIMO REALMENTE EMITIDO y se compara como NÚMERO.
 *
 * Uso:
 *   const patientNumber = await nextPatientNumber(clinicId, tx);   // dentro de tx
 *   await withPatientNumberRetry(() => prisma.$transaction(...));  // envolviendo
 */

/** Cliente admitido: el prisma global o el `tx` de una transacción. */
export type FolioClient = { $queryRaw: typeof prisma.$queryRaw };

/**
 * Mayor folio emitido de la clínica, o null si no hay ninguno numérico.
 *
 * Cuenta TODAS las filas, incluidas las de `deletedAt != null`: un folio emitido
 * no se recicla ni aunque el paciente esté archivado. NO añadir aquí un filtro
 * por deletedAt — reintroduce exactamente el bug que este módulo arregla.
 */
export async function lastPatientFolio(
  clinicId: string,
  client: FolioClient = prisma,
): Promise<number | null> {
  // MAX numérico: ordenar como texto pondría P9999 por encima de P10000.
  // El filtro por longitud evita que un folio absurdo reviente el CAST (22003).
  const rows = await client.$queryRaw<{ max: bigint | number | null }[]>`
    SELECT MAX(CAST(digits AS BIGINT)) AS max
    FROM (
      SELECT NULLIF(regexp_replace("patientNumber", '[^0-9]', '', 'g'), '') AS digits
      FROM "patients"
      WHERE "clinicId" = ${clinicId}
    ) s
    WHERE digits IS NOT NULL AND length(digits) <= ${MAX_FOLIO_DIGITS}
  `;
  const raw = rows[0]?.max ?? null;
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Siguiente folio libre de la clínica (`P0001` si es la primera alta).
 * Pásale el `tx` cuando estés dentro de una transacción con row-lock: así el
 * cálculo ve lo mismo que el INSERT que viene detrás.
 */
export async function nextPatientNumber(
  clinicId: string,
  client: FolioClient = prisma,
): Promise<string> {
  return nextPatientNumberFrom(await lastPatientFolio(clinicId, client));
}

/** Se agotaron los reintentos de folio: quien llama debe responder 409, no 500. */
export class PatientNumberExhaustedError extends Error {
  readonly code = "PATIENT_NUMBER_CONFLICT";
  constructor() {
    super(
      "No se pudo asignar un número de expediente por alta simultánea. Inténtalo de nuevo.",
    );
    this.name = "PatientNumberExhaustedError";
  }
}

/** ¿El error es un P2002 del índice de patientNumber? */
export function isPatientNumberConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  // `meta.target` llega como columnas (["clinicId","patientNumber"]) o como el
  // nombre del índice ("patients_clinicId_patientNumber_key") según el driver.
  const text = Array.isArray(target) ? target.join(",") : typeof target === "string" ? target : "";
  // Sin target no podemos distinguirlo: asumimos que es el folio. Reintentar es
  // inocuo (el folio se recalcula) y si de verdad era otro índice el P2002
  // vuelve a salir igual en el reintento y termina propagándose.
  return text === "" || text.includes("patientNumber");
}

/**
 * Ejecuta `attempt` reintentando cuando dos altas simultáneas se pelean el mismo
 * folio (P2002). Cada intento recalcula el folio desde el máximo real.
 *
 * IMPORTANTE: si `attempt` usa una transacción, debe ABRIRLA DENTRO (que la
 * llamada a $transaction quede envuelta por este helper, no al revés): en
 * Postgres una transacción abortada por P2002 ya no admite más queries, así que
 * reintentar dentro de la misma tx fallaría con 25P02.
 */
export async function withPatientNumberRetry<T>(
  attempt: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      // Cualquier otro error se propaga tal cual: solo la carrera de folio se
      // reintenta. Agotados los intentos caemos al 409 de abajo, nunca a un 500.
      if (!isPatientNumberConflict(err)) throw err;
    }
  }
  throw new PatientNumberExhaustedError();
}
