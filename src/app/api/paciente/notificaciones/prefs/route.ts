// GET /api/paciente/notificaciones/prefs → { prefs } | 401
// PUT /api/paciente/notificaciones/prefs   { prefs: NotifPrefs | null } → { ok, prefs } | 400 | 401
//
// prefs null = "usar la configuración de recordatorios de la clínica" (sin
// override). El cron de recordatorios respeta estas prefs (canal + anticipación)
// SOLO para las citas de este paciente. Se guarda en PatientAccount.notifPrefs.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { parseNotifPrefs, type NotifPrefs } from "@/lib/patient-notifications/types";

export const dynamic = "force-dynamic";

const NOSTORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();
  try {
    const acc = await prisma.patientAccount.findUnique({
      where: { id: ctx.account.id },
      select: { notifPrefs: true },
    });
    const prefs = parseNotifPrefs(acc?.notifPrefs);
    return NextResponse.json({ prefs }, { headers: NOSTORE });
  } catch (err) {
    console.error("[paciente/notificaciones/prefs] GET (¿SQL pendiente?):", err);
    return NextResponse.json({ prefs: null }, { headers: NOSTORE });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await getPatientPortalContext();
  if (!ctx) return pacienteUnauthorized();

  let body: { prefs?: unknown };
  try {
    body = (await req.json()) as { prefs?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // null/undefined explícito = quitar override (usar config de la clínica).
  let value: NotifPrefs | null;
  if (body.prefs === null || body.prefs === undefined) {
    value = null;
  } else {
    const parsed = parseNotifPrefs(body.prefs);
    if (!parsed) {
      return NextResponse.json({ error: "Preferencias inválidas" }, { status: 400 });
    }
    value = parsed;
  }

  try {
    await prisma.patientAccount.update({
      where: { id: ctx.account.id },
      // Json nullable: DbNull guarda NULL real en la columna (no el literal JSON null).
      data: {
        notifPrefs:
          value === null ? Prisma.DbNull : (value as unknown as Prisma.InputJsonObject),
      },
    });
    return NextResponse.json({ ok: true, prefs: value });
  } catch (err) {
    console.error("[paciente/notificaciones/prefs] PUT:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
