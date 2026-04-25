import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  loadClinicSession,
  requireRole,
} from "@/lib/agenda/api-helpers";
import type {
  CreateWaitlistInput,
  WaitlistEntryDTO,
  WaitlistPriority,
} from "@/lib/agenda/types";

const NON_MEDICAL = [
  "SPA",
  "MASSAGE",
  "BEAUTY_CENTER",
  "NAIL_SALON",
  "HAIR_SALON",
  "BROW_LASH",
  "LASER_HAIR_REMOVAL",
];

function shortName(firstName: string, _lastName: string, category: string): string {
  const first = firstName.split(/\s+/)[0] ?? firstName;
  return NON_MEDICAL.includes(category) ? first : `Dr. ${first}`;
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

  if (body.preferredDoctorId) {
    const d = await prisma.user.findFirst({
      where: {
        id: body.preferredDoctorId,
        clinicId: session.clinic.id,
        role: "DOCTOR",
      },
      select: { id: true },
    });
    if (!d) {
      return NextResponse.json({ error: "doctor_not_found" }, { status: 404 });
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
