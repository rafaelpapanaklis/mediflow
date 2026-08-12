// Presentar un presupuesto (DRAFT/EXPIRED → PRESENTED) con su liga pública.
//
// Extraído del endpoint /api/quotes/[id]/status para que "Enviar por WhatsApp"
// pueda presentar un borrador ANTES de mandar la liga sin duplicar estas
// reglas: token estable (no se regenera si ya existe), vigencia futura
// asegurada y rastro en la auditoría. La clínica y el usuario vienen SIEMPRE
// de la sesión del caller, nunca del request.

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

// Interfaz plana y no union discriminado: tsconfig no está en strict y sin
// strictNullChecks `if (!r.ok)` NO estrecha el tipo — los campos opcionales
// evitan pelear con el checker en cada caller.
export interface PresentQuoteOutcome {
  ok: boolean;
  /** El quote actualizado (con los includes de serializeQuote). Presente si ok. */
  quote?: any;
  /** HTTP y motivo del rechazo. Presentes si !ok. */
  httpStatus?: number;
  error?: string;
}

/**
 * Pasa el presupuesto a PRESENTED: genera `acceptToken` (la liga pública
 * /presupuesto/[token]) si no existía y asegura una vigencia futura (+30 días
 * si faltaba o ya venció). `current` es la fila que el caller YA cargó con su
 * scope de clínica — aquí no se vuelve a consultar para no repetir el gate.
 *
 * Devuelve el quote actualizado con los mismos includes que espera
 * `serializeQuote` (items ordenados, createdBy y patient).
 */
export async function presentQuote(args: {
  current: { id: string; status: string; acceptToken: string | null; validUntil: Date | string | null };
  clinicId: string;
  userId: string;
}): Promise<PresentQuoteOutcome> {
  const { current } = args;

  if (current.status === "ACCEPTED" || current.status === "REJECTED") {
    return { ok: false, httpStatus: 409, error: "El presupuesto ya está cerrado" };
  }

  const now = new Date();
  const data: any = { status: "PRESENTED", presentedAt: now };
  if (!current.acceptToken) data.acceptToken = randomBytes(20).toString("hex");
  const vu = current.validUntil ? new Date(current.validUntil) : null;
  if (!vu || vu.getTime() <= now.getTime()) {
    data.validUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  const updated = await prisma.quote.update({
    where: { id: current.id },
    data,
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      createdBy: { select: { firstName: true, lastName: true } },
      patient: { select: { firstName: true, lastName: true } },
    },
  });

  await logAudit({
    clinicId: args.clinicId,
    userId: args.userId,
    entityType: "quote",
    entityId: current.id,
    action: "update",
    changes: { status: { before: current.status, after: updated.status } },
  });

  return { ok: true, quote: updated };
}
