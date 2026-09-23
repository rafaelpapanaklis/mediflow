// Saldo a favor → factura: aplicarlo al crear y devolverlo al cancelar.
//
// El anticipo que cobra el bot (anticipos/servicio.server.ts) y el saldo a
// favor migrado viven en patient_credits. Hasta aquí nadie los descontaba de
// una factura: el bot prometía «se descuenta de tu tratamiento» y solo pasaba
// si recepción lo restaba a mano, sin rastro.
//
// CÓMO SE APLICA — como un Payment (method «anticipo») sobre la factura, y en
// la MISMA transacción una fila NEGATIVA en patient_credits ligada a esa
// factura y a ese Payment:
//   · el Payment es lo que ya mueve `paid`/`balance`, lo que suma Caja y lo
//     que ven el detalle, el PDF y el portal. No hay un segundo camino.
//   · la fila negativa es lo que baja el saldo a favor: SUM(amount) ya lo ve
//     todo el que lo leía (perfil del paciente, KPI de Caja) sin cambiar nada.
//   · `invoices.total` y los conceptos NO se tocan: el anticipo no es un
//     descuento, es dinero que ya se cobró. Por eso la guarda del timbrado
//     (cfdiCuadre: conceptos contra total) sigue cerrando igual que antes.
//
// NO SE CUENTA DOS VECES:
//   · el Payment y la fila negativa se escriben juntos o no se escribe nada;
//   · dos cobros contra el mismo saldo se serializan con
//     pg_advisory_xact_lock por paciente, y el saldo se relee DENTRO;
//   · una factura recibe saldo a favor una sola vez (se comprueba bajo el
//     candado y lo remata un índice único parcial en la base);
//   · nunca más que lo que queda por pagar: el resto sigue a favor.
//
// Aislamiento: todo lleva `clinicId` en el where; sin clinicId no se consulta.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { round2 } from "@/lib/quotes/compute";
import {
  APLICAR_SALDO_DESDE,
  FUENTE_APLICADO,
  FUENTE_DEVUELTO,
  METODO_ANTICIPO,
  claveCandadoSaldo,
  estadoTrasAbono,
  montoAAplicar,
  motivoParaNoAplicar,
  repartoAlCancelar,
  type OrigenAplicacion,
} from "./patient-credit-core";

type Tx = Prisma.TransactionClient;
type Db = Pick<typeof prisma, "$transaction">;

export interface ResultadoAplicacion {
  /** Lo que se descontó de la factura (0 si no había saldo o no aplicaba). */
  aplicado: number;
  /** Lo que sigue a favor del paciente después. null si no se llegó a leer. */
  restanteAFavor: number | null;
  /** La factura tal como quedó (solo si se aplicó algo). */
  factura: { paid: number; balance: number; status: string; paidAt: Date | null } | null;
  /** Por qué no se aplicó (informativo; null si se aplicó). */
  motivo: string | null;
}

const NADA = (motivo: string, restanteAFavor: number | null = null): ResultadoAplicacion => ({
  aplicado: 0,
  restanteAFavor,
  factura: null,
  motivo,
});

/** Tabla o columna que todavía no existe: el SQL se aplica a mano y puede ir por detrás del deploy. */
function faltaLaTabla(e: any): boolean {
  return e?.code === "P2021" || e?.code === "P2022";
}

/**
 * Aplica el saldo a favor del paciente a UNA factura recién creada (o recién
 * confirmada). En su propia transacción, DESPUÉS de crear la factura:
 *
 *   · NUNCA lanza. Si algo falla, la transacción se deshace entera (ni Payment
 *     ni fila negativa) y la factura queda como nació, con el saldo a favor
 *     intacto. Lanzar aquí haría que la pantalla diera error sobre una factura
 *     que SÍ se creó, y el segundo clic crearía otra.
 *   · Si el SQL (sql/anticipo-aplicado-a-factura.sql) aún no está aplicado,
 *     no hace nada: la factura se crea igual que hoy.
 */
