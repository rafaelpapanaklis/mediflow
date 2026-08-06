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
  | "clinical"
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
 * Tres familias de bloqueo, por razones distintas:
 *
 * 1) FISCAL / CONTABLE — facturas, pagos y CFDI. A nivel schema Invoice→Patient
 *    es `Cascade`, así que la BD los borraría EN SILENCIO: el bloqueo es de
 *    negocio, no técnico. Un CFDI timbrado ante el SAT no se puede desaparecer
 *    (conservación NOM-024 + cuadre contable), y `CfdiRecord` ni siquiera cuelga
 *    del paciente — apunta a la factura por `invoiceId` SIN relación Prisma, así
 *    que borrar dejaría el timbre huérfano apuntando a la nada.
 *    Con UNA excepción: las facturas CANCELADAS no cuentan como bloqueo. Una
 *    factura anulada no es dinero ni obligación. Sus pagos y su timbre SÍ se
 *    siguen revisando (ver el comentario de `activeInvoices`).
 *
 * 2) HISTORIA CLÍNICA con `Cascade` — notas SOAP, recetas, consentimientos,
 *    archivos/radiografías, análisis IA y odontograma. La BD los borraría en
 *    silencio (son `Cascade`), pero la NOM-024 obliga a conservar el expediente
 *    5 años: si existe CUALQUIER dato clínico el borrado definitivo se bloquea
 *    y el camino es ARCHIVAR. Antes este precheck solo miraba facturación y un
 *    paciente que pagó en efectivo pasaba como `deletable:true` con 20 notas
 *    firmadas — pérdida irreversible (P0-1 auditoría 2026-08-06). El borrado
 *    duro queda SOLO para fichas vacías (altas por error, duplicados sin uso).
 *
 * 3) CLÍNICO CON `Restrict` — las 5 tablas de endodoncia/implantes declaran
 *    `onDelete: Restrict`, o sea que la BD ya rechaza el DELETE por su cuenta.
 *    Se cuentan ANTES para poder explicarlo en español en vez de reventar con
 *    un error de foreign key.
 *
 * NO cuentan como bloqueo (decisión asumida, no olvido): citas, tratamientos,
 * presupuestos y planes de pago sin factura. Son datos operativos, no expediente
 * clínico; una ficha de prueba con una cita cancelada debe poder borrarse.
 *
 * Multi-tenant: `clinicId` lo pone SIEMPRE el caller desde la sesión.
 */
export async function getPatientDeleteBlockers(
  patientId: string,
  clinicId: string,
): Promise<PatientDeleteBlocker[]> {
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
      // Endodoncia/implantes: aquí NO se aplica el criterio de "ignorar
      // anulados" que sí vale para las facturas. Estas 5 tablas son `Restrict`:
      // la fila soft-borrada (deletedAt) o el implante REMOVED siguen existiendo
      // en la BD y Postgres rechaza el DELETE igual. Descontarlas daría un "sí
      // se puede borrar" falso que revienta después como FK y cae al bloqueo
      // genérico `related`, sin explicación útil. Se cuentan todas, a propósito.
      prisma.endodonticDiagnosis.count({ where: { patientId, clinicId } }),
      prisma.vitalityTest.count({ where: { patientId, clinicId } }),
      prisma.endodonticTreatment.count({ where: { patientId, clinicId } }),
      prisma.implant.count({ where: { patientId, clinicId } }),
      // ImplantConsent no tiene clinicId propio — cuelga del paciente, que el
      // caller ya validó que pertenece a esta clínica.
      prisma.implantConsent.count({ where: { patientId } }),
    ]);

  // HISTORIA CLÍNICA (familia 2). Promise.all aparte del anterior para respetar
  // el tope de 7 del proyecto. Aquí NO hay criterio de "ignorar anulados": una
  // nota, receta o radiografía existe o no existe, y con que exista una sola el
  // expediente debe conservarse (NOM-024).
  const [records, prescriptions, consents, files, xrayAnalyses, odontoEntries, odontoSnapshots] =
    await Promise.all([
      prisma.medicalRecord.count({ where: { patientId, clinicId } }),
      prisma.prescription.count({ where: { patientId, clinicId } }),
      prisma.consentForm.count({ where: { patientId, clinicId } }),
      prisma.patientFile.count({ where: { patientId, clinicId } }),
      prisma.xrayAnalysis.count({ where: { patientId, clinicId } }),
      // Odontograma: sin clinicId propio — cuelga del paciente, que el caller
      // ya validó que pertenece a esta clínica (igual que ImplantConsent).
      prisma.odontogramEntry.count({ where: { patientId } }),
      prisma.odontogramSnapshot.count({ where: { patientId } }),
    ]);
  const clinical =
    records + prescriptions + consents + files + xrayAnalyses + odontoEntries + odontoSnapshots;

  // Timbres: las filas reales de cfdi_records y, como respaldo, las facturas
  // que quedaron marcadas con cfdiUuid (timbrados viejos sin fila propia).
  // Sobre `invoices` (todas), NO sobre `activeInvoices`: el timbre de una
  // factura cancelada es justamente el caso que hay que seguir conservando.
  const stampedInvoices = invoices.filter((i) => i.cfdiUuid).length;
  const cfdi = Math.max(cfdiRows, stampedInvoices);

  const endodontics = endoDiagnoses + vitalityTests + endoTreatments;
  const implantRecords = implants + implantConsents;

  const blockers: PatientDeleteBlocker[] = [];
  if (activeInvoices.length) blockers.push({ type: "invoices", count: activeInvoices.length });
  if (payments)        blockers.push({ type: "payments",   count: payments });
  if (cfdi)            blockers.push({ type: "cfdi",       count: cfdi });
  if (clinical)        blockers.push({ type: "clinical",   count: clinical });
  if (endodontics)     blockers.push({ type: "endodontics", count: endodontics });
  if (implantRecords)  blockers.push({ type: "implants",   count: implantRecords });
  return blockers;
}
