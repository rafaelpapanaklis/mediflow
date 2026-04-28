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
 *
 * Defensivo: cualquier error del DB se captura y se devuelve como JSON
 * estructurado para que el cliente pueda mostrar UI específica en vez
 * de quedarse colgado en "Cargando…".
 */
export async function GET(req: NextRequest, { params }: Params) {
  const slug = (params.slug ?? "").toLowerCase();
  if (!slug) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
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
    if (!clinic) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!clinic.liveModeEnabled) {
      return NextResponse.json(
        {
          error: "disabled",
          hint: "El owner de esta clínica aún no habilitó la vista pública.",
        },
        { status: 404 },
      );
    }

    // Si tiene password, requerir cookie unlock. Si responde 401, limpia
    // proactivamente cookies con paths legacy.
    if (clinic.liveModePassword) {
      const cookie = cookies().get(liveCookieName(slug));
      if (cookie?.value !== "1") {
        const res = NextResponse.json({ error: "locked" }, { status: 401 });
        res.cookies.set(liveCookieName(slug), "", { path: `/live/${slug}`, maxAge: 0 });
        res.cookies.set(liveCookieName(slug), "", { path: "/", maxAge: 0 });
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

    /**
     * Cada query se envuelve en safe() — si falla por tabla/columna
     * faltante (P2021/P2022), devuelve un fallback en lugar de crashear
     * el endpoint entero. Esto permite a una clínica nueva sin
     * ClinicLayout, sin Resources(CHAIR) y sin Appointments cargar la
     * vista pública con un estado "vacío" que el cliente puede manejar.
     */
    const isMissingSchema = (e: unknown): boolean => {
      const code = (e as { code?: string })?.code;
      return code === "P2021" || code === "P2022" || code === "42P01" || code === "42703";
    };
    const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (isMissingSchema(e)) return fallback;
        throw e;
      }
    };

    const [layout, chairs, appointments] = await Promise.all([
      safe(
        () => prisma.clinicLayout.findUnique({ where: { clinicId: clinic.id } }),
        null as { elements: unknown; metadata: unknown } | null,
      ),
      safe(
        () =>
          prisma.resource.findMany({
            where: { clinicId: clinic.id, kind: "CHAIR", isActive: true },
            select: { id: true, name: true, color: true, orderIndex: true },
            orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
          }),
        [] as Array<{ id: string; name: string; color: string | null; orderIndex: number }>,
      ),
      safe(
        () =>
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
        [] as Array<{
          id: string;
          resourceId: string | null;
          startsAt: Date;
          endsAt: Date;
          checkedInAt: Date | null;
          type: string;
          status: string;
          notes: string | null;
          patient: { firstName: string; lastName: string } | null;
          doctor: { firstName: string; lastName: string } | null;
        }>,
      ),
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
  } catch (err) {
    // Si llegamos acá, falló algo crítico que safe() no capturó (ej. el
    // findUnique inicial de clinic, columna liveModeSlug ausente).
    const code = (err as { code?: string })?.code;
    if (code === "P2022" || code === "42703") {
      // Columna no existe — falta migración del modelo Clinic con los
      // 4 campos liveMode*.
      return NextResponse.json(
        {
          error: "schema_not_migrated",
          hint: "Las columnas liveMode* de clinics no existen. Aplica la migración 20260428100000_clinic_layout en Supabase.",
        },
        { status: 503 },
      );
    }
    if (code === "P2021" || code === "42P01") {
      return NextResponse.json(
        {
          error: "table_missing",
          hint: "Una tabla del schema de live mode no existe. Aplica la migración 20260428100000_clinic_layout en Supabase.",
        },
        { status: 503 },
      );
    }
    console.error("[GET /api/live/" + slug + "]", err);
    return NextResponse.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
