import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { revalidateAfter } from "@/lib/cache/revalidate";

// dayOfWeek 0=Lunes ... 6=Domingo (misma convención que el seed del registro).
const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function PATCH(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // SECURITY: solo admins pueden modificar los horarios de atención (mismo
  // gate que la configuración de la clínica en /api/clinic).
  if (!ctx.isAdmin) {
    return NextResponse.json(
      { error: "Solo administradores pueden modificar los horarios" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const schedules = body?.schedules;
  if (!Array.isArray(schedules) || schedules.length !== 7) {
    return NextResponse.json(
      { error: "Se esperan los 7 días de la semana" },
      { status: 400 },
    );
  }

  const seen = new Set<number>();
  const rows: { dayOfWeek: number; enabled: boolean; openTime: string; closeTime: string }[] = [];
  for (const item of schedules) {
    const dayOfWeek = item?.dayOfWeek;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return NextResponse.json(
        { error: "dayOfWeek debe ser un entero entre 0 y 6" },
        { status: 400 },
      );
    }
    if (seen.has(dayOfWeek)) {
      return NextResponse.json(
        { error: `Día duplicado: ${DAY_NAMES[dayOfWeek]}` },
        { status: 400 },
      );
    }
    seen.add(dayOfWeek);

    const enabled = Boolean(item.enabled);
    const { openTime, closeTime } = item;
    if (
      typeof openTime !== "string" || !TIME_RE.test(openTime) ||
      typeof closeTime !== "string" || !TIME_RE.test(closeTime)
    ) {
      return NextResponse.json(
        { error: `Horario inválido en ${DAY_NAMES[dayOfWeek]} (formato HH:MM)` },
        { status: 400 },
      );
    }
    if (enabled && openTime >= closeTime) {
      return NextResponse.json(
        { error: `En ${DAY_NAMES[dayOfWeek]} la apertura debe ser antes del cierre` },
        { status: 400 },
      );
    }
    rows.push({ dayOfWeek, enabled, openTime, closeTime });
  }

  // Upsert de las 7 filas — los días deshabilitados también quedan como fila
  // (enabled=false explícito), no como ausencia: la disponibilidad pública
  // distingue "cerrado" de "sin configurar". Orden determinista por dayOfWeek.
  rows.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  await prisma.$transaction(
    rows.map((r) =>
      prisma.clinicSchedule.upsert({
        where: { clinicId_dayOfWeek: { clinicId: ctx.clinicId, dayOfWeek: r.dayOfWeek } },
        update: { enabled: r.enabled, openTime: r.openTime, closeTime: r.closeTime },
        create: { clinicId: ctx.clinicId, ...r },
      }),
    ),
  );

  revalidateAfter("clinic");
  return NextResponse.json({ ok: true });
}
