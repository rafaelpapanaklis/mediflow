import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { RECIBE_CITAS_WHERE } from "@/lib/agenda/roles-que-atienden";
import { cuerpoDoctorNoRecibeCitasDe } from "@/lib/agenda/roles-que-atienden-db";
import { etiquetaCortaProfesional } from "@/lib/agenda/etiqueta-profesional";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";
import { assertPatientVisible, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import type {
  CreateWaitlistInput,
  WaitlistEntryDTO,
  WaitlistPriority,
} from "@/lib/agenda/types";

// El doctor preferido con el mismo nombre corto que las citas de la Agenda («Mariana C.»,
// etiqueta-profesional.ts). Antes «Dr. » + la primera palabra: «Dr. Dr», «Dr. Cuenta» (revisión de ws1-t10).
function shortName(firstName: string, lastName: string, _category: string): string {
  return etiquetaCortaProfesional({ firstName, lastName });
}

// ─── GET ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const sp = req.nextUrl.searchParams;
  const status = sp.get("status") ?? "active";

  const rows = await prisma.waitlistEntry.findMany({
    where: {
      clinicId: session.clinic.id,
      ...(status === "active"
        ? { resolvedAt: null }
        : status === "resolved"
        ? { resolvedAt: { not: null } }
        : {}),
      ...(session.user.role === "DOCTOR"
        ? { preferredDoctorId: session.user.id }
        : {}),
      // Visibilidad por paciente. Filtro de RELACIÓN porque esto lista las
      // entradas de TODA la clínica, restringidas incluidas.
      AND: relatedPatientVisibilityAnd({
        userId: session.user.id,
        role: session.user.role,
        clinicId: session.clinic.id,
      }),
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      preferredDoctor: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [
      { priority: "desc" },
      { createdAt: "asc" },
    ],
  });

  const entries: WaitlistEntryDTO[] = rows.map((e) => ({
    id: e.id,
    patient: {
      id: e.patient.id,
      name: [e.patient.firstName, e.patient.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
    },
    reason: e.reason,
    priority: e.priority as WaitlistPriority,
    preferredDoctor: e.preferredDoctor
      ? {
          id: e.preferredDoctor.id,
          shortName: shortName(
            e.preferredDoctor.firstName,
            e.preferredDoctor.lastName,
            session.clinic.category,
          ),
        }
      : null,
    preferredWindow: e.preferredWindow,
    notes: e.notes,
    createdAt: e.createdAt.toISOString(),
  }));

  return NextResponse.json({ entries });
}

// ─── POST ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  const forbidden = requireRole(session, [
    "RECEPTIONIST",
    "ADMIN",
    "SUPER_ADMIN",
  ]);
  if (forbidden) return forbidden;

  let body: CreateWaitlistInput;
  try {
    body = (await req.json()) as CreateWaitlistInput;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.patientId) {
    return NextResponse.json({ error: "missing_patientId" }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: body.patientId, clinicId: session.clinic.id },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  }

  // Visibilidad por paciente: no agregar a la lista de espera un paciente restringido.
  const hidden = await assertPatientVisible(body.patientId, {
    userId: session.user.id,
    role: session.user.role,
    clinicId: session.clinic.id,
  });
  if (hidden) return hidden;

  if (body.preferredDoctorId) {
    // Doctor preferido = alguien que puede recibir citas (roles-que-atienden.ts,
    // ws1-t10): el dueño que atiende sí; recepción o quien no aparece en la
    // agenda, no — la cita que saldría de esta entrada no se podría crear.
    const d = await prisma.user.findFirst({
      where: {
        id: body.preferredDoctorId,
        clinicId: session.clinic.id,
        ...RECIBE_CITAS_WHERE,
      },
      select: { id: true },
    });
    if (!d) {
      return NextResponse.json(await cuerpoDoctorNoRecibeCitasDe(session.clinic.id, body.preferredDoctorId), { status: 404 });
    }
  }

  const created = await prisma.waitlistEntry.create({
    data: {
      clinicId: session.clinic.id,
      patientId: body.patientId,
      createdByUserId: session.user.id,
      reason: body.reason ?? null,
      priority: body.priority ?? "NORMAL",
      preferredDoctorId: body.preferredDoctorId ?? null,
      preferredWindow: body.preferredWindow ?? null,
      notes: body.notes ?? null,
    },
    include: {
      patient: { select: { id: true, firstName: true, lastName: true } },
      preferredDoctor: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const entry: WaitlistEntryDTO = {
    id: created.id,
    patient: {
      id: created.patient.id,
      name: [created.patient.firstName, created.patient.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
    },
    reason: created.reason,
    priority: created.priority as WaitlistPriority,
    preferredDoctor: created.preferredDoctor
      ? {
          id: created.preferredDoctor.id,
          shortName: shortName(
            created.preferredDoctor.firstName,
            created.preferredDoctor.lastName,
            session.clinic.category,
          ),
        }
      : null,
    preferredWindow: created.preferredWindow,
    notes: created.notes,
    createdAt: created.createdAt.toISOString(),
  };

  return NextResponse.json({ entry }, { status: 201 });
}
