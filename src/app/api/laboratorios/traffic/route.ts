import { type NextRequest, NextResponse } from "next/server";
import { getDentalLabContext } from "@/lib/lab-auth";
import { prisma } from "@/lib/prisma";
import { DENTAL_LAB_TRAFFIC, type DentalLabTrafficLevel } from "@/lib/laboratorios/types";

export const dynamic = "force-dynamic";

// Niveles válidos derivados del catálogo canónico de types.ts (no reinventados).
const TRAFFIC_LEVELS = Object.keys(DENTAL_LAB_TRAFFIC) as DentalLabTrafficLevel[];

const NOTE_MAX = 500;

// Minutos manuales opcionales: undefined = no tocar; null/"" = limpiar;
// entero 0..100000. Devuelve { value } o { error } para distinguir un valor
// inválido de un null legítimo. Rechaza floats (no los trunca en silencio).
function readMinutes(v: unknown): { value: number | null | undefined } | { error: string } {
  if (v === undefined) return { value: undefined };
  if (v === null || v === "") return { value: null };
  const num = Number(v);
  if (!Number.isInteger(num) || num < 0 || num > 100000) {
    return { error: "Los minutos manuales deben ser un número entero entre 0 y 100000." };
  }
  return { value: num };
}

// PATCH /api/laboratorios/traffic → fija el nivel de tráfico del lab en sesión
// y registra el cambio en DentalLabTrafficHistory. labId SIEMPRE de la sesión,
// nunca del body. Solo OWNER/MANAGER de una cuenta APPROVED.
export async function PATCH(req: NextRequest) {
  const ctx = await getDentalLabContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
    return NextResponse.json(
      { error: "No tienes permiso para cambiar el nivel de tráfico." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const level = b.level;
  if (typeof level !== "string" || !TRAFFIC_LEVELS.includes(level as DentalLabTrafficLevel)) {
    return NextResponse.json({ error: "Nivel de tráfico inválido." }, { status: 400 });
  }
  const toLevel = level as DentalLabTrafficLevel;

  const min = readMinutes(b.manualMin);
  if ("error" in min) return NextResponse.json({ error: min.error }, { status: 400 });
  const max = readMinutes(b.manualMax);
  if ("error" in max) return NextResponse.json({ error: max.error }, { status: 400 });
  if (typeof min.value === "number" && typeof max.value === "number" && min.value > max.value) {
    return NextResponse.json(
      { error: "Los minutos mínimos no pueden ser mayores que los máximos." },
      { status: 400 },
    );
  }

  const note = typeof b.note === "string" ? b.note.trim() : undefined;
  if (note !== undefined && note.length > NOTE_MAX) {
    return NextResponse.json(
      { error: `La nota no puede exceder ${NOTE_MAX} caracteres.` },
      { status: 400 },
    );
  }

  // Lectura del nivel previo + escrituras en una sola transacción interactiva,
  // para que fromLevel refleje el estado real al momento del cambio (sin TOCTOU).
  const lab = await prisma.$transaction(async (tx) => {
    const current = await tx.dentalLab.findUnique({
      where: { id: ctx.labId },
      select: { trafficLevel: true },
    });
    if (!current) return null;

    await tx.dentalLabTrafficHistory.create({
      data: {
        labId: ctx.labId,
        fromLevel: current.trafficLevel,
        toLevel,
        source: "MANUAL",
        byUserId: ctx.labUserId,
        byName: ctx.lab.name,
        note: note || null,
      },
    });

    return tx.dentalLab.update({
      where: { id: ctx.labId },
      data: {
        trafficLevel: toLevel,
        ...(min.value !== undefined ? { trafficManualMin: min.value } : {}),
        ...(max.value !== undefined ? { trafficManualMax: max.value } : {}),
        ...(note !== undefined ? { trafficNote: note || null } : {}),
        trafficUpdatedAt: new Date(),
      },
    });
  });

  if (!lab) {
    return NextResponse.json({ error: "Laboratorio no encontrado." }, { status: 404 });
  }

  return NextResponse.json(lab);
}
