"use server";
// Orthodontics — action 3/15: createTreatmentPlan + 6 phases en transacción. SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createTreatmentPlanSchema } from "@/lib/validation/orthodontics";
import { PHASE_ORDER } from "@/lib/orthodontics/phase-machine";
import { enqueueOrthoWhatsApp } from "@/lib/orthodontics/whatsapp-queue";
import { isMissingColumnError } from "@/lib/orthodontics/alta-caso-tolerance";
import { loadOrthoClinicSettings } from "@/lib/orthodontics/clinic-settings-db";
import { guardarModoDeCobroDelCaso } from "@/lib/orthodontics/billing-mode-db";
import { guardarNombreDeTecnicaDelCaso } from "@/lib/orthodontics/tecnicas-de-la-clinica-db";
import { aplicarPlanDetalle } from "@/lib/orthodontics/plan-detalle-guardar";
import { leerOpcionesDelPlan } from "@/lib/orthodontics/plan-detalle-db";
import { controlesSugeridos, validarContraOpciones, validarPlanDetalle, type PlanDetalle } from "@/lib/orthodontics/plan-detalle";
import { buscarPrecioControlOrto, precioDeColocacionDelCatalogo } from "@/lib/orthodontics/catalog-procedures";
import { costoParaGuardarPorControl, esViolacionDelCheckDelPlan, estimarCostoPorControl } from "@/lib/orthodontics/check-del-caso";
import {
  auditOrtho,
  getOrthoPlanActionContext,
  loadPatientForOrtho,
} from "./_helpers";
import { validarPersonasDelCaso } from "@/lib/orthodontics/validar-personas-del-caso-db";
import { existeColumnaDoctorTratante } from "@/lib/orthodontics/doctores-tratantes-db";
import { motivoFaltaDoctor } from "@/lib/orthodontics/doctores-tratantes";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { conMovimientosSoloDeBitacora, conUnSoloMovimiento, esPasoDeOtraAccion } from "@/lib/movimientos-paciente/una-accion";
import { fail, isFailure, ok, type ActionResult } from "./result";

type ResultadoDelPlan = ActionResult<{ id: string; altaCasoFieldsSaved: boolean; avisoPlanDetalle?: string; avisoCosto?: string }>;

export async function createTreatmentPlan(input: unknown): Promise<ResultadoDelPlan> {
  // Abrir el caso A PLAZOS sigue con `crearPlanDelCaso` (el plan de pago): el resumen de toda la apertura lo escribe esa
  // última llamada (`aperturaDelCaso`), y estas filas quedan solo en la bitácora.
  if (input && typeof input === "object" && (input as { sigueElPlanDePago?: unknown }).sigueElPlanDePago === true) {
    return conMovimientosSoloDeBitacora(() => crearPlanDeTratamiento(input));
  }
  // Abrir el caso = UNA fila en Movimientos con todo el detalle: el diagnóstico (llamadas anteriores, marcadas
  // `parteDeUnaAccion`), el plan y su detalle. Las filas sueltas quedan en la bitácora (una-accion.ts).
  return conUnSoloMovimiento(
    {
      titulo: "Abrió el caso de ortodoncia",
      detallesExtra: esPasoDeOtraAccion(input) ? ["Registró el diagnóstico de ortodoncia"] : [],
    },
    () => crearPlanDeTratamiento(input),
  );
}

