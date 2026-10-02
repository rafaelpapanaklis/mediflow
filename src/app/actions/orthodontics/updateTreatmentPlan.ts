"use server";
// Orthodontics — action 4/15: updateTreatmentPlan. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { updateTreatmentPlanSchema } from "@/lib/validation/orthodontics";
import { aplicarEfectosDeEstado } from "@/lib/orthodontics/efectos-estado-caso";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import { auditOrtho, getOrthoPlanActionContext } from "./_helpers";
import { validarPersonasDelCaso } from "@/lib/orthodontics/validar-personas-del-caso-db";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { cargarNombreDeTecnica, guardarNombreDeTecnicaDelCaso } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { fijarPrecioControlSegunTecnica } from "@/lib/orthodontics/precio-control-del-caso-db";
import { cambioLaTecnica } from "@/lib/orthodontics/precio-control-del-caso";
import { controlesConOtroDoctor } from "@/lib/orthodontics/controles-con-otro-doctor-db";
import { avisoDePrecioDesfasado } from "@/lib/orthodontics/cobro/precio-desfasado";

// Ola 1 (ws1-t6) — columnas de sql/ortodoncia-alta-caso.sql (A5/A11): si el
// update las toca y aún no existen (P2021/P2022), reintenta sin ellas.
const ALTA_CASO_PLAN_FIELDS = ["treatingDoctorId", "responsibleGuardianId"] as const;

