// ─────────────────────────────────────────────────────────────────────────────
// A8 — GET /api/clinic-layout/3d-state — estado VIVO del visor 3D, anclado al
// clinicId de la sesión del dashboard (multi-tenant estricto). Sin cache.
//
// TODO(A8): implementar el GET según este brief. Reusa el patrón EXACTO de
// src/app/api/clinic-layout/route.ts (getDbUser, isMissingTable, Prisma) y la
// lógica de armado de citas de hoy de src/app/api/live/[slug]/route.ts.
//
// AUTENTICACIÓN: getDbUser() (abajo, ya copiado del route hermano). Si null →
//   401 { error: "unauthorized" }. clinicId SIEMPRE = dbUser.clinicId (NUNCA de
//   query/body).
//
// DATOS (Promise.all, ≤7):
//   1) clinic = prisma.clinic.findUnique({ where: { id: clinicId },
//        select: { name, category } }).
//   2) layout = prisma.clinicLayout.findUnique({ where: { clinicId },
//        select: { elements, metadata } }).
//   3) chairs (Resources) = prisma.resource.findMany({ where: { clinicId,
//        kind: { in: [...TREATMENT_KINDS] }, isActive: true },
//        select: { id, name, color, orderIndex },
//        orderBy: [{ orderIndex: "asc" }, { name: "asc" }] }).
//   4) appts = citas de HOY: prisma.appointment.findMany({ where: { clinicId,
//        startsAt: { gte: dayStart, lte: dayEnd },
//        status: { notIn: ["CANCELLED","NO_SHOW"] } },
//        orderBy: { startsAt: "asc" },
//        select: { id, resourceId, startsAt, endsAt, status, type,
//          patient: { select: { firstName, lastName } },
//          doctor:  { select: { firstName, lastName } } } }).
//      Rango del día = MISMO patrón que live: hoy 00:00:00 → 23:59:59.999 local.
//
// NORMALIZA appts → LiveAppointment[] (de element-types): { id, resourceId,
//   patient: "Nombre Apellido", doctor: "Nombre Apellido" | "—", treatment:
//   type ?? "Consulta", start: new Date(startsAt), end: new Date(endsAt),
//   status }. (No exponemos notes: privacidad NOM-024.)
//
// PARA CADA chair (Resource): const now = new Date();
//   status = getChairStatus(chair.id, now, liveAppts);
//   active = getChairAppointment(chair.id, now, liveAppts);
//   Chair3DState = {
//     elementId: (id del LayoutElement sillon con resourceId === chair.id, si lo
//       hay; si no, null) — recorre sanitizeElements(layout.elements) para
//       encontrarlo,
//     resourceId: chair.id, name: chair.name, color: chair.color ?? null,
//     status,
//     patientName: status === "ocupado" ? (active?.patient ?? null) : null,
//     doctorName:  status === "ocupado" ? (active?.doctor ?? null) : null,
//     appointmentEndsAt: status === "ocupado" && active ? active.end.toISOString() : null,
//   }.
//   (Privacidad: solo exponemos nombre de paciente cuando está OCUPADO — es el
//    panel privado del dueño, no la vista pública; aun así no mandamos datos de
//    sillones libres.)
//
// RESPUESTA Clinic3DStatePayload {
//   clinicName: clinic?.name ?? "Mi clínica",
//   category: clinic?.category ?? "DENTAL",
//   layout: { elements: sanitizeElements(layout?.elements),
//             metadata: sanitizeMetadata(layout?.metadata) },
//   chairs: Chair3DState[],
// } con headers { "Cache-Control": "no-store" }.
//
// ERRORES: isMissingTable(err) → 503 { error: "schema_not_migrated" }. Otro →
//   500 { error: "internal_error" } + console.error("[GET /api/clinic-layout/3d-state]", err).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { readActiveClinicCookie } from "@/lib/active-clinic";
import { TREATMENT_KINDS } from "@/lib/agenda/types";
import { getChairStatus, getChairAppointment } from "@/lib/floor-plan/live-mode";
import { sanitizeElements, sanitizeMetadata } from "@/lib/floor-plan/sanitize";
import { isChairType } from "@/components/clinic-3d/world-types";
import type { Chair3DState, Clinic3DStatePayload } from "@/components/clinic-3d/world-types";
import type { LiveAppointment, LiveApptStatus } from "@/lib/floor-plan/element-types";