async function crearPlanDeTratamiento(input: unknown): Promise<ResultadoDelPlan> {
  // A11 (revisión cruzada): en la práctica crear un plan siempre trae campos
  // clínicos obligatorios (técnica, costo, anclaje…), así que este gate no
  // se relaja de verdad aquí — se usa el mismo helper que updateTreatmentPlan
  // por consistencia, no porque hoy cambie el resultado.
  const auth = await getOrthoPlanActionContext(input);
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createTreatmentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForOrtho({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  // Validar que el diagnóstico exista y no esté tomado por otro plan.
  const dx = await prisma.orthodonticDiagnosis.findFirst({
    where: { id: parsed.data.diagnosisId, clinicId: ctx.clinicId, deletedAt: null },
    include: { treatmentPlan: { select: { id: true } } },
  });
  if (!dx) return fail("Diagnóstico no encontrado");
  if (dx.treatmentPlan)
    return fail("Ya existe un plan para este diagnóstico", dx.treatmentPlan.id);

  // ws1-t10: un caso nuevo no se abre sin doctor tratante (ya no hay «doctor
  // por defecto» que lo supla). La columna se comprueba solo si falta el
  // doctor, para no gastar una consulta en el camino normal.
  if (!parsed.data.treatingDoctorId) {
    const sinDoctor = motivoFaltaDoctor({
      treatingDoctorId: parsed.data.treatingDoctorId,
      columnaExiste: await existeColumnaDoctorTratante(),
    });
    if (sinDoctor) return fail(sinDoctor);
  }

  // X1: el doctor tratante y el responsable de pago tienen que ser de ESTA
  // clínica (el id llega del cliente).
  const personaAjena = await validarPersonasDelCaso({
    clinicId: ctx.clinicId,
    patientId: parsed.data.patientId,
    pedidas: {
      treatingDoctorId: parsed.data.treatingDoctorId,
      responsibleGuardianId: parsed.data.responsibleGuardianId,
    },
  });
  if (personaAjena) return fail(personaAjena);

  const installedAt = parsed.data.installedAt ? new Date(parsed.data.installedAt) : null;
  // ws1-t10 — lo que se guarda en `totalCostMxn`: lo escrito, salvo que «Pago por control» no traiga costo (abajo).
  let costoDelCaso = parsed.data.totalCostMxn;
  let avisoCosto: string | undefined;

  // ws1-t12 — el «Plan de tratamiento» completo, opcional al abrir el caso. Lo que se puede comprobar de
  // antemano (forma, rangos, que la clínica aún ofrezca lo que se eligió) se rechaza AQUÍ, antes de crear nada:
  // un dato que no sirve no se pierde en silencio. Guardarlo (columna por SQL) va después, en su propio paso.
  let planCompleto: PlanDetalle | null = null;
  if (parsed.data.planDetalle) {
    const v = validarPlanDetalle(parsed.data.planDetalle);
    if (v.ok === false) return fail(v.error);
    const fuera = validarContraOpciones(v.plan, null, (await leerOpcionesDelPlan(ctx.clinicId)).opciones);
    if (fuera) return fail(fuera);
    planCompleto = v.plan;
  }

  // Ola 1 (ws1-t6) — A5 (doctor tratante) ya trae su columna de la Ola 0.
  // A11 (responsable del pago): un Guardian existente, o se crea uno nuevo
  // reutilizando el modelo de pediatría (sin exigir PediatricRecord). Ambas
  // columnas nuevas — si sql/ortodoncia-alta-caso.sql aún no está pegado,
  // se reintenta la transacción completa sin ellas (P2021/P2022): el caso
  // se abre igual, sin doctor/responsable, para no tumbar dev.108.
  const withAltaCasoFields = {
    treatingDoctorId: parsed.data.treatingDoctorId ?? null,
    responsibleGuardianId: parsed.data.responsibleGuardianId ?? null,
  };
  const wantsAltaCasoFields =
    withAltaCasoFields.treatingDoctorId != null ||
    withAltaCasoFields.responsibleGuardianId != null ||
    Boolean(parsed.data.newResponsibleGuardian);

  const runTransaction = (includeAltaCasoFields: boolean) =>
    prisma.$transaction(async (tx) => {
      let responsibleGuardianId = withAltaCasoFields.responsibleGuardianId;
      if (includeAltaCasoFields && !responsibleGuardianId && parsed.data.newResponsibleGuardian) {
        const g = parsed.data.newResponsibleGuardian;
        const guardian = await tx.guardian.create({
          data: {
            clinicId: ctx.clinicId,
            patientId: parsed.data.patientId,
            fullName: g.fullName,
            parentesco: g.parentesco,
            phone: g.phone,
            esResponsableLegal: true,
            principal: true,
            createdBy: ctx.userId,
          },
          select: { id: true },
        });
        responsibleGuardianId = guardian.id;
      }

      const plan = await tx.orthodonticTreatmentPlan.create({
        data: {
          diagnosisId: parsed.data.diagnosisId,
          patientId: parsed.data.patientId,
          clinicId: ctx.clinicId,
          technique: parsed.data.technique,
          techniqueNotes: parsed.data.techniqueNotes ?? null,
          estimatedDurationMonths: parsed.data.estimatedDurationMonths,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
          installedAt,
          totalCostMxn: costoDelCaso,
          anchorageType: parsed.data.anchorageType,
          anchorageNotes: parsed.data.anchorageNotes ?? null,
          extractionsRequired: parsed.data.extractionsRequired,
          extractionsTeethFdi: parsed.data.extractionsTeethFdi,
          iprRequired: parsed.data.iprRequired,
          tadsRequired: parsed.data.tadsRequired,
          treatmentObjectives: parsed.data.treatmentObjectives,
          patientGoals: parsed.data.patientGoals ?? null,
          retentionPlanText: parsed.data.retentionPlanText,
          status: installedAt ? "IN_PROGRESS" : "PLANNED",
          signedTreatmentConsentFileId: parsed.data.signedTreatmentConsentFileId ?? null,
          ...(includeAltaCasoFields
            ? {
                treatingDoctorId: withAltaCasoFields.treatingDoctorId,
                responsibleGuardianId,
              }
            : {}),
        },
      });

      // 6 fases con orderIndex 0..5. Si hay installedAt, ALIGNMENT arranca.
      for (let i = 0; i < PHASE_ORDER.length; i++) {
        const phaseKey = PHASE_ORDER[i]!;
        const isFirst = i === 0;
        await tx.orthodonticPhase.create({
          data: {
            treatmentPlanId: plan.id,
            clinicId: ctx.clinicId,
            phaseKey,
            orderIndex: i,
            status: isFirst && installedAt ? "IN_PROGRESS" : "NOT_STARTED",
            startedAt: isFirst && installedAt ? installedAt : null,
          },
        });
      }

      return plan;
    });

  // Ola 2 (ws1-t1) — modo de cobro con el que nace el caso: el default de
  // HOY de la clínica (`OrthodonticsClinicSettings.billingMode`). Se lee
  // ANTES de la transacción, sola: si `loadOrthoClinicSettings` no
  // encuentra fila/tabla ya devuelve el default (PRECIO_TOTAL) — nunca
  // lanza. `defaults(clinicId)` si la clínica jamás guardó Configuración
  // también cae en PRECIO_TOTAL, que es el comportamiento de siempre.
  //
  // Fila 32 (ws1-t4 ronda 6, decisión 2): si el alta eligió otro modo para
  // ESTE caso, manda ese; el de la clínica queda como propuesta.
  const clinicSettings = await loadOrthoClinicSettings(ctx.clinicId);
  const billingModeDelCaso = parsed.data.billingMode ?? clinicSettings.billingMode;
  // ws1-t12 (decisión de Rafael): para abrir un caso solo son obligatorios la técnica y el doctor. El costo se
  // puede dejar en 0 («lo armo después»): el caso se abre sin factura y Cobro la arma cuando esté definido.
  //
  // ws1-t10 — pero la base exige `totalCostMxn > 0` (`orthodontic_treatment_plans_duration_chk`) hasta que se pegue
  // sql/ortodoncia-costo-del-caso.sql. «Pago por control» no tiene total: sin costo escrito se guarda el mejor
  // ESTIMADO (colocación + controles previstos × precio del control, del catálogo de la clínica) y se avisa; no se
  // factura con él (el cobro por control ignora el costo del caso). «Precio total» con costo 0 no se puede
  // estimar: se intenta con 0 y, si la base aún lo rechaza, se contesta claro (más abajo).
  if (billingModeDelCaso === "PAGO_POR_CONTROL" && !(costoDelCaso > 0)) {
    const [colocacion, precioControl] = await Promise.all([
      precioDeColocacionDelCatalogo(ctx.clinicId).catch(() => null),
      buscarPrecioControlOrto(ctx.clinicId).then((r) => r?.basePrice ?? null).catch(() => null),
    ]);
    const controlesPrevistos = planCompleto?.controlesPrevistos ?? controlesSugeridos(parsed.data.estimatedDurationMonths);
    const { costo, origen } = costoParaGuardarPorControl({
      estimado: estimarCostoPorControl({ colocacion, controlesPrevistos, precioControl }),
    });
    costoDelCaso = costo;
    avisoCosto =
      origen === "estimado"
        ? `Sin costo escrito: el caso se guardó con un costo ESTIMADO de $${costo.toLocaleString("es-MX")} (colocación + ${controlesPrevistos ?? 0} controles previstos). Es solo una referencia: en «Pago por control» se cobra cada control. Cámbialo en el caso cuando lo definas.`
        : "Sin costo escrito ni precios en tu catálogo: el caso se guardó con $1 provisional (la base exige un costo mayor que cero). Escríbelo en el caso cuando lo definas.";
  }

  try {
    let altaCasoFieldsSaved = wantsAltaCasoFields;
    const created = await runTransaction(wantsAltaCasoFields).catch(async (e) => {
      if (!wantsAltaCasoFields || !isMissingColumnError(e)) throw e;
      altaCasoFieldsSaved = false;
      console.error(
        "[ortho] createTreatmentPlan: columnas de alta-caso.sql aún no existen, se crea sin doctor/responsable:",
        e,
      );
      return runTransaction(false);
    });

    // Ola 2 (ws1-t1) — SQL crudo, EN SU PROPIO paso, separado a propósito
    // del de arriba (mismo criterio que signTreatmentCard.ts con C2/C3/C6):
    // un P2021/P2022 de sql/ortodoncia-modo-cobro.sql nunca debe poder
    // revertir un caso ya creado. `guardarModoDeCobroDelCaso` ya no lanza —
    // sin la columna, el caso queda en null = PRECIO_TOTAL (default correcto
    // de todas formas) y solo avisa por consola.
    await guardarModoDeCobroDelCaso(ctx.clinicId, created.id, billingModeDelCaso);

    // ws1-t10 — nombre propio de la técnica de la clínica, también en su propio paso y sin lanzar:
    // sin la columna (sql/ortodoncia-tecnicas-propias.sql) el caso muestra el nombre de su tipo base.
    if (parsed.data.techniqueLabel) {
      await guardarNombreDeTecnicaDelCaso(ctx.clinicId, created.id, parsed.data.techniqueLabel);
    }

    // ws1-t12 — el plan completo, también en su propio paso y sin deshacer el caso: sin la columna
    // (sql/ortodoncia-plan-de-tratamiento.sql) el caso queda abierto y se avisa cómo completarlo.
    let avisoPlanDetalle: string | undefined;
    if (planCompleto) {
      const r = await aplicarPlanDetalle({
        ctx: { clinicId: ctx.clinicId, userId: ctx.userId },
        treatmentPlanId: created.id,
        patientId: parsed.data.patientId,
        plan: planCompleto,
        extraccionesIndicadas: parsed.data.extractionsTeethFdi,
        creado: true,
      });
      if (r.ok === false) avisoPlanDetalle = `El caso se abrió, pero el plan de tratamiento no se guardó: ${r.error} Complétalo después con «Editar plan».`;
    }

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_CREATED,
      entityType: "OrthodonticTreatmentPlan",
      entityId: created.id,
      patientId: parsed.data.patientId,
      after: {
        technique: created.technique,
        durationMonths: created.estimatedDurationMonths,
        totalCostMxn: created.totalCostMxn.toString(),
        installed: Boolean(installedAt),
      },
    });

    // ─── WhatsApp queue F9.5 — PRE_INSTALLATION_INSTRUCTIONS ──────────
    // Si el plan se programa con installedAt >24h en el futuro, encolar
    // recordatorio para 24h antes de la cita de instalación.
    if (installedAt) {
      const remindAt = new Date(installedAt.getTime() - 24 * 60 * 60 * 1000);
      if (remindAt.getTime() > Date.now() + 60_000) {
        const phoneRow = await prisma.patient.findUnique({
          where: { id: parsed.data.patientId },
          select: { phone: true },
        });
        if (phoneRow?.phone) {
          await enqueueOrthoWhatsApp(prisma, {
            clinicId: ctx.clinicId,
            templateKey: "PRE_INSTALLATION_INSTRUCTIONS",
            scheduledFor: remindAt,
            patientPhone: phoneRow.phone,
          }).catch((e) => {
            console.error("[ortho] WA enqueue PRE_INSTALL failed (no bloquea):", e);
          });
        }
      }
    }

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id, altaCasoFieldsSaved, ...(avisoPlanDetalle ? { avisoPlanDetalle } : {}), ...(avisoCosto ? { avisoCosto } : {}) });
  } catch (e) {
    console.error("[ortho] createTreatmentPlan failed:", e);
    // La base rechazó el costo/la duración (23514): decir cuál en vez de un «no se pudo» sin pista.
    if (esViolacionDelCheckDelPlan(e)) {
      return fail(
        costoDelCaso > 0
          ? "La base rechazó la duración del tratamiento: tiene que estar entre 3 y 60 meses."
          : "Escribe el costo del tratamiento: por ahora la base no admite abrir un caso «Precio total» sin costo.",
      );
    }
    return fail("No se pudo crear el plan");
  }
}
