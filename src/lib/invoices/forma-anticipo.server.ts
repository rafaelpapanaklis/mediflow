// ¿Con qué forma de pago entró el saldo a favor de un paciente? (ws1-t4, tanda 0)
//
// Un pago «anticipo» de una factura no es dinero nuevo: es saldo a favor que
// entró antes por otro lado. Su forma SAT es la de ese dinero. El saldo a favor
// es un libro (patient_credits) donde las filas positivas dicen de dónde salió
// cada peso, pero no cuál se gastó primero; por eso solo se propone una forma
// si TODO lo que entró a favor del paciente salió de la misma. Si no, null y
// el formulario obliga a escoger.
//
// Orígenes que se saben leer:
//   · excedente de un cobro de ortodoncia → el Payment del excedente (paymentId);
//   · cita cancelada que dejó su dinero a favor → los cobros de esa factura.
// Cualquier otro (Mercado Pago, saldo migrado, devoluciones…) = no se sabe.

import { FUENTE_EXCEDENTE } from "@/lib/patient-credit-core";
import { formaDeMetodo, formaDeOrigenes, formaDePagoSat } from "./cfdi-reglas";

/** Misma constante que lib/anticipos/cita-cancelada.server.ts (aquí sin importar el servicio entero). */
const FUENTE_CITA_CANCELADA = "cita_cancelada";

type Db = {
  patientCredit: { findMany: (args: any) => Promise<any[]> };
  payment: { findMany: (args: any) => Promise<any[]> };
};

export async function formaDeAnticipoDelPaciente(
  db: Db,
  args: { clinicId: string; patientId: string | null | undefined },
): Promise<string | null> {
  if (!args.clinicId || !args.patientId) return null;
  try {
    const entradas = await db.patientCredit.findMany({
      where: { clinicId: args.clinicId, patientId: args.patientId, amount: { gt: 0 } },
      select: { source: true, paymentId: true, invoiceId: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (entradas.length === 0) return null;

    const idsPago = entradas.filter((e) => e.source === FUENTE_EXCEDENTE && e.paymentId).map((e) => e.paymentId as string);
    const idsFactura = entradas.filter((e) => e.source === FUENTE_CITA_CANCELADA && e.invoiceId).map((e) => e.invoiceId as string);
    const pagos = idsPago.length > 0 || idsFactura.length > 0
      ? await db.payment.findMany({
          where: {
            invoice: { clinicId: args.clinicId },
            OR: [
              ...(idsPago.length > 0 ? [{ id: { in: idsPago } }] : []),
              ...(idsFactura.length > 0 ? [{ invoiceId: { in: idsFactura } }] : []),
            ],
          },
          select: { id: true, invoiceId: true, method: true, amount: true },
        })
      : [];

    const origenes = entradas.map((e): string | null => {
      if (e.source === FUENTE_EXCEDENTE && e.paymentId) {
        const p = pagos.find((x) => x.id === e.paymentId);
        return p ? formaDeMetodo(p.method) : null;
      }
      if (e.source === FUENTE_CITA_CANCELADA && e.invoiceId) {
        const deEsa = pagos.filter((x) => x.invoiceId === e.invoiceId && x.method !== "anticipo");
        return formaDePagoSat(deEsa.map((x) => ({ method: x.method, amount: Number(x.amount) })));
      }
      return null;
    });
    return formaDeOrigenes(origenes);
  } catch (e: any) {
    // Sin las columnas del libro (SQL sin aplicar) no se sabe: que escojan.
    if (e?.code === "P2021" || e?.code === "P2022") return null;
    throw e;
  }
}
