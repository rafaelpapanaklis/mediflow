import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { liveCookieName } from "@/lib/floor-plan/live-config";

export const dynamic = "force-dynamic";

interface Params { params: { slug: string } }

/**
 * GET /api/live/[slug]
 * Endpoint público (sin auth) que devuelve los datos necesarios para la
 * vista En Vivo: layout + chairs + appointments del día. Si la clínica
 * tiene liveModePassword set, requiere cookie unlock; si no, abierto.
 *
 * Filtra info sensible según liveModeShowPatientNames.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const slug = (params.slug ?? "").toLowerCase();
  if (!slug) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const clinic = await prisma.clinic.findUnique({
    where: { liveModeSlug: slug },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      city: true,
      liveModeEnabled: true,
      liveModePassword: true,
      liveModeShowPatientNames: true,
    },
  });
  if (!clinic || !clinic.liveModeEnabled) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Si tiene password, requerir cookie unlock. Si responde 401, limpia
  // proactivamente cookies con paths legacy (los antiguos quedaban con
  // path /live/<slug> y no llegaban al endpoint API). Esto fuerza al
  // browser a olvidarlas y el siguiente reload del page mostrará el
  // PasswordGate en vez de un loop.
  if (clinic.liveModePassword) {
    const cookie = cookies().get(liveCookieName(slug));
    if (cookie?.value !== "1") {
      const res = NextResponse.json({ error: "locked" }, { status: 401 });
      res.cookies.set(liveCookieName(slug), "", {
        path: `/live/${slug}`,
        maxAge: 0,
      });
      res.cookies.set(liveCookieName(slug), "", {
        path: "/",
        maxAge: 0,
      });
      return res;
    }
  }

  const dateStr = req.nextUrl.searchParams.get("date");
  const today = new Date();
  let dayStart: Date;
  let dayEnd: Date;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    dayStart = new Date(`${dateStr}T00:00:00`);
    dayEnd = new Date(`${dateStr}T23:59:59`);
  } else {
    dayStart = new Date(today);
    dayStart.setHours(0, 0, 0, 0);
    dayEnd = new Date(today);
    dayEnd.setHours(23, 59, 59, 999);
  }

  const [layout, chairs, appointments] = await Promise.all([
    prisma.clinicLayout.findUnique({ where: { clinicId: clinic.id } }),
    prisma.resource.findMany({
      where: { clinicId: clinic.id, kind: "CHAIR", isActive: true },
      select: { id: true, name: true, color: true, orderIndex: true },
      orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
    }),
    prisma.appointment.findMany({
      where: {
        clinicId: clinic.id,
        startsAt: { gte: dayStart, lte: dayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        resourceId: true,
        startsAt: true,
        endsAt: true,
        checkedInAt: true,
        type: true,
        status: true,
        notes: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const showFull = clinic.liveModeShowPatientNames;
  const maskInitials = (full: string) => {
    return (
      full
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join(".") + "."
    );
  };

  // Privacy: si showPatientNames=false, devolver iniciales únicamente — el
  // cliente nunca recibe el nombre completo (defensa en profundidad).
  const liveAppointments = appointments
    .filter((a) => a.resourceId)
    .map((a) => {
      const fullName = `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() || "Paciente";
      return {
        id: a.id,
        resourceId: a.resourceId,
        patient: showFull ? fullName : maskInitials(fullName),
        ...(showFull ? { patientFull: fullName } : {}),
        treatment: a.type || a.notes || "Consulta",
        doctor: `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "—",
        start: a.startsAt.toISOString(),
        end: a.endsAt.toISOString(),
        status: a.status,
      };
    });

  // Sala de espera (pacientes CHECKED_IN sin sillón aún).
  const waitingRoom = appointments
    .filter((a) => a.status === "CHECKED_IN")
    .sort((a, b) => {
      const ta = a.checkedInAt?.getTime() ?? a.startsAt.getTime();
      const tb = b.checkedInAt?.getTime() ?? b.startsAt.getTime();
      return ta - tb;
    })
    .map((a) => {
      const fullName = `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() || "Paciente";
      return {
        id: a.id,
        patient: showFull ? fullName : maskInitials(fullName),
        treatment: a.type || a.notes || "Consulta",
        doctor: `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "—",
        checkedInAt: a.checkedInAt?.toISOString() ?? null,
        scheduledAt: a.startsAt.toISOString(),
      };
    });

  return NextResponse.json({
    clinic: {
      id: clinic.id,
      name: clinic.name,
      logoUrl: clinic.logoUrl ?? null,
      city: clinic.city ?? null,
      showPatientNames: showFull,
    },
    layout: {
      elements: (layout?.elements ?? []) as unknown,
      metadata: layout?.metadata ?? null,
    },
    chairs,
    appointments: liveAppointments,
    waitingRoom,
  });
}
