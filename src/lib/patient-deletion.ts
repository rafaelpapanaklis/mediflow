// Precheck del borrado DEFINITIVO de un paciente (DELETE ?mode=hard).
//
// Archivar (status ARCHIVED) siempre se puede. Borrar de verdad casi nunca: el
// criterio está INVERTIDO desde 2026-08-06 (P0-1). La decisión de qué puede
// morir con el paciente —y el porqué de cada entrada— vive en
// `@/lib/patient-deletion-policy`; aquí sólo se cuenta contra la BD.
//
// Lo que este módulo hace, en orden:
//   1. Enumera las relaciones a `Patient` leyendo el DMMF de Prisma, NO una
//      lista escrita a mano. Una tabla nueva del schema aparece sola.
//   2. Las reparte con la política: allowlist explícita → puede cascadear;
//      TODO lo demás → bloquea.
//   3. Cuenta filas de lo que bloquea y lo agrupa en razones que la UI traduce.
//   4. Suma aparte lo fiscal (facturas/pagos/CFDI), que tiene reglas propias.
//
// Multi-tenant: `clinicId` lo pone SIEMPRE el caller desde la sesión.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  classifyPatientRelations,
  summarizeBlockers,
  type BlockingModel,
  type PatientDeleteBlocker,
  type PatientDeleteBlockerType,
  type PatientRelationModel,
} from "@/lib/patient-deletion-policy";

export type { PatientDeleteBlocker, PatientDeleteBlockerType };

/**
 * Lee del DMMF todos los modelos con una FK a `Patient`. Esto es lo que hace
 * que el precheck no se pueda quedar obsoleto: no hay lista que mantener, la
 * fuente es el schema compilado.
 */
export function patientRelationsFromDmmf(): PatientRelationModel[] {
  const models = Prisma.dmmf?.datamodel?.models;
  if (!Array.isArray(models) || models.length === 0) {
    // Sin DMMF no hay forma de saber qué cuelga del paciente. Se lanza en vez de
    // devolver [] porque un array vacío significaría "no hay nada que bloquear"
    // y el borrado pasaría arrasando: exactamente el fallo que este módulo
    // existe para impedir. El caller responde 500, no un 200 que borra.
    throw new Error(
      "[patient-deletion] Prisma.dmmf no disponible: no se puede verificar qué cuelga del paciente",
    );
  }
  const out: PatientRelationModel[] = [];
  for (const model of models) {
    const hasClinicId = model.fields.some((f) => f.name === "clinicId");
    for (const field of model.fields) {
      if (field.type !== "Patient") continue;
      if (!field.relationFromFields?.length) continue; // el lado inverso, no la FK
      out.push({
        model: model.name,
        onDelete: (field as { relationOnDelete?: string }).relationOnDelete as
          | PatientRelationModel["onDelete"]
          | undefined ?? null,
        required: field.isRequired,
        hasClinicId,
      });
    }
  }
  return out;
}

/**
 * Delegate de Prisma para un modelo del DMMF. Prisma expone cada modelo en
 * camelCase de su nombre (sólo baja la primera letra: `SRPSession` → `sRPSession`).
 * Devuelve null si no se puede resolver — el caller lo trata como bloqueo, no
 * como "no hay nada" (fallo cerrado).
 */
function countDelegate(model: string): { count: (args: unknown) => Promise<number> } | null {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  const delegate = (prisma as unknown as Record<string, unknown>)[key] as
    | { count?: unknown }
    | undefined;
  if (!delegate || typeof delegate.count !== "function") return null;
  return delegate as { count: (args: unknown) => Promise<number> };
}

/** Tope de concurrencia del proyecto para consultas en paralelo. */
const QUERY_CHUNK = 7;

async function countBlockingModels(
  blocking: BlockingModel[],
  patientId: string,
  clinicId: string,
): Promise<Array<{ type: PatientDeleteBlockerType; count: number }>> {
  const results: Array<{ type: PatientDeleteBlockerType; count: number }> = [];

  for (let i = 0; i < blocking.length; i += QUERY_CHUNK) {
    const chunk = blocking.slice(i, i + QUERY_CHUNK);
    const counts = await Promise.all(
      chunk.map(async (entry) => {
        const delegate = countDelegate(entry.model);
        if (!delegate) {
          // El modelo existe en el schema pero el cliente no lo expone con el
          // nombre esperado (cliente Prisma desfasado tras un deploy, o un
          // nombre que no sigue la convención). No se puede saber si hay filas
          // → se asume que SÍ. Preferimos un borrado bloqueado de más a una
          // pérdida de expediente.
          console.error(
            `[patient-deletion] sin delegate de Prisma para "${entry.model}": se bloquea por precaución`,
          );
          return 1;
        }
        // El scope de clínica sólo se aplica donde la tabla lo tiene. Las que no
        // (odontograma, consentimiento de implante…) cuelgan del paciente, que el
        // caller ya validó que pertenece a esta clínica.
        return delegate.count({
          where: { patientId, ...(entry.hasClinicId ? { clinicId } : {}) },
        });
      }),
    );
    chunk.forEach((entry, idx) => results.push({ type: entry.type, count: counts[idx] }));
  }

  return results;
}

