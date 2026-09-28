"use server";
// Orthodontics — signTreatmentCard. DrawerTreatmentCard onSign:
// persiste status SIGNED + signedBy/signedAt + valida SOAP S/O/A/P llenos.
//
// Si la card aún no existe (cardId === null) se crea con todos sus hijos en
// la misma transacción y se firma en un solo paso. Si la card ya existe se
// actualiza in-place y se reemplazan los hijos.
//
// Ola 1 (ws1-t4, Control y agenda, sep-2026): mismo tratamiento que
// saveTreatmentCardDraft.ts para `appointmentId`/`activationsNote`/
// `indications` — columnas nuevas, escritas en una transacción APARTE y
// tolerante a P2021/P2022 para no arriesgar la firma en sí.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { canSignSoap } from "./_predicates";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { datosDeCierreDeCita, planDeCierreDeCita } from "@/lib/orthodontics/cerrar-cita-al-firmar";
import { esCitaControlOrto, TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { buscarPrecioControlOrto } from "@/lib/orthodontics/catalog-procedures";
import { crearFacturaDesdeCita } from "@/lib/invoices/crear-desde-cita.server";
import { vincularExtraAlCaso } from "@/lib/orthodontics/cobro/extras-db";
import { consumirReposicionIncluida } from "@/lib/orthodontics/cobro/caso-db";
import { avisoDeReposiciones } from "@/lib/orthodontics/cobro/reposiciones";

/** Códigos Prisma de "columna inexistente" — mismo patrón que cobranza-db.ts. */
function esColumnaAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

const elasticClassEnum = z.enum([
  "CLASE_I",
  "CLASE_II",
  "CLASE_III",
  "BOX",
  "CRISS_CROSS",
  "SETTLING",
]);
const elasticZoneEnum = z.enum(["ANTERIOR", "POSTERIOR", "INTERMAXILAR"]);
const gingivitisEnum = z.enum(["AUSENTE", "LEVE", "MODERADA", "SEVERA"]);

const inputSchema = z.object({
  cardId: z.string().uuid().nullable(),
  treatmentPlanId: z.string().uuid(),
  cardNumber: z.number().int().positive(),
  visitDate: z.string().min(1),
  durationMin: z.number().int().positive().default(30),
  phaseKey: z.enum([
    "ALIGNMENT",
    "LEVELING",
    "SPACE_CLOSURE",
    "DETAILS",
    "FINISHING",
    "RETENTION",
  ]),
  monthAt: z.number().nonnegative(),
  wireFromId: z.string().uuid().nullable().optional(),
  wireToId: z.string().uuid().nullable().optional(),
  soap: z.object({
    s: z.string(),
    o: z.string(),
    a: z.string(),
    p: z.string(),
  }),
  hygiene: z.object({
    plaquePct: z.number().int().min(0).max(100).nullable(),
    gingivitis: gingivitisEnum.nullable(),
    whiteSpots: z.boolean().default(false),
  }),
  elastics: z
    .array(
      z.object({
        elasticClass: elasticClassEnum,
        config: z.string().min(1),
        zone: elasticZoneEnum,
      }),
    )
    .default([]),
  iprPoints: z
    .array(
      z.object({
        toothA: z.number().int(),
        toothB: z.number().int(),
        amountMm: z.number(),
        done: z.boolean().default(true),
      }),
    )
    .default([]),
  brokenBrackets: z
    .array(
      z.object({
        toothFdi: z.number().int(),
        brokenDate: z.string().min(1),
        reBondedDate: z.string().nullable(),
      }),
    )
    .default([]),
  hasProgressPhoto: z.boolean().default(false),
  photoSetId: z.string().uuid().nullable().optional(),
  nextDate: z.string().nullable().optional(),
  nextDurationMin: z.number().int().positive().nullable().optional(),
  /** C6: la cita de Agenda que originó esta hoja (BotonHojaControl). */
  appointmentId: z.string().nullable().optional(),
  /** C2: activaciones de mecánica auxiliar de ESTA visita. */
  activationsNote: z.string().nullable().optional(),
  /** C3: indicaciones para el paciente de ESTA visita. */
  indications: z.string().nullable().optional(),
});

export type SignTreatmentCardInput = z.input<typeof inputSchema>;

export async function signTreatmentCard(
  input: unknown,
): Promise<ActionResult<{ cardId: string; avisoControlSinFacturar?: string; avisoReposiciones?: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  // Regla SPEC: para firmar todos los SOAP deben tener contenido tras trim.
  // (zod normaliza optionals a string vacío gracias a default(""), pero el
  // tipo `z.input` los marca opcionales — copiamos al shape estricto.)
  const soap = {
    s: data.soap.s ?? "",
    o: data.soap.o ?? "",
    a: data.soap.a ?? "",
    p: data.soap.p ?? "",
  };
  if (!canSignSoap(soap)) {
    return fail("Falta el Plan (P): es lo único obligatorio para firmar el control");
  }

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  // Tenant + integridad: si viene un appointmentId, la cita tiene que ser de
  // este mismo paciente y clínica (C6).
  let citaDeControl: { id: string; type: string; status: string; startsAt: Date } | null = null;
  if (data.appointmentId) {
    const appt = await prisma.appointment.findFirst({
      where: { id: data.appointmentId, clinicId: ctx.clinicId, patientId: plan.patientId },
      select: { id: true, type: true, status: true, startsAt: true },
    });
    if (!appt) return fail("La cita no pertenece a este paciente");
    citaDeControl = appt;
  }

  const visitDate = new Date(data.visitDate);
  const nextDate = data.nextDate ? new Date(data.nextDate) : null;
  const now = new Date();

  let yaEstabaFirmada = false;
  try {
    const cardId = await prisma.$transaction(async (tx) => {
      // Upsert por (treatmentPlanId, cardNumber). Si la card existe se
      // actualiza, si no se crea con cardId fresco.
      const existing = data.cardId
        ? await tx.orthoTreatmentCard.findFirst({
            where: { id: data.cardId, treatmentPlanId: plan.id },
            select: { id: true, status: true },
          })
        : null;
      // #81: una hoja que YA estaba firmada no vuelve a mover el cupo de reposiciones.
      yaEstabaFirmada = existing?.status === "SIGNED";

      let resolvedId: string;
      if (existing) {
        resolvedId = existing.id;
        await tx.orthoTreatmentCard.update({
          where: { id: existing.id },
          data: {
            cardNumber: data.cardNumber,
            visitDate,
            durationMin: data.durationMin,
            phaseKey: data.phaseKey,
            monthAt: data.monthAt,
            wireFromId: data.wireFromId ?? null,
            wireToId: data.wireToId ?? null,
            soapS: data.soap.s,
            soapO: data.soap.o,
            soapA: data.soap.a,
            soapP: data.soap.p,
            hygienePlaquePct: data.hygiene.plaquePct,
            hygieneGingivitis: data.hygiene.gingivitis,
            hygieneWhiteSpots: data.hygiene.whiteSpots,
            hasProgressPhoto: data.hasProgressPhoto,
            photoSetId: data.photoSetId ?? null,
            nextDate,
            nextDurationMin: data.nextDurationMin ?? null,
            status: "SIGNED",
            signedAt: now,
            signedById: ctx.userId,
          },
        });
        // Reemplaza hijos para reflejar exactamente el último estado del UI.
        await tx.orthoCardElastic.deleteMany({ where: { cardId: existing.id } });
        await tx.orthoCardIprPoint.deleteMany({ where: { cardId: existing.id } });
        await tx.orthoCardBrokenBracket.deleteMany({
          where: { cardId: existing.id },
        });
      } else {
        const created = await tx.orthoTreatmentCard.create({
          data: {
            treatmentPlanId: plan.id,
            patientId: plan.patientId,
            clinicId: plan.clinicId,
            cardNumber: data.cardNumber,
            visitDate,
            durationMin: data.durationMin,
            phaseKey: data.phaseKey,
            monthAt: data.monthAt,
            wireFromId: data.wireFromId ?? null,
            wireToId: data.wireToId ?? null,
            soapS: data.soap.s,
            soapO: data.soap.o,
            soapA: data.soap.a,
            soapP: data.soap.p,
            hygienePlaquePct: data.hygiene.plaquePct,
            hygieneGingivitis: data.hygiene.gingivitis,
            hygieneWhiteSpots: data.hygiene.whiteSpots,
            hasProgressPhoto: data.hasProgressPhoto,
            photoSetId: data.photoSetId ?? null,
            nextDate,
            nextDurationMin: data.nextDurationMin ?? null,
            status: "SIGNED",
            signedAt: now,
            signedById: ctx.userId,
          },
          select: { id: true },
        });
        resolvedId = created.id;
      }

      if (data.elastics.length > 0) {
        await tx.orthoCardElastic.createMany({
          data: data.elastics.map((e) => ({
            cardId: resolvedId,
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            elasticClass: e.elasticClass,
            config: e.config,
            zone: e.zone,
          })),
        });
      }
      if (data.iprPoints.length > 0) {
        await tx.orthoCardIprPoint.createMany({
          data: data.iprPoints.map((p) => ({
            cardId: resolvedId,
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            toothA: p.toothA,
            toothB: p.toothB,
            amountMm: p.amountMm,
            done: p.done,
          })),
        });
      }
      if (data.brokenBrackets.length > 0) {
        await tx.orthoCardBrokenBracket.createMany({
          data: data.brokenBrackets.map((b) => ({
            cardId: resolvedId,
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            toothFdi: b.toothFdi,
            brokenDate: new Date(b.brokenDate),
            reBondedDate: b.reBondedDate ? new Date(b.reBondedDate) : null,
          })),
        });
      }

      return resolvedId;
    });

    // Columnas nuevas (Ola 1), en su PROPIA transacción — separada a
    // propósito de la de arriba, igual que saveTreatmentCardDraft.ts: un
    // P2021/P2022 aquí nunca debe poder revertir una firma ya hecha.
    if (
      data.appointmentId !== undefined ||
      data.activationsNote !== undefined ||
      data.indications !== undefined
    ) {
      try {
        await prisma.orthoTreatmentCard.update({
          where: { id: cardId },
          data: {
            ...(data.appointmentId !== undefined
              ? { appointmentId: data.appointmentId }
              : {}),
            ...(data.activationsNote !== undefined
              ? { activationsNote: data.activationsNote }
              : {}),
            ...(data.indications !== undefined ? { indications: data.indications } : {}),
          },
        });
      } catch (e) {
        if (esColumnaAusente(e)) {
          console.warn(
            "[ortho] signTreatmentCard: columnas C2/C3/C6 aún sin aplicar (sql/ortodoncia-control-agenda.sql, sql/ortodoncia-nucleo.sql) — hoja firmada sin ellas",
          );
        } else if ((e as { code?: string } | null)?.code === "P2002") {
          console.warn("[ortho] signTreatmentCard: la cita ya tenía otra hoja ligada");
        } else {
          throw e;
        }
      }
    }

    // Ola 2 (ws1-t1) — modo PAGO_POR_CONTROL: al firmar la hoja de UN
    // control, factura automáticamente el concepto «Control de ortodoncia»
    // del catálogo (factura normal de la cita, cobrable en Caja como
    // cualquier otra) y la liga al caso. Non-blocking a propósito, igual
    // que el bloque de columnas nuevas de arriba: nada de esto puede
    // revertir una firma ya hecha. Sin catálogo o factura ya existente
    // (re-firma de la misma hoja), no pasa nada — no se duplica.
    //
    // «Nada en silencio» (pregunta de Rafael, ws1-t1): si el control no se
    // pudo facturar, `avisoControlSinFacturar` viaja de vuelta al cliente
    // para que muestre un toast — un `console.warn` nadie lo ve en Recepción.
    let avisoControlSinFacturar: string | undefined;
    if (citaDeControl && esCitaControlOrto(citaDeControl.type)) {
      try {
        const modo = normalizarOrthoBillingMode(await cargarModoDeCobro(plan.clinicId, plan.id));
        if (modo === "PAGO_POR_CONTROL") {
          const precio = await buscarPrecioControlOrto(plan.clinicId);
          if (!precio) {
            avisoControlSinFacturar = `Este control no se facturó: falta precio de "${TIPO_CITA_CONTROL_ORTO}" en el catálogo (Configuración → Procedimientos de ortodoncia).`;
            console.warn("[ortho] signTreatmentCard: modo PAGO_POR_CONTROL sin \"Control de ortodoncia\" en el catálogo — no se facturó este control");
          } else {
            const factura = await crearFacturaDesdeCita({
              clinicId: plan.clinicId,
              appointmentId: citaDeControl.id,
              patientId: plan.patientId,
              lineItems: [{ description: precio.name, unitPrice: precio.basePrice, quantity: 1 }],
              userId: ctx.userId,
            });
            if (factura.ok && factura.invoice) {
              await vincularExtraAlCaso({ invoiceId: factura.invoice.id, treatmentPlanId: plan.id, clinicId: plan.clinicId });
            } else if (factura.error && factura.error !== "invoice_already_exists") {
              avisoControlSinFacturar = "Este control no se facturó: hubo un problema al crear la factura. Cóbralo a mano desde Caja.";
              console.warn("[ortho] signTreatmentCard: no se pudo facturar el control (modo PAGO_POR_CONTROL):", factura.error, factura.reason);
            }
          }
        }
      } catch (e) {
        avisoControlSinFacturar = "Este control no se facturó: hubo un problema al crear la factura. Cóbralo a mano desde Caja.";
        console.warn("[ortho] signTreatmentCard: falló la facturación automática del control (no revierte la firma):", e);
      }
    }

    // ws1-t4 #81 — el bracket que la doctora anota como repuesto en la hoja cuenta
    // contra las reposiciones INCLUIDAS del caso («0 de 2 usadas» no se movía solo).
    // Si ya no hay cupo, no se inventa una factura: se avisa que quedan reposiciones
    // por cobrar con «Cobrar extra». No revierte la firma. Una hoja ya firmada antes
    // no vuelve a gastar cupo.
    let avisoReposiciones: string | undefined;
    const repuestos = data.brokenBrackets.filter((b) => b.reBondedDate).length;
    if (!yaEstabaFirmada && repuestos > 0) {
      try {
        let incluidas = 0;
        for (let i = 0; i < repuestos; i++) {
          const r = await consumirReposicionIncluida(plan.id, plan.clinicId);
          if (r.fueIncluida) incluidas++;
          else break;
        }
        avisoReposiciones = avisoDeReposiciones({ repuestos, incluidas });
      } catch (e) {
        console.warn("[ortho] signTreatmentCard: no se pudo contar la reposición contra las incluidas (no revierte la firma):", e);
      }
    }

    // Ronda 6 (ws1-t8, «El día de la ortodoncista») — M6/hallazgo 23: firmar
    // la hoja CIERRA la cita en la Agenda (pasa a "Atendida"/COMPLETED).
    // Antes la cita se quedaba en su estado de siempre (Agendada,
    // Confirmada…) aunque el control ya estuviera firmado, y "Falta de
    // control"/Controles seguían viendo al paciente como si no hubiera
    // venido el mismo día que vino. No bloqueante: se salta en silencio si
    // la transición no es válida desde el estado actual (p. ej. la cita ya
    // se canceló, o ya estaba completada) — nunca revierte la firma clínica.
    if (citaDeControl && citaDeControl.status !== "COMPLETED") {
      try {
        const plan = planDeCierreDeCita(
          citaDeControl.status,
          String(ctx.role),
          now,
          citaDeControl.startsAt,
        );
        const cierre = datosDeCierreDeCita(plan, now);
        if (cierre) {
          await prisma.appointment.update({ where: { id: citaDeControl.id }, data: cierre });
        } else {
          console.warn(`[ortho] signTreatmentCard: cita ${citaDeControl.id} (${citaDeControl.status}) no se puede pasar a COMPLETED — se firmó igual`);
        }
      } catch (e) {
        console.warn("[ortho] signTreatmentCard: no se pudo marcar la cita como atendida (no revierte la firma):", e);
      }
    }

    // Ronda 6 (ws1-t8) — M5/hallazgo 5, decisión 4 del gerente
    // (REPORTE-ws1-t8.md): las hojas de control SÍ cuentan como notas del
    // expediente. "Historial de consultas" y el PDF del expediente leen
    // `medical_records` (prisma.medicalRecord), no `ortho_treatment_cards`
    // — sin esto, para la NOM-004 la doctora tenía que escribir la misma
    // nota dos veces, y el historial general mostraba "0 total" con un
    // control firmado el mismo día. Idempotente por
    // `specialtyData.treatmentCardId`: si alguna vez se permite re-firmar,
    // no duplica la nota.
    try {
      const yaExiste = await prisma.medicalRecord.findFirst({
        where: {
          clinicId: plan.clinicId,
          patientId: plan.patientId,
          specialtyData: { path: ["treatmentCardId"], equals: cardId },
        },
        select: { id: true },
      });
      if (!yaExiste) {
        await prisma.medicalRecord.create({
          data: {
            clinicId: plan.clinicId,
            patientId: plan.patientId,
            doctorId: ctx.userId,
            visitDate,
            subjective: soap.s,
            objective: soap.o,
            assessment: soap.a,
            plan: soap.p,
            specialtyData: {
              type: "orthodontics",
              // Visto en vivo: sin esto el historial de consultas pintaba la
              // nota de un control FIRMADO como «Borrador» y ofrecía
              // «Eliminar borrador». Misma forma que una nota firmada de
              // /api/clinical-notes (NOM-024: inalterable).
              status: "SIGNED",
              signedAt: new Date().toISOString(),
              treatmentCardId: cardId,
              treatmentPlanId: plan.id,
              appointmentId: data.appointmentId ?? null,
              cardNumber: data.cardNumber,
            },
          },
        });
      }
    } catch (e) {
      console.warn("[ortho] signTreatmentCard: no se pudo crear la nota de evolución en el expediente general (no revierte la firma):", e);
    }

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CARD_SIGNED,
      entityType: "OrthoTreatmentCard",
      entityId: cardId,
      after: {
        status: "SIGNED",
        cardNumber: data.cardNumber,
        phaseKey: data.phaseKey,
        signedById: ctx.userId,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
    return ok({ cardId, ...(avisoReposiciones ? { avisoReposiciones } : {}), ...(avisoControlSinFacturar ? { avisoControlSinFacturar } : {}) });
  } catch (e) {
    console.error("[ortho] signTreatmentCard failed:", e);
    return fail("No se pudo firmar la cita");
  }
}
