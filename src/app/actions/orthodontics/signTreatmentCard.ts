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
import { auditOrtho, getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import type { Pedido } from "@/lib/orthodontics/procedimientos-de-visita";
import { escribirNotaDeHoja, validarPedidos } from "@/lib/orthodontics/procedimientos-de-hoja-db";
import { marcarExtraccionesDesdeLaHoja } from "@/lib/orthodontics/plan-detalle-guardar";
import { canSignSoap } from "./_predicates";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import { citaAlFirmar, datosDeCierreDeCita, planDeCierreDeCita } from "@/lib/orthodontics/cerrar-cita-al-firmar";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { cargarModoDeCobro } from "@/lib/orthodontics/billing-mode-db";
import { normalizarOrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import { buscarPrecioControlOrto } from "@/lib/orthodontics/catalog-procedures";
import { crearFacturaDesdeCita } from "@/lib/invoices/crear-desde-cita.server";
import { esPacienteDePrueba } from "@/lib/patients/paciente-de-prueba-db";
import { vincularExtraAlCaso } from "@/lib/orthodontics/cobro/extras-db";
import { consumirReposicionIncluida } from "@/lib/orthodontics/cobro/caso-db";
import { notaDeControlSinCita } from "@/lib/orthodontics/cobro/control-sin-cita";
import { mensajeDeHuecos, rellenarHuecosOpcionales } from "@/lib/orthodontics/hoja-de-control-reglas";
import { cambiosAlFirmarConArco } from "@/lib/orthodontics/secuencia-de-arcos";
import { existeFacturaDeControlSinCita } from "@/lib/orthodontics/cobro/control-sin-cita-db";
import { avisoDeReposiciones } from "@/lib/orthodontics/cobro/reposiciones";
import { sendReviewInvitation } from "@/lib/reviews/invite";

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
  /**
   * «Procedimientos de esta visita»: solo QUÉ y CUÁNTOS. Nombre, precio y si es incluido
   * o con costo aparte salen del catálogo en el servidor (procedimientos-de-visita.ts).
   * undefined = no se tocan los que la hoja ya tenía guardados.
   */
  procedimientos: z
    .array(z.object({ procedureId: z.string().min(1), quantity: z.number().int().min(1).max(20) }))
    .optional(),
  /**
   * ws1-t12: extracciones del plan de tratamiento (FDI) que se hicieron en ESTA visita. Al firmar se marcan
   * como realizadas en el plan; solo cuentan las que el plan tiene como indicadas.
   */
  extraccionesRealizadas: z.array(z.number().int()).max(32).optional(),
});

export type SignTreatmentCardInput = z.input<typeof inputSchema>;

