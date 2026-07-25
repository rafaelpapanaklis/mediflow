// Precheck del borrado DEFINITIVO de un paciente (DELETE ?mode=hard).
//
// Archivar (status ARCHIVED) siempre se puede. Borrar de verdad NO: `patientId`
// cuelga de ~200 relaciones y un DELETE arrastraría en cascada expediente,
// radiografías, facturas y consentimientos. Este módulo decide si el paciente
// es borrable y, si no, POR QUÉ — en tipos que la UI traduce a lenguaje humano
// (nunca nombres de tabla).

import { prisma } from "@/lib/prisma";

export type PatientDeleteBlockerType =
  | "invoices"
  | "payments"
  | "cfdi"
  | "endodontics"
  | "implants"
  // Comodín para un fallo de FK que este precheck no anticipó (carrera, o una
  // relación Restrict nueva). Lo emite el handler desde el catch, no esta función.
  | "related";

export interface PatientDeleteBlocker {
  type: PatientDeleteBlockerType;
  count: number;
}

/**
 * Devuelve los motivos que BLOQUEAN el borrado definitivo. Array vacío = se
 * puede borrar.
 *
 * Dos familias de bloqueo, por razones distintas:
 *
 * 1) FISCAL / CONTABLE — facturas, pagos y CFDI. A nivel schema Invoice→Patient
 *    es `Cascade`, así que la BD los borraría EN SILENCIO: el bloqueo es de
 *    negocio, no técnico. Un CFDI timbrado ante el SAT no se puede desaparecer
 *    (conservación NOM-024 + cuadre contable), y `CfdiRecord` ni siquiera cuelga
 *    del paciente — apunta a la factura por `invoiceId` SIN relación Prisma, así
 *    que borrar dejaría el timbre huérfano apuntando a la nada.
 *
 * 2) CLÍNICO CON `Restrict` — las 5 tablas de endodoncia/implantes declaran
 *    `onDelete: Restrict`, o sea que la BD ya rechaza el DELETE por su cuenta.
 *    Se cuentan ANTES para poder explicarlo en español en vez de reventar con
 *    un error de foreign key.
 *
 * Multi-tenant: `clinicId` lo pone SIEMPRE el caller desde la sesión.
 */
export async function getPatientDeleteBlockers(
  patientId: string,
  clinicId: string,
): Promise<PatientDeleteBlocker[]> {
  // Las facturas se traen (no se cuentan) porque sus ids son la llave para
  // llegar a pagos y timbres, que no tienen patientId propio.
  const invoices = await prisma.invoice.findMany({
    where: { patientId, clinicId },
    select: { id: true, cfdiUuid: true },
  });
  const invoiceIds = invoices.map((i) => i.id);

  const [payments, cfdiRows, endoDiagnoses, vitalityTests, endoTreatments, implants, implantConsents] =
    await Promise.all([
      // Payment cuelga de Invoice (sin clinicId propio): el scope de clínica
      // llega heredado por invoiceIds, que ya salió filtrado.
      invoiceIds.length
        ? prisma.payment.count({ where: { invoiceId: { in: invoiceIds } } })
        : Promise.resolve(0),
      invoiceIds.length
        ? prisma.cfdiRecord.count({ where: { clinicId, invoiceId: { in: invoiceIds } } })
        : Promise.resolve(0),
      prisma.endodonticDiagnosis.count({ where: { patientId, clinicId } }),
      prisma.vitalityTest.count({ where: { patientId, clinicId } }),
      prisma.endodonticTreatment.count({ where: { patientId, clinicId } }),
      prisma.implant.count({ where: { patientId, clinicId } }),
      // ImplantConsent no tiene clinicId propio — cuelga del paciente, que el
      // caller ya validó que pertenece a esta clínica.
      prisma.implantConsent.count({ where: { patientId } }),
    ]);

  // Timbres: las filas reales de cfdi_records y, como respaldo, las facturas
  // que quedaron marcadas con cfdiUuid (timbrados viejos sin fila propia).
  const stampedInvoices = invoices.filter((i) => i.cfdiUuid).length;
  const cfdi = Math.max(cfdiRows, stampedInvoices);

  const endodontics = endoDiagnoses + vitalityTests + endoTreatments;
  const implantRecords = implants + implantConsents;

  const blockers: PatientDeleteBlocker[] = [];
  if (invoices.length) blockers.push({ type: "invoices",   count: invoices.length });
  if (payments)        blockers.push({ type: "payments",   count: payments });
  if (cfdi)            blockers.push({ type: "cfdi",       count: cfdi });
  if (endodontics)     blockers.push({ type: "endodontics", count: endodontics });
  if (implantRecords)  blockers.push({ type: "implants",   count: implantRecords });
  return blockers;
}