export const dynamic = "force-dynamic";

async function getDbUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const activeClinicId = readActiveClinicCookie();
  if (activeClinicId) {
    const u = await prisma.user.findFirst({
      where: { supabaseId: user.id, clinicId: activeClinicId, isActive: true },
    });
    if (u) return u;
  }
  return prisma.user.findFirst({
    where: { supabaseId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

function isMissingTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string };
  return e.code === "P2021" || e.code === "P2022" || e.code === "42P01" || e.code === "42703";
}

export async function GET() {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const clinicId = dbUser.clinicId;

    // Rango de HOY (00:00:00 → 23:59:59.999 local). Mismo patrón que
    // src/app/api/live/[slug]/route.ts.
    const today = new Date();
    const dayStart = new Date(today);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(today);
    dayEnd.setHours(23, 59, 59, 999);

    const [clinic, layout, chairs, appts] = await Promise.all([
      prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { name: true, category: true },
      }),
      prisma.clinicLayout.findUnique({
        where: { clinicId },
        select: { elements: true, metadata: true },
      }),
      prisma.resource.findMany({
        where: { clinicId, kind: { in: [...TREATMENT_KINDS] }, isActive: true },
        select: { id: true, name: true, color: true, orderIndex: true },
        orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      }),
      prisma.appointment.findMany({
        where: {
          clinicId,
          startsAt: { gte: dayStart, lte: dayEnd },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          resourceId: true,
          startsAt: true,
          endsAt: true,
          status: true,
          type: true,
          patient: { select: { firstName: true, lastName: true } },
          doctor: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    // Normaliza appts → LiveAppointment[]. No exponemos `notes` (PHI, NOM-024).
    const liveAppts: LiveAppointment[] = appts.map((a) => ({
      id: a.id,
      resourceId: a.resourceId,
      patient:
        `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() ||
        "Paciente",
      doctor:
        `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "—",
      treatment: a.type ?? "Consulta",
      start: new Date(a.startsAt),
      end: new Date(a.endsAt),
      status: (a.status as LiveApptStatus) ?? undefined,
    }));

    // Mapa resourceId → elementId del sillón colocado en el layout (si existe).
    const elements = sanitizeElements(layout?.elements);
    const elementByResource = new Map<string, number>();
    for (const el of elements) {
      if (el.resourceId && isChairType(el.type) && !elementByResource.has(el.resourceId)) {
        elementByResource.set(el.resourceId, el.id);
      }
    }

    const now = new Date();
    const chairStates: Chair3DState[] = chairs.map((chair) => {
      const status = getChairStatus(chair.id, now, liveAppts);
      const active = getChairAppointment(chair.id, now, liveAppts);
      const occupied = status === "ocupado";
      return {
        elementId: elementByResource.get(chair.id) ?? null,
        resourceId: chair.id,
        name: chair.name,
        color: chair.color ?? null,
        status,
        patientName: occupied ? active?.patient ?? null : null,
        doctorName: occupied ? active?.doctor ?? null : null,
        appointmentEndsAt: occupied && active ? active.end.toISOString() : null,
      };
    });

    const payload: Clinic3DStatePayload = {
      clinicName: clinic?.name ?? "Mi clínica",
      category: clinic?.category ?? "DENTAL",
      layout: {
        elements,
        metadata: sanitizeMetadata(layout?.metadata),
      },
      chairs: chairStates,
    };
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isMissingTable(err)) {
      return NextResponse.json({ error: "schema_not_migrated" }, { status: 503 });
    }
    console.error("[GET /api/clinic-layout/3d-state]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