/**
 * Devuelve los motivos que BLOQUEAN el borrado definitivo. Array vacío = se
 * puede borrar.
 *
 * Dos caminos que se suman:
 *
 * A) FISCAL / CONTABLE — facturas, pagos y CFDI. A nivel schema Invoice→Patient
 *    es `Cascade`, así que la BD los borraría EN SILENCIO: el bloqueo es de
 *    negocio, no técnico. Un CFDI timbrado ante el SAT no se puede desaparecer
 *    (conservación NOM-024 + cuadre contable), y `CfdiRecord` ni siquiera cuelga
 *    del paciente — apunta a la factura por `invoiceId` SIN relación Prisma, así
 *    que borrar dejaría el timbre huérfano apuntando a la nada.
 *    Con UNA excepción: las facturas CANCELADAS no cuentan como bloqueo. Una
 *    factura anulada no es dinero ni obligación. Sus pagos y su timbre SÍ se
 *    siguen revisando (ver el comentario de `activeInvoices`).
 *
 * B) TODO LO DEMÁS que cuelgue del paciente con `Cascade` o `Restrict` y no esté
 *    en la allowlist de la política. Aquí entran el expediente (NOM-024 obliga a
 *    conservarlo 5 años), las especialidades completas —Ortodoncia, Pediatría,
 *    Periodoncia, Endodoncia, Implantes— y el dinero del paciente
 *    (`PatientCredit`, paquetes prepagados). El borrado duro queda SOLO para
 *    fichas vacías: altas por error y duplicados sin uso.
 */
export async function getPatientDeleteBlockers(
  patientId: string,
  clinicId: string,
): Promise<PatientDeleteBlocker[]> {
  // ── A) Facturación ──────────────────────────────────────────────────────
  // Se traen TODAS (canceladas incluidas), no se cuentan: sus ids son la llave
  // para llegar a pagos y timbres, que no tienen patientId propio. El filtro por
  // status va DESPUÉS y solo sobre el blocker de facturas — ver abajo.
  const invoices = await prisma.invoice.findMany({
    where: { patientId, clinicId },
    select: { id: true, cfdiUuid: true, status: true },
  });
  const invoiceIds = invoices.map((i) => i.id);

  // Una factura CANCELLED está anulada: no es dinero ni obligación de cobro, así
  // que NO debe bloquear el borrado. Ojo con el matiz: el filtro se aplica aquí,
  // sobre el conteo del blocker, y NO en el `findMany` de arriba. Si las
  // canceladas se excluyeran de la query se perderían sus `invoiceIds` y
  // dejaríamos de detectar sus pagos y —sobre todo— sus timbres: un CFDI
  // timbrado ante el SAT y cancelado después SIGUE siendo un documento fiscal
  // que hay que conservar (NOM-024/SAT) y SIGUE bloqueando.
  // Reembolsada ≠ cancelada: un reembolso vive como Payment con method="refund"
  // sobre una factura que sigue activa, y esa sí cuenta.
  const activeInvoices = invoices.filter((i) => i.status !== "CANCELLED");

  const [payments, cfdiRows] = await Promise.all([
    // Payment cuelga de Invoice (sin clinicId propio): el scope de clínica
    // llega heredado por invoiceIds, que ya salió filtrado.
    invoiceIds.length
      ? prisma.payment.count({ where: { invoiceId: { in: invoiceIds } } })
      : Promise.resolve(0),
    invoiceIds.length
      ? prisma.cfdiRecord.count({ where: { clinicId, invoiceId: { in: invoiceIds } } })
      : Promise.resolve(0),
  ]);

  // Timbres: las filas reales de cfdi_records y, como respaldo, las facturas
  // que quedaron marcadas con cfdiUuid (timbrados viejos sin fila propia).
  // Sobre `invoices` (todas), NO sobre `activeInvoices`: el timbre de una
  // factura cancelada es justamente el caso que hay que seguir conservando.
  const stampedInvoices = invoices.filter((i) => i.cfdiUuid).length;

  // ── B) Todo lo que la política no deja cascadear ────────────────────────
  const { blocking } = classifyPatientRelations(patientRelationsFromDmmf());
  const counted = await countBlockingModels(blocking, patientId, clinicId);

  // ── C) Dinero que cuelga de algo permitido ──────────────────────────────
  // El punto ciego de enumerar sólo relaciones DIRECTAS a Patient: la
  // mensualidad cobrada (`PlanPayment`) cuelga del plan de pagos, que sí puede
  // cascadear. Ver TRANSITIVE_MONEY para el porqué de contarla a mano.
  const planPayments = await prisma.planPayment.count({
    where: { plan: { patientId, clinicId }, paidAt: { not: null } },
  });

  return summarizeBlockers([
    { type: "invoices", count: activeInvoices.length },
    { type: "payments", count: payments },
    { type: "cfdi", count: Math.max(cfdiRows, stampedInvoices) },
    { type: "credit", count: planPayments },
    ...counted,
  ]);
}
