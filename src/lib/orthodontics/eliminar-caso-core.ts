// Ortodoncia — el núcleo de «Eliminar caso (abierto por error)» (ws1-t8).
//
// La acción del servidor (`eliminarCaso.ts`) pone la sesión, la visibilidad del
// paciente y los avisos; aquí vive lo que decide y escribe, con sus dependencias
// inyectadas para poder probarlo entero (nada de esto toca la base real en las
// pruebas). Reglas y textos: `eliminar-caso.ts`.
//
// Orden: (1) leer el caso de ESTA clínica, (2) leer qué tiene, (3) decidir,
// (4) transacción — facturas bloqueadas, historial otra vez, cancelar las
// facturas sin pagos, borrar el caso y su diagnóstico —, (5) dejar el rastro.
// Si algo cambió entre (2) y (4) (un pago, una hoja, una cita atendida) la
// transacción se corta y no se toca nada.

import type { Prisma } from "@prisma/client";
import {
  MIN_LETRAS_MOTIVO,
  evaluarEliminacion,
  explicacionDeHistorial,
  motivoDeCancelacionDeFactura,
  motivoValido,
  textoDelMovimiento,
} from "./eliminar-caso";
import { leerHistorialDeCasos, type CasoParaHistorial } from "./eliminar-caso-db";

/** El cliente de Prisma dentro de una transacción (el pelado también lo cumple). */
export type TransactionClient = Prisma.TransactionClient;

/** Corta la transacción con un mensaje para quien la pidió. */
class NoSePuedeEliminar extends Error {}

function esRelacionAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export interface DbEliminar extends TransactionClient {
  $transaction<T>(fn: (tx: TransactionClient) => Promise<T>, opts?: { timeout?: number }): Promise<T>;
}

export interface MovimientoAEscribir {
  patientId: string;
  entityType: "orthodontic-case" | "invoice";
  entityId: string;
  action: "delete" | "update";
  texto: string;
  campos?: readonly string[];
  cambios?: Record<string, { before: unknown; after: unknown }>;
}

export interface EntradaEliminar {
  db: DbEliminar;
  /** De la sesión, nunca del cliente. */
  clinicId: string;
  userId: string;
  treatmentPlanId: string;
  motivo: unknown;
  /** `billing.refund`: cancelar una factura del caso lo pide. */
  puedeCancelarFacturas: boolean;
  /** ¿Existe `invoices.orthodonticTreatmentPlanId` en esta base? */
  columnaDeFacturas: boolean;
  /** Visibilidad por paciente: un paciente restringido no existe para quien no lo ve. */
  puedeVerPaciente: (patientId: string) => Promise<boolean>;
  /** Deja el rastro en «Movimientos del paciente». Nunca debe tirar. */
  registrar: (m: MovimientoAEscribir) => Promise<void>;
  /** Cierra lo que colgaba de una factura cancelada (links de pago, anticipos). Nunca debe tirar. */
  alCancelarFactura?: (invoiceId: string) => Promise<void>;
}

export type ResultadoEliminar =
  | { ok: true; patientId: string; planId: string; facturasCanceladas: number }
  | { ok: false; error: string };

