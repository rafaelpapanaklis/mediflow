import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";
import type {
  BatchValidateInput,
  BatchValidateResult,
} from "@/lib/agenda/types";

export async function POST(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  let body: BatchValidateInput;
  try {
    body = (await req.json()) as BatchValidateInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (
    body.action !== "confirm" &&
    body.action !== "reject"
  ) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  if (!Array.isArray(body.appointmentIds) || body.appointmentIds.length === 0) {
    return NextResponse.json({ error: "missing_ids" }, { status: 400 });
  }
  if (body.appointmentIds.length > 50) {
    return NextResponse.json({ error: "too_many_ids" }, { status: 400 });
  }

  const candidates = await prisma.appointment.findMany({
    where: {
      id: { in: body.appointmentIds },
      clinicId: session.clinic.id,
      requiresValidation: true,
      status: "SCHEDULED",
    },
    select: { id: true },
  });
  const validIds = new Set(candidates.map((c) => c.id));

  const result: BatchValidateResult = {
    processed: 0,
    failed: [],
  };

  for (const id of body.appointmentIds) {
    if (!validIds.has(id)) {
      result.failed.push({ id, error: "not_found_or_not_pending" });
      continue;
    }
    try {
      if (body.action === "confirm") {
        await prisma.appointment.update({
          where: { id },
          data: {
            status: "CONFIRMED",
            requiresValidation: false,
          },
        });
      } else {
        await prisma.appointment.update({
          where: { id },
          data: {
            status: "CANCELLED",
            requiresValidation: false,
            cancelReason: body.rejectReason
              ? `[Rechazada] ${body.rejectReason}`
              : "[Rechazada por staff]",
            cancelledAt: new Date(),
          },
        });
      }
      result.processed += 1;
    } catch (err) {
      console.error("[batch-validate] failed", id, err);
      result.failed.push({ id, error: "update_failed" });
    }
  }

  // TODO(M3.b): if body.notifyPatients y session.clinic.waConnected,
  //             enviar notificación a cada paciente afectado.

  return NextResponse.json(result);
}
