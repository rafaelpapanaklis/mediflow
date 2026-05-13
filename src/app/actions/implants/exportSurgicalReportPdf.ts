"use server";
// Implants — exportSurgicalReportPdf. Spec §9.2.
//
// Action de DATOS: carga el implante + sus relaciones y registra audit
// log REPORT_SURGICAL_PDF. La generación física del PDF (con
// @react-pdf/renderer) vive en `src/lib/implants/pdf-templates/
// surgical-report.tsx` (Fase 7) y se llama desde un route handler que
// usa esta action para conseguir los datos.
//
// Retorna los datos suficientes para que el componente PDF arme el
// reporte completo. Esto evita ejecutar @react-pdf/renderer en el
// flujo de mutación y permite revalidar en el lado correcto.

import { prisma } from "@/lib/prisma";
import {
  exportSurgicalReportSchema,
  type ExportSurgicalReportInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export type SurgicalReportData = {
  implantId: string;
  toothFdi: number;
  brand: string;
  brandCustomName: string | null;
  modelName: string;
  diameterMm: unknown; // Decimal — tipado por Prisma
  lengthMm: unknown;
  lotNumber: string;
  manufactureDate: Date | null;
  expiryDate: Date | null;
  placedAt: Date;
  protocol: string;
  patient: { id: string; firstName: string; lastName: string };
  doctor: {
    id: string;
    firstName: string;
    lastName: string;
    cedulaProfesional: string | null;
  };
  clinic: { id: string; name: string; phone: string | null };
  surgical: {
    performedAt: Date;
    asaClassification: string;
    insertionTorqueNcm: number;
    isqMesiodistal: number;
    isqVestibulolingual: number;
    boneDensity: string;
    flapType: string;
    drillingProtocol: string;
    healingAbutmentLot: string | null;
    sutureMaterial: string | null;
    durationMinutes: number;
    complications: string | null;
    postOpInstructions: string | null;
  } | null;
};

export async function exportSurgicalReportPdf(
  input: ExportSurgicalReportInput,
): Promise<ActionResult<SurgicalReportData>> {
  const parsed = exportSurgicalReportSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctxRes = await getImplantActionContext({ write: false });
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const implantBaseRes = await loadImplantForCtx({
    ctx,
    implantId: parsed.data.implantId,
  });
  if (isFailure(implantBaseRes)) return implantBaseRes;

  const implant = await prisma.implant.findUnique({
    where: { id: parsed.data.implantId },
    include: {
      surgicalRecord: true,
      patient: { select: { id: true, firstName: true, lastName: true } },
      placedByDoctor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          cedulaProfesional: true,
        },
      },
      clinic: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!implant) return fail("Implante no encontrado");

  await auditImplant({
    ctx,
    action: IMPLANT_AUDIT_ACTIONS.REPORT_SURGICAL_PDF,
    entityType: "implant",
    entityId: implant.id,
  });

  return ok({
    implantId: implant.id,
    toothFdi: implant.toothFdi,
    brand: implant.brand,
    brandCustomName: implant.brandCustomName,
    modelName: implant.modelName,
    diameterMm: implant.diameterMm,
    lengthMm: implant.lengthMm,
    lotNumber: implant.lotNumber,
    manufactureDate: implant.manufactureDate,
    expiryDate: implant.expiryDate,
    placedAt: implant.placedAt,
    protocol: implant.protocol,
    patient: implant.patient,
    doctor: implant.placedByDoctor,
    clinic: implant.clinic,
    surgical: implant.surgicalRecord
      ? {
          performedAt: implant.surgicalRecord.performedAt,
          asaClassification: implant.surgicalRecord.asaClassification,
          insertionTorqueNcm: implant.surgicalRecord.insertionTorqueNcm,
          isqMesiodistal: implant.surgicalRecord.isqMesiodistal,
          isqVestibulolingual: implant.surgicalRecord.isqVestibulolingual,
          boneDensity: implant.surgicalRecord.boneDensity,
          flapType: implant.surgicalRecord.flapType,
          drillingProtocol: implant.surgicalRecord.drillingProtocol,
          healingAbutmentLot: implant.surgicalRecord.healingAbutmentLot,
          sutureMaterial: implant.surgicalRecord.sutureMaterial,
          durationMinutes: implant.surgicalRecord.durationMinutes,
          complications: implant.surgicalRecord.complications,
          postOpInstructions: implant.surgicalRecord.postOpInstructions,
        }
      : null,
  });
}