export async function updateTreatmentPlan(
  input: unknown,
): Promise<ActionResult<{ id: string; altaCasoFieldsSaved: boolean; controlesConOtroDoctor: number; avisoPrecioDesfasado?: string }>> {
  // A11 (revisión cruzada): si el payload SOLO trae treatmentPlanId +
  // responsibleGuardianId/newResponsibleGuardian, acepta billing.* además de
  // medicalRecord.edit — recepción arma/cambia quién paga sin necesitar el
  // permiso clínico. Cualquier otro campo (status, técnica…) sigue exigiendo
  // medicalRecord.edit completo, como antes.
  const auth = await getOrthoPlanActionContext(input);
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = updateTreatmentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const before = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
  });
  if (!before) return fail("Plan no encontrado");

  // X1: un doctor tratante o responsable de pago NUEVO tiene que ser de esta
  // clínica; repetir el que ya tenía no se vuelve a comprobar.
  const personaAjena = await validarPersonasDelCaso({
    clinicId: ctx.clinicId,
    patientId: before.patientId,
    pedidas: {
      treatingDoctorId: parsed.data.treatingDoctorId,
      responsibleGuardianId: parsed.data.responsibleGuardianId,
    },
    actuales: {
      treatingDoctorId: before.treatingDoctorId,
      responsibleGuardianId: before.responsibleGuardianId,
    },
  });
  if (personaAjena) return fail(personaAjena);

  // Validación específica: si status pasa a DROPPED_OUT, exige droppedOutReason.
  if (parsed.data.status === "DROPPED_OUT") {
    if (!parsed.data.droppedOutReason || parsed.data.droppedOutReason.length < 20) {
      return fail("DROPPED_OUT requiere droppedOutReason ≥20 caracteres");
    }
  }

  // `techniqueLabel` no es columna de Prisma (va por SQL crudo, ws1-t10): se saca de `rest`.
  const { treatmentPlanId, diagnosisId, patientId, newResponsibleGuardian, techniqueLabel, ...rest } = parsed.data;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) data[key] = value;
  }
  // `installedAt`/`startDate` viajan como string ISO (schema `.datetime()`);
  // Prisma exige `Date` en `update()`. Nadie más había llamado a este action
  // con estos dos campos todavía (F7 sin construir) — el bug no se había
  // topado. A6 es la primera llamadora real de `installedAt` aquí.
  if (typeof data.installedAt === "string") data.installedAt = new Date(data.installedAt);
  if (typeof data.startDate === "string") data.startDate = new Date(data.startDate);
  if (parsed.data.status === "DROPPED_OUT" && !data.droppedOutAt) {
    data.droppedOutAt = new Date();
  }
  if (parsed.data.status && parsed.data.status !== before.status) {
    data.statusUpdatedAt = new Date();
  }
  // A6 · si se pone/cambia la fecha de colocación y el caso seguía como
  // PLANNED (sin que este mismo update toque `status` a mano), el caso
  // arranca: sin esto, "sin empezar" se quedaba así para siempre en
  // cualquier caso que no puso la fecha al crearlo (hallazgo del alcance).
  if (
    data.installedAt instanceof Date &&
    !parsed.data.status &&
    before.status === "PLANNED"
  ) {
    data.status = "IN_PROGRESS";
    data.statusUpdatedAt = new Date();
  }

  try {
    let altaCasoFieldsSaved = true;
    const updated = await prisma
      .$transaction(async (tx) => {
        const finalData = { ...data };
        if (newResponsibleGuardian && !finalData.responsibleGuardianId) {
          const guardian = await tx.guardian.create({
            data: {
              clinicId: ctx.clinicId,
              patientId: before.patientId,
              fullName: newResponsibleGuardian.fullName,
              parentesco: newResponsibleGuardian.parentesco,
              phone: newResponsibleGuardian.phone,
              esResponsableLegal: true,
              principal: true,
              createdBy: ctx.userId,
            },
            select: { id: true },
          });
          finalData.responsibleGuardianId = guardian.id;
        }
        return tx.orthodonticTreatmentPlan.update({ where: { id: treatmentPlanId }, data: finalData });
      })
      .catch(async (e) => {
        const touchesAltaCaso =
          ALTA_CASO_PLAN_FIELDS.some((k) => k in data) || Boolean(newResponsibleGuardian);
        if (!touchesAltaCaso || !isMissingColumnError(e)) throw e;
        altaCasoFieldsSaved = false;
        const reduced = { ...data };
        for (const k of ALTA_CASO_PLAN_FIELDS) delete reduced[k];
        console.error(
          "[ortho] updateTreatmentPlan: columnas de alta-caso.sql aún no existen, se guarda sin doctor/responsable:",
          e,
        );
        return prisma.orthodonticTreatmentPlan.update({ where: { id: treatmentPlanId }, data: reduced });
      });

    // ws1-t10: el nombre propio de la técnica. Si se manda, se guarda; si cambia el tipo base sin
    // mandar nombre, el anterior ya no corresponde y se limpia (se muestra el del tipo base).
    // ws1-t12 (6b): el nombre ANTES de tocarlo, para saber si la técnica cambió de verdad.
    const tocaTecnica = techniqueLabel !== undefined || (parsed.data.technique !== undefined && parsed.data.technique !== before.technique);
    const nombreAntes = tocaTecnica ? await cargarNombreDeTecnica(ctx.clinicId, updated.id) : null;
    if (techniqueLabel !== undefined) {
      await guardarNombreDeTecnicaDelCaso(ctx.clinicId, updated.id, techniqueLabel);
    } else if (parsed.data.technique !== undefined && parsed.data.technique !== before.technique) {
      await guardarNombreDeTecnicaDelCaso(ctx.clinicId, updated.id, null);
    }
    // ws1-t12 (6b): con OTRA técnica, los próximos controles («Pago por control») se cobran con el precio por
    // control de la nueva (o con el del catálogo si no tiene). Los ya facturados no se tocan. Sin lanzar.
    let precioControl: { antes: number | null; despues: number | null } | null = null;
    if (tocaTecnica) {
      const baseNueva = parsed.data.technique ?? before.technique;
      const labelNuevo = techniqueLabel !== undefined ? techniqueLabel : null;
      if (cambioLaTecnica({ base: before.technique, label: nombreAntes }, { base: baseNueva, label: labelNuevo })) {
        const r = await fijarPrecioControlSegunTecnica({ clinicId: ctx.clinicId, planId: updated.id, base: baseNueva, label: labelNuevo });
        if (r.cambio) precioControl = { antes: r.antes, despues: r.despues };
      }
    }

    // H46: el estado arrastra a la fase (y al régimen de retención). Es
    // secundario: si falla, el cambio de estado ya quedó guardado.
    if (updated.status !== before.status) {
      try {
        await prisma.$transaction(async (tx) => {
          await aplicarEfectosDeEstado(tx, { id: updated.id, clinicId: ctx.clinicId }, updated.status);
        });
      } catch (e) {
        console.error("[ortho] updateTreatmentPlan: efectos del estado no aplicados:", e);
      }
    }

    const action =
      parsed.data.status && parsed.data.status !== before.status
        ? ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_STATUS_CHANGED
        : ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED;

    await auditOrtho({
      ctx,
      action,
      entityType: "OrthodonticTreatmentPlan",
      entityId: updated.id,
      patientId: before.patientId,
      // `treatingDoctorId` va a la bitácora para que una reasignación deje
      // dicho quién llevaba el caso y desde cuándo: de ahí sale a qué doctor se
      // le atribuye cada cobro (produccion.ts). `undefined` si la columna de
      // sql/ortodoncia-alta-caso.sql aún no existe: `auditOrtho` lo ignora.
      before: {
        status: before.status,
        totalCostMxn: before.totalCostMxn.toString(),
        treatingDoctorId: (before as { treatingDoctorId?: string | null }).treatingDoctorId ?? null,
        ...(precioControl ? { precioPorControl: precioControl.antes } : {}),
      },
      after: {
        status: updated.status,
        totalCostMxn: updated.totalCostMxn.toString(),
        treatingDoctorId: (updated as { treatingDoctorId?: string | null }).treatingDoctorId ?? null,
        ...(precioControl ? { precioPorControl: precioControl.despues } : {}),
      },
    });

    revalidatePath(`/dashboard/patients/${updated.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${updated.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);
    void diagnosisId;
    void patientId;
    // F «Cambio de doctor»: si se reasignó el doctor, ¿cuántos controles futuros
    // se quedaron agendados con el anterior? La ficha ofrece pasarlos. Es solo
    // aviso: si la consulta falla, el guardado ya quedó y no se dice nada.
    let controlesFuturosConOtroDoctor = 0;
    const doctorNuevo = (updated as { treatingDoctorId?: string | null }).treatingDoctorId ?? null;
    const doctorAnterior = (before as { treatingDoctorId?: string | null }).treatingDoctorId ?? null;
    if (doctorNuevo && doctorNuevo !== doctorAnterior) {
      controlesFuturosConOtroDoctor = await controlesConOtroDoctor({
        clinicId: ctx.clinicId,
        patientId: updated.patientId,
        treatingDoctorId: doctorNuevo,
      }).then((l) => l.length).catch(() => 0);
    }
    // F «Cambio de técnica o de precio»: si el precio de referencia del caso ya no
    // cuadra con la factura del tratamiento, se avisa (no se toca la factura).
    let avisoPrecioDesfasado: string | undefined;
    const facturaDelCaso = (updated as { invoiceId?: string | null }).invoiceId ?? null;
    if (facturaDelCaso && (parsed.data.totalCostMxn !== undefined || parsed.data.technique !== undefined)) {
      try {
        const inv = await prisma.invoice.findFirst({
          where: { id: facturaDelCaso, clinicId: ctx.clinicId },
          select: { total: true, status: true },
        });
        if (inv && inv.status !== "CANCELLED") {
          avisoPrecioDesfasado = avisoDePrecioDesfasado({
            totalFactura: inv.total,
            precioDelCaso: Number(updated.totalCostMxn),
            cambioTecnica: parsed.data.technique !== undefined && parsed.data.technique !== before.technique,
          });
        }
      } catch (e) {
        console.warn("[ortho] updateTreatmentPlan: no se pudo comparar el precio con la factura:", e);
      }
    }
    return ok({ id: updated.id, altaCasoFieldsSaved, controlesConOtroDoctor: controlesFuturosConOtroDoctor, ...(avisoPrecioDesfasado ? { avisoPrecioDesfasado } : {}) });
  } catch (e) {
    console.error("[ortho] updateTreatmentPlan failed:", e);
    return fail("No se pudo actualizar el plan");
  }
}
