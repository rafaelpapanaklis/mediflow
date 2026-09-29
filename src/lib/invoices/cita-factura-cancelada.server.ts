// Facturas — soltar la cita de su factura CANCELADA justo antes de crearle una
// nueva (H1 de la revisión final, ws1-t4). Ver `cita-factura-cancelada.ts`.
//
// Solo toca una factura CANCELADA de ESTA clínica y ligada a ESTA cita (las
// tres condiciones van en el WHERE del update: si entre la lectura y la
// escritura alguien la cambió, no hace nada). Deja rastro en sus notas y en la
// bitácora. Nunca toca importes, pagos ni el estado.

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { notaDeCitaSoltada } from "./cita-factura-cancelada";

export async function soltarFacturaCanceladaDeCita(args: {
  clinicId: string;
  appointmentId: string;
  userId?: string | null;
}): Promise<{ soltada: string | null }> {
  if (!args.clinicId || !args.appointmentId) return { soltada: null };
  const factura = await prisma.invoice.findFirst({
    where: { appointmentId: args.appointmentId, clinicId: args.clinicId },
    select: { id: true, status: true, notes: true },
  });
  if (!factura || factura.status !== "CANCELLED") return { soltada: null };

  const { count } = await prisma.invoice.updateMany({
    where: { id: factura.id, clinicId: args.clinicId, status: "CANCELLED", appointmentId: args.appointmentId },
    data: { appointmentId: null, notes: notaDeCitaSoltada(factura.notes, args.appointmentId, new Date()) },
  });
  if (count === 0) return { soltada: null };

  if (args.userId) {
    await logAudit({
      clinicId: args.clinicId,
      userId: args.userId,
      entityType: "invoice",
      entityId: factura.id,
      action: "update",
      changes: { appointmentId: { before: args.appointmentId, after: null } },
    });
  }
  return { soltada: factura.id };
}
