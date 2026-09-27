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

export async function anticiposPorRevisar(clinicId: string): Promise<AnticipoPorRevisar[]> {
  if (!clinicId) return [];
  try {
    const filas = await prisma.appointmentDepositPayment.findMany({
      where: { clinicId, anomaly: { not: null }, deposit: { origin: "panel" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        amount: true,
        anomaly: true,
        createdAt: true,
        deposit: { select: { id: true, patient: { select: { firstName: true, lastName: true } } } },
      },
    });
    return filas.map((f) => ({
      depositId: f.deposit.id,
      paciente: `${f.deposit.patient.firstName} ${f.deposit.patient.lastName ?? ""}`.trim(),
      monto: f.amount,
      motivo: f.anomaly ?? "",
      creado: f.createdAt.toISOString(),
    }));
  } catch (e) {
    if (faltaTabla(e)) return [];
    throw e;
  }
}