export async function aplicarSaldoAFavor(
  args: {
    clinicId: string;
    invoiceId: string;
    /** Quién hizo la acción que disparó la aplicación. null = el sistema. */
    userId: string | null;
    origen: OrigenAplicacion;
    ahora?: Date;
    /** Solo pruebas: la fecha de corte de «solo facturas nuevas». */
    desde?: Date;
  },
  db: Db = prisma,
): Promise<ResultadoAplicacion> {
  if (!args.clinicId || !args.invoiceId) return NADA("faltan datos");
  try {
    return await db.$transaction((tx) => aplicarEnTx(tx, args));
  } catch (e) {
    if (faltaLaTabla(e)) return NADA("patient_credits sin las columnas nuevas (falta aplicar el SQL)");
    console.error("[saldo-a-favor] no se pudo aplicar a la factura", {
      clinicId: args.clinicId,
      invoiceId: args.invoiceId,
      error: (e as Error)?.message,
    });
    return NADA("error al aplicar");
  }
}

async function aplicarEnTx(
  tx: Tx,
  args: { clinicId: string; invoiceId: string; userId: string | null; origen: OrigenAplicacion; ahora?: Date; desde?: Date },
): Promise<ResultadoAplicacion> {
  const { clinicId, invoiceId } = args;
  const ahora = args.ahora ?? new Date();

  // Candado de la factura: el mismo FOR UPDATE que el cobro, mark-paid, el
  // reembolso y la cancelación. Nada cobra ni cancela esta factura a la vez.
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} AND "clinicId" = ${clinicId} FOR UPDATE`;
  const inv = await tx.invoice.findFirst({
    where: { id: invoiceId, clinicId },
    select: { id: true, patientId: true, invoiceNumber: true, total: true, paid: true, status: true, cfdiUuid: true, createdAt: true },
  });
  if (!inv) return NADA("factura no encontrada");
  if (!inv.patientId) return NADA("factura sin paciente");
  const motivo = motivoParaNoAplicar(inv, args.origen, args.desde ?? APLICAR_SALDO_DESDE);
  if (motivo) return NADA(motivo);

  // Candado del SALDO del paciente: dos facturas del mismo paciente creadas a
  // la vez no pueden gastar el mismo peso. Todo lo que RESTA del saldo pasa por
  // aquí; lo que suma (un anticipo nuevo, una devolución) no necesita esperar.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claveCandadoSaldo(clinicId, inv.patientId)}))`;

  const ya = await tx.patientCredit.findFirst({
    where: { clinicId, invoiceId, source: FUENTE_APLICADO },
    select: { id: true },
  });
  if (ya) return NADA("esta factura ya recibió saldo a favor");

  // Leído DENTRO del candado: lo que otra transacción aplicó ya está restado.
  const agg = await tx.patientCredit.aggregate({
    where: { clinicId, patientId: inv.patientId },
    _sum: { amount: true },
  });
  const saldo = round2(agg._sum.amount ?? 0);
  const monto = montoAAplicar(saldo, inv.total, inv.paid);
  if (monto <= 0) return NADA(saldo > 0 ? "la factura no tiene saldo pendiente" : "sin saldo a favor", saldo);

  const pago = await tx.payment.create({
    data: {
      invoiceId,
      amount: monto,
      method: METODO_ANTICIPO,
      notes: "Saldo a favor del paciente (anticipo) aplicado al emitir la factura",
      paidAt: ahora,
    },
    select: { id: true },
  });
  await tx.patientCredit.create({
    data: {
      clinicId,
      patientId: inv.patientId,
      amount: -monto,
      source: FUENTE_APLICADO,
      invoiceId,
      paymentId: pago.id,
      createdById: args.userId,
      creditDate: ahora,
      description:
        `Aplicado a la factura ${inv.invoiceNumber} al ${args.origen === "confirmada" ? "confirmarla" : "crearla"}` +
        (args.userId ? "" : " (automático, sin usuario)"),
    },
  });
  const e = estadoTrasAbono(inv.total, inv.paid, monto);
  const paidAt = e.status === "PAID" ? ahora : null;
  await tx.invoice.updateMany({
    where: { id: invoiceId, clinicId },
    data: { paid: e.paid, balance: e.balance, status: e.status, ...(paidAt ? { paidAt } : {}) },
  });
  return {
    aplicado: monto,
    restanteAFavor: round2(saldo - monto),
    factura: { paid: e.paid, balance: e.balance, status: e.status, paidAt },
    motivo: null,
  };
}

