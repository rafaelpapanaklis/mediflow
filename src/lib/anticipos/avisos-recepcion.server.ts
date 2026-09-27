// Aviso a RECEPCIÓN de anticipos del panel (ws1-t3 fase 1) que necesitan
// revisión: pago tardío con el hueco ya perdido (fue a saldo a favor), pago
// sobre una factura ya cancelada o saldada, segundo pago del mismo anticipo…
// Nunca por WhatsApp al paciente — eso es lo que dice el ticket: "avisa a
// RECEPCIÓN en el panel". Se apoya en `AppointmentDepositPayment.anomaly`, el
// MISMO campo que ya usa la pantalla de Configuración → Anticipos para el
// anticipo del bot (pantalla.server.ts); aquí solo se filtra a origin='panel'
// y se hace visible con "billing.view" (recepción), no solo "settings.edit".

// Sin "server-only" a propósito (mismo criterio que servicio.server.ts).
import { prisma } from "@/lib/prisma";

export interface AnticipoPorRevisar {
  depositId: string;
  paciente: string;
  monto: number;
  motivo: string;
  creado: string;
}

/** Tabla o columna que todavía no existe (el SQL va por detrás del deploy). */
function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022";
}

/** Prefijo con el que Payment.notes marca algo que alguien debe revisar (mismo criterio que factura-mp/servicio.server.ts). */
const MARCA_REVISAR = "⚠️";

export async function anticiposPorRevisar(clinicId: string): Promise<AnticipoPorRevisar[]> {
  if (!clinicId) return [];
  try {
    const [delBot, delPanel] = await Promise.all([
      // El anticipo del bot (Mercado Pago): la anomalía vive en
      // AppointmentDepositPayment.anomaly (segundo pago, hueco perdido…).
      prisma.appointmentDepositPayment.findMany({
        where: { clinicId, anomaly: { not: null }, deposit: { origin: "panel" } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          amount: true,
          anomaly: true,
          createdAt: true,
          deposit: { select: { id: true, patient: { select: { firstName: true, lastName: true } } } },
        },
      }),
      // ws1-t3 fase 2 — "Registrar anticipo recibido" (efectivo, transferencia,
      // terminal): no hay AppointmentDepositPayment (no pasa por el webhook de
      // Mercado Pago); la anomalía —si la cita ya no se pudo confirmar sola—
      // queda en Payment.notes, marcada con el mismo "⚠️" que usa
      // aplicarPagoDeFactura. Se buscan los depósitos PAID manual/transferencia
      // con paymentId y se filtra por esa marca.
      anticiposManualesPorRevisar(clinicId),
    ]);
    const combinados = [
      ...delBot.map((f) => ({
        depositId: f.deposit.id,
        paciente: `${f.deposit.patient.firstName} ${f.deposit.patient.lastName ?? ""}`.trim(),
        monto: f.amount,
        motivo: f.anomaly ?? "",
        creado: f.createdAt.toISOString(),
      })),
      ...delPanel,
    ];
    combinados.sort((a, b) => (a.creado < b.creado ? 1 : -1));
    return combinados.slice(0, 20);
  } catch (e) {
    if (faltaTabla(e)) return [];
    throw e;
  }
}

async function anticiposManualesPorRevisar(clinicId: string): Promise<AnticipoPorRevisar[]> {
  const depositos = await prisma.appointmentDeposit.findMany({
    where: { clinicId, origin: "panel", method: { in: ["manual", "transferencia"] }, status: "PAID", paymentId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, paymentId: true, createdAt: true, patient: { select: { firstName: true, lastName: true } } },
  });
  if (depositos.length === 0) return [];
  const pagos = await prisma.payment.findMany({
    where: { id: { in: depositos.map((d) => d.paymentId as string) }, notes: { contains: MARCA_REVISAR } },
    select: { id: true, amount: true, notes: true },
  });
  const porPaymentId = new Map(pagos.map((p) => [p.id, p]));
  return depositos
    .filter((d) => d.paymentId && porPaymentId.has(d.paymentId))
    .map((d) => {
      const pago = porPaymentId.get(d.paymentId as string)!;
      return {
        depositId: d.id,
        paciente: `${d.patient.firstName} ${d.patient.lastName ?? ""}`.trim(),
        monto: pago.amount,
        motivo: (pago.notes ?? "").replace(MARCA_REVISAR, "").trim(),
        creado: d.createdAt.toISOString(),
      };
    });
}