export async function signTreatmentCard(
  input: unknown,
): Promise<ActionResult<{ cardId: string; citaCerrada?: string; citaDeOtroDiaSinTocar?: string; avisoControlSinFacturar?: string; avisoReposiciones?: string; avisoProcedimientos?: string; avisoExtracciones?: string }>> {
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
  const soapTecleado = {
    s: data.soap.s ?? "",
    o: data.soap.o ?? "",
    a: data.soap.a ?? "",
    p: data.soap.p ?? "",
  };
  if (!canSignSoap(soapTecleado)) {
    return fail("Falta el Plan (P): es lo único obligatorio para firmar el control");
  }
  // NOM-004 (ws1-t9 #2): una nota firmada es inalterable y no puede llevar los huecos «____» de
  // la plantilla. ws1-t8 (ticket BEVADENT, punto 10): solo lo OBLIGATORIO bloquea — un hueco en el
  // Plan impide firmar; uno en S/O/A (opcionales) se firma escrito «[sin dato]». El cajón dice lo
  // mismo antes de firmar; el servidor lo vuelve a aplicar (una petición hecha a mano no se lo salta).
  const avisoDeHuecos = mensajeDeHuecos(soapTecleado);
  if (avisoDeHuecos) return fail(avisoDeHuecos);
  const soap = rellenarHuecosOpcionales(soapTecleado);

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");
  // Visibilidad por paciente (la regla de todo el módulo): un doctor con pacientes
  // restringidos no firma la hoja de un paciente que no ve, aunque conozca el id del caso.
  const visible = await loadPatientForOrtho({ ctx, patientId: plan.patientId });
  if (isFailure(visible)) return visible;

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

  // ws1-t8 (ticket BEVADENT, punto 12): firmar HOY la hoja de una cita de OTRO día. Una cita futura con el
  // paciente presente se atendió hoy, adelantada (se liga y se cierra, la visita es de hoy); sin el paciente
  // presente NO se toca: la hoja se firma como visita de hoy, sin cita, y se avisa. Regla en cerrar-cita-al-firmar.ts.
  const clinicaZona = citaDeControl
    ? ((await prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } }))?.timezone ?? "America/Mexico_City")
    : null;
  const decisionCita = citaDeControl && clinicaZona ? citaAlFirmar(citaDeControl, new Date(), clinicaZona) : null;
  const citaDeOtroDiaSinTocar = decisionCita && "diaDeLaCita" in decisionCita ? decisionCita.diaDeLaCita : undefined;
  if (citaDeOtroDiaSinTocar) citaDeControl = null;
  // La cita a la que queda ligada la hoja: `undefined` = no se toca la columna; `null` = se desliga (una hoja
  // guardada antes como borrador ligada a esa cita futura deja de estarlo).
  const appointmentIdDeLaHoja: string | null | undefined = citaDeOtroDiaSinTocar ? null : data.appointmentId;

  // Los procedimientos de la visita se validan ANTES de firmar: una hoja no puede quedar
  // firmada con un procedimiento que el catálogo ya no ofrece (la firma es inalterable).
  if (data.procedimientos !== undefined) {
    const errorProcedimientos = await validarPedidos({ clinicId: ctx.clinicId, cardId: data.cardId ?? null, pedidos: data.procedimientos as Pedido[] });
    if (errorProcedimientos) return fail(errorProcedimientos);
  }

  const visitDate = decisionCita?.visitaHoy ? new Date() : new Date(data.visitDate);
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
      // La firma se «reclama» con un UPDATE condicional (status <> SIGNED): dos firmas a
      // la vez se serializan por el candado de fila y solo UNA ve count = 1; leer el
      // estado y luego escribir dejaba pasar a las dos y gastaba el cupo dos veces.
      if (existing) {
        const reclamo = await tx.orthoTreatmentCard.updateMany({
          where: { id: existing.id, treatmentPlanId: plan.id, status: { not: "SIGNED" } },
          data: { status: "SIGNED", signedAt: now, signedById: ctx.userId },
        });
        yaEstabaFirmada = reclamo.count === 0;
      }

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
            soapS: soap.s,
            soapO: soap.o,
            soapA: soap.a,
            soapP: soap.p,
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
            soapS: soap.s,
            soapO: soap.o,
            soapA: soap.a,
            soapP: soap.p,
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

    // ws1-t10: el arco de «Arco nuevo» pasa a «Actual» en la Secuencia de arcos (con la fecha de la visita como inicio)
    // y el que estaba en uso se cierra. Secundario: la firma ya quedó; si falla, se avisa en el log y la secuencia se
    // corrige a mano desde «Agregar arco». Solo si esta es la hoja firmada más reciente y no se firmó antes.
    if (data.wireToId && !yaEstabaFirmada) {
      try {
        const [posteriores, pasos] = await Promise.all([
          prisma.orthoTreatmentCard.count({
            where: { treatmentPlanId: plan.id, clinicId: plan.clinicId, deletedAt: null, status: "SIGNED", visitDate: { gt: visitDate }, id: { not: cardId } },
          }),
          prisma.orthoWireStep.findMany({
            where: { treatmentPlanId: plan.id, clinicId: plan.clinicId },
            select: { id: true, status: true, appliedDate: true, completedDate: true, archUpper: true, archLower: true },
          }),
        ]);
        if (posteriores === 0) {
          const cambios = cambiosAlFirmarConArco({
            pasos,
            arcoNuevoId: data.wireToId,
            arcoAnteriorId: data.wireFromId ?? null,
            fecha: visitDate,
          });
          for (const c of cambios) {
            await prisma.orthoWireStep.updateMany({
              where: { id: c.id, treatmentPlanId: plan.id, clinicId: plan.clinicId },
              data: { status: c.status, appliedDate: c.appliedDate, completedDate: c.completedDate },
            });
          }
        }
      } catch (e) {
        console.warn("[ortho] signTreatmentCard: no se pudo actualizar la secuencia de arcos (no revierte la firma):", e);
      }
    }

    // Columnas nuevas (Ola 1), en su PROPIA transacción — separada a
    // propósito de la de arriba, igual que saveTreatmentCardDraft.ts: un
    // P2021/P2022 aquí nunca debe poder revertir una firma ya hecha.
    if (
      appointmentIdDeLaHoja !== undefined ||
      data.activationsNote !== undefined ||
      data.indications !== undefined
    ) {
      try {
        await prisma.orthoTreatmentCard.update({
          where: { id: cardId },
          data: {
            ...(appointmentIdDeLaHoja !== undefined
              ? { appointmentId: appointmentIdDeLaHoja }
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
    //
    // ws1-t10 (hallazgo #1 de la revisión final): «Registrar control» desde la ficha SIN
    // cita de hoy firmaba y NO facturaba ni avisaba (cobro perdido en silencio). Ahora el
    // control sin cita se factura igual — una factura sin cita, reconocible por la marca
    // de la hoja en sus notas (`control-sin-cita.ts`) y ligada al caso — y no se duplica si
    // ya existe la de esa hoja ni cuando la hoja ya estaba firmada.
    let avisoControlSinFacturar: string | undefined;
    // ws1-t8 (punto 3): la hoja ahora se liga también a la cita de la consulta en curso aunque su tipo no sea
    // «Control de ortodoncia» (se abrió como «Dental general» y el doctor cambió a Ortodoncia). Una hoja firmada
    // ES un control: con cita ligada se factura con esa cita (sin cita se perdería el cobro en silencio, porque el
    // camino «sin cita» no aplica). `crearFacturaDesdeCita` no duplica si la cita ya tiene factura.
    const esControlConCita = !!citaDeControl;
    const esControlSinCita = !citaDeControl && !yaEstabaFirmada;
    // ws1-t11 (11d): un «Paciente de prueba / no contactar» no genera cargos
    // automáticos. Se avisa igual que cualquier control no facturado: si de
    // verdad hay que cobrarle, se cobra a mano.
    const pacienteDePrueba = (esControlConCita || esControlSinCita) && (await esPacienteDePrueba(plan.clinicId, plan.patientId));
    if (pacienteDePrueba) {
      avisoControlSinFacturar = "Este control no se facturó: es un paciente de prueba / no contactar. Si hay que cobrarle, hazlo a mano desde Caja.";
    }
    if (!pacienteDePrueba && (esControlConCita || esControlSinCita)) {
      try {
        const modo = normalizarOrthoBillingMode(await cargarModoDeCobro(plan.clinicId, plan.id));
        if (modo === "PAGO_POR_CONTROL" && esControlSinCita && (await existeFacturaDeControlSinCita(plan.clinicId, cardId))) {
          // Esta hoja ya tiene su factura: no se duplica.
        } else if (modo === "PAGO_POR_CONTROL") {
          const precio = await buscarPrecioControlOrto(plan.clinicId);
          if (!precio) {
            avisoControlSinFacturar = `Este control no se facturó: falta precio de "${TIPO_CITA_CONTROL_ORTO}" en el catálogo (Configuración → Procedimientos de ortodoncia).`;
            console.warn("[ortho] signTreatmentCard: modo PAGO_POR_CONTROL sin \"Control de ortodoncia\" en el catálogo — no se facturó este control");
          } else {
            const factura = await crearFacturaDesdeCita({
              clinicId: plan.clinicId,
              appointmentId: citaDeControl ? citaDeControl.id : null,
              patientId: plan.patientId,
              lineItems: [{ description: precio.name, unitPrice: precio.basePrice, quantity: 1 }],
              ...(citaDeControl ? {} : { notes: notaDeControlSinCita(cardId) }),
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
        let sinContar = false;
        for (let i = 0; i < repuestos; i++) {
          const r = await consumirReposicionIncluida(plan.id, plan.clinicId);
          // Un error o una tabla ausente NO es «ya no hay cupo»: no se manda a cobrar.
          if (!r.ok) { sinContar = true; break; }
          if (r.fueIncluida) incluidas++;
          else break;
        }
        avisoReposiciones = sinContar
          ? "No se pudo contar la reposición de bracket contra las incluidas del caso: revisa «Reposiciones incluidas» en Cobro del tratamiento."
          : avisoDeReposiciones({ repuestos, incluidas });
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
    let citaCerrada: string | undefined;
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
          // Cerrar la cita al firmar pide la reseña igual que «Terminar consulta»
          // (ws1-t4, 11.2). Idempotente y nunca lanza.
          await sendReviewInvitation(citaDeControl.id);
          citaCerrada = citaDeControl.id;
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
    // «Procedimientos de esta visita»: la nota se crea (o, si ya existía como borrador,
    // se firma) con los procedimientos ESCRITOS en su texto (NOM-004) y guardados
    // estructurados en su `specialtyData`. Una nota ya firmada no se reescribe.
    let avisoProcedimientos: string | undefined;
    try {
      const nota = await escribirNotaDeHoja({
        clinicId: plan.clinicId,
        patientId: plan.patientId,
        planId: plan.id,
        userId: ctx.userId,
        cardId,
        cardNumber: data.cardNumber,
        visitDate,
        appointmentId: citaDeControl ? citaDeControl.id : null,
        soap,
        pedidos: data.procedimientos as Pedido[] | undefined,
        firmar: true,
      });
      if (!nota.ok) {
        avisoProcedimientos = "La hoja se firmó, pero no se pudieron escribir sus procedimientos en la nota del expediente. Revísalos y anótalos a mano.";
        console.warn("[ortho] signTreatmentCard: procedimientos no escritos en la nota:", nota.error);
      }
    } catch (e) {
      avisoProcedimientos = "La hoja se firmó, pero no se pudo crear la nota del expediente. Revísala en «Historial de consultas».";
      console.warn("[ortho] signTreatmentCard: no se pudo crear la nota de evolución en el expediente general (no revierte la firma):", e);
    }

    // ws1-t12 — las extracciones de esta visita se marcan como realizadas en el plan de tratamiento. Es
    // secundario: la firma ya quedó; si no se puede (falta el SQL del plan), se dice y se marcan a mano.
    let avisoExtracciones: string | undefined;
    if (data.extraccionesRealizadas && data.extraccionesRealizadas.length > 0) {
      try {
        const r = await marcarExtraccionesDesdeLaHoja({
          ctx: { clinicId: ctx.clinicId, userId: ctx.userId },
          treatmentPlanId: plan.id,
          patientId: plan.patientId,
          piezas: data.extraccionesRealizadas,
        });
        if (r.ok === false) avisoExtracciones = `La hoja se firmó, pero las extracciones no se marcaron en el plan: ${r.error}`;
      } catch (e) {
        avisoExtracciones = "La hoja se firmó, pero no se pudieron marcar las extracciones en el plan de tratamiento. Márcalas en «Editar plan».";
        console.warn("[ortho] signTreatmentCard: extracciones no marcadas en el plan:", e);
      }
    }

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CARD_SIGNED,
      entityType: "OrthoTreatmentCard",
      entityId: cardId,
      patientId: plan.patientId,
      after: {
        status: "SIGNED",
        cardNumber: data.cardNumber,
        phaseKey: data.phaseKey,
        signedById: ctx.userId,
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
    return ok({ cardId, ...(citaCerrada ? { citaCerrada } : {}), ...(citaDeOtroDiaSinTocar ? { citaDeOtroDiaSinTocar } : {}), ...(avisoExtracciones ? { avisoExtracciones } : {}), ...(avisoProcedimientos ? { avisoProcedimientos } : {}), ...(avisoReposiciones ? { avisoReposiciones } : {}), ...(avisoControlSinFacturar ? { avisoControlSinFacturar } : {}) });
  } catch (e) {
    console.error("[ortho] signTreatmentCard failed:", e);
    return fail("No se pudo firmar la cita");
  }
}