/**
 * Anticipo que una factura todavía conserva según el libro de patient_credits:
 * lo aplicado menos lo ya devuelto. Solo se llama si la factura tiene algún
 * Payment «anticipo» (sin él no hay nada que mirar, y así una base sin el SQL
 * nuevo nunca llega a consultar columnas que no existen).
 */
export async function anticipoDeLaFactura(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
): Promise<{ aplicacionId: string | null; neto: number }> {
  const filas = await tx.patientCredit.findMany({
    where: { clinicId, invoiceId, source: { in: [FUENTE_APLICADO, FUENTE_DEVUELTO] } },
    select: { id: true, amount: true, source: true },
  });
  let neto = 0;
  let aplicacionId: string | null = null;
  for (const f of filas) {
    if (f.source === FUENTE_APLICADO) {
      neto += -f.amount;
      aplicacionId = f.id;
    } else {
      neto -= f.amount;
    }
  }
  return { aplicacionId, neto: round2(neto) };
}

/**
 * Cancelar una factura que tiene anticipo aplicado. Corre DENTRO de la
 * transacción de /cancel, con la factura ya bloqueada (FOR UPDATE) y leída.
 *
 * Devuelve el anticipo al saldo a favor con una fila POSITIVA que apunta a la
 * aplicación (`reversesId`, único: una aplicación se devuelve una sola vez) y
 * lo saca de la factura con un Payment «refund», igual que un reembolso, para
 * que `paid` vuelva a 0 y el movimiento se vea en la factura.
 *
 * `error` ≠ null → no se cancela (hay pagos que no son anticipo).
 */
export async function devolverAnticipoAlCancelar(
  tx: Tx,
  args: {
    clinicId: string;
    invoice: { id: string; patientId: string; invoiceNumber: string; paid: number };
    userId: string | null;
    ahora?: Date;
  },
): Promise<{ devuelto: number; error: string | null }> {
  const { clinicId, invoice } = args;
  const ahora = args.ahora ?? new Date();
  const ant = await anticipoDeLaFactura(tx, clinicId, invoice.id);
  const { devolver, otrosPagos } = repartoAlCancelar(invoice.paid, ant.neto);
  if (otrosPagos > 0) {
    return {
      devuelto: 0,
      error: `Esta factura tiene $${otrosPagos.toFixed(2)} pagados además del anticipo — reembolsa esos pagos primero`,
    };
  }
  if (devolver <= 0 || !ant.aplicacionId) return { devuelto: 0, error: null };

  await tx.patientCredit.create({
    data: {
      clinicId,
      patientId: invoice.patientId,
      amount: devolver,
      source: FUENTE_DEVUELTO,
      invoiceId: invoice.id,
      reversesId: ant.aplicacionId,
      createdById: args.userId,
      creditDate: ahora,
      description: `Devuelto a favor al cancelar la factura ${invoice.invoiceNumber}`,
    },
  });
  await tx.payment.create({
    data: {
      invoiceId: invoice.id,
      amount: devolver,
      method: "refund",
      notes: "Anticipo devuelto al saldo a favor del paciente (factura cancelada)",
      paidAt: ahora,
    },
  });
  return { devuelto: devolver, error: null };
}