export async function eliminarCasoEnBase(e: EntradaEliminar): Promise<ResultadoEliminar> {
  const { db, clinicId } = e;
  // `clinicId: undefined` no filtra nada en Prisma: sin clínica no se consulta.
  if (!clinicId || !e.userId) return { ok: false, error: "No autenticado" };
  if (!e.treatmentPlanId) return { ok: false, error: "Caso no encontrado" };
  const motivo = motivoValido(e.motivo);
  if (!motivo) {
    return { ok: false, error: `Escribe el motivo (al menos ${MIN_LETRAS_MOTIVO} letras): queda en los movimientos del paciente.` };
  }

  // `invoiceId` es una columna de la Ola 0: sin ella se lee sin ella.
  const donde = { id: e.treatmentPlanId, clinicId, deletedAt: null };
  let plan: { id: string; patientId: string; diagnosisId: string; createdAt: Date; invoiceId: string | null } | null;
  try {
    plan = await db.orthodonticTreatmentPlan.findFirst({
      where: donde,
      select: { id: true, patientId: true, diagnosisId: true, createdAt: true, invoiceId: true },
    });
  } catch (err) {
    if (!esRelacionAusente(err)) throw err;
    const sin = await db.orthodonticTreatmentPlan.findFirst({
      where: donde,
      select: { id: true, patientId: true, diagnosisId: true, createdAt: true },
    });
    plan = sin ? { ...sin, invoiceId: null } : null;
  }
  if (!plan) return { ok: false, error: "Caso no encontrado" };
  if (!(await e.puedeVerPaciente(plan.patientId))) return { ok: false, error: "Caso no encontrado" };

  const caso: CasoParaHistorial = {
    id: plan.id,
    patientId: plan.patientId,
    createdAt: plan.createdAt,
    invoiceId: plan.invoiceId,
  };
  const historial = (await leerHistorialDeCasos(db, clinicId, [caso], { tolerante: true, columnaDeFacturas: e.columnaDeFacturas })).get(plan.id);
  if (!historial) return { ok: false, error: "Caso no encontrado" };
  const veredicto = evaluarEliminacion(historial);
  if (!veredicto.puede) return { ok: false, error: explicacionDeHistorial(veredicto) };

  // Cancelar una factura pide el mismo permiso que en Facturación.
  if (veredicto.facturasACancelar > 0 && !e.puedeCancelarFacturas) {
    return {
      ok: false,
      error:
        "Este caso tiene una factura sin pagos que se cancelaría con él, y cancelar facturas pide el permiso de reembolsos (billing.refund).",
    };
  }

  const planId = plan.id;
  const diagnosisId = plan.diagnosisId;
  let canceladas: { id: string; invoiceNumber: string }[];
  try {
    canceladas = await db.$transaction(
      async (tx) => {
        // 1. Las facturas del caso, bloqueadas: el cobro toma el mismo candado.
        for (const id of historial.facturasSinPagos) {
          await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`;
        }
        // 2. El historial otra vez, ya con el candado: si en el ínterin entró un
        //    pago, una hoja o una cita atendida, no se borra nada.
        const fresco = (await leerHistorialDeCasos(tx, clinicId, [caso], { tolerante: false, columnaDeFacturas: e.columnaDeFacturas })).get(planId);
        const v = fresco ? evaluarEliminacion(fresco) : null;
        if (!fresco || !v) throw new NoSePuedeEliminar("Caso no encontrado");
        if (!v.puede) throw new NoSePuedeEliminar(explicacionDeHistorial(v));

        // 3. Las facturas sin pagos se cancelan con el motivo. El WHERE repite la
        //    regla: sin dinero, sin timbre y no canceladas ya.
        const facturas = await tx.invoice.findMany({
          where: { clinicId, id: { in: fresco.facturasSinPagos } },
          select: { id: true, invoiceNumber: true, notes: true },
        });
        if (facturas.length !== fresco.facturasSinPagos.length) {
          throw new NoSePuedeEliminar("Una factura del caso cambió. Vuelve a intentarlo.");
        }
        const nota = `[CANCELADA: ${motivoDeCancelacionDeFactura(motivo)}]`;
        for (const f of facturas) {
          const { count } = await tx.invoice.updateMany({
            where: { id: f.id, clinicId, paid: { lte: 0 }, cfdiUuid: null, status: { not: "CANCELLED" } },
            data: { status: "CANCELLED", notes: f.notes ? `${f.notes}\n${nota}` : nota },
          });
          if (count !== 1) throw new NoSePuedeEliminar("Una factura del caso cambió mientras se eliminaba. Vuelve a intentarlo.");
        }

        // 4. El caso y su diagnóstico, borrado lógico. Sin esto el diagnóstico
        //    (uno por plan) seguiría atado a un plan que ya no se ve.
        const ahora = new Date();
        const { count } = await tx.orthodonticTreatmentPlan.updateMany({
          where: { id: planId, clinicId, deletedAt: null },
          data: { deletedAt: ahora },
        });
        if (count !== 1) throw new NoSePuedeEliminar("El caso ya no existe.");
        await tx.orthodonticDiagnosis.updateMany({
          where: { id: diagnosisId, clinicId, deletedAt: null },
          data: { deletedAt: ahora },
        });
        return facturas.map((f) => ({ id: f.id, invoiceNumber: f.invoiceNumber }));
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    if (err instanceof NoSePuedeEliminar) return { ok: false, error: err.message };
    console.error("[eliminarCaso]", err);
    return { ok: false, error: "No se pudo eliminar el caso. No se cambió nada." };
  }

  // Ya hecho: el rastro y lo que cuelga de las facturas.
  await e.registrar({
    patientId: plan.patientId,
    entityType: "orthodontic-case",
    entityId: planId,
    action: "delete",
    texto: textoDelMovimiento(motivo, canceladas.length),
    campos: ["deletedAt"],
    cambios: { motivo: { before: null, after: motivo } },
  });
  for (const f of canceladas) {
    await e.registrar({
      patientId: plan.patientId,
      entityType: "invoice",
      entityId: f.id,
      action: "update",
      texto: `Canceló la factura ${f.invoiceNumber} al eliminar el caso de ortodoncia`,
      cambios: { status: { before: "sin pagos", after: "CANCELLED" } },
    });
    await e.alCancelarFactura?.(f.id);
  }
  return { ok: true, patientId: plan.patientId, planId, facturasCanceladas: canceladas.length };
}
