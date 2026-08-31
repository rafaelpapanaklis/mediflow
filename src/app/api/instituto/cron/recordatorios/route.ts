// ═══════════════════════════════════════════════════════════════════════
// GET /api/instituto/cron/recordatorios → el barrido de RECORDATORIOS DE
// CITA del vertical institucional.
//
// 🔴 ES UN CRON PROPIO. No toca ni reutiliza el del dental
// (/api/cron/appointment-reminders), que encola en WhatsAppReminder y manda
// con el queue-worker sobre las columnas wa* de Clinic. Ese camino no sabe
// nada de EduInstitution y meterle el vertical dentro sería tocar el
// producto que está VIVO en producción.
//
// 🔴 VIVE BAJO /api/instituto/ Y NO BAJO /api/cron/ A PROPÓSITO. La guardia
// del vertical (scripts/edu-guard.cjs) solo indulta cuatro carpetas, y
// src/app/api/cron/ no es una de ellas: un cron del instituto colgado ahí
// sería un archivo del dental escrito por esta rama.
//
// ⚠️ TODAVÍA NO ESTÁ DADO DE ALTA. vercel.json está PROHIBIDO para este
// vertical. La línea EXACTA que hay que agregar a mano está en el reporte de
// ORQUESTA.md — y hasta que esté, el botón "Correr el barrido ahora" de
// /instituto/whatsapp hace lo mismo para UN instituto.
// ═══════════════════════════════════════════════════════════════════════
import { NextResponse, type NextRequest } from "next/server";
import { runEduReminderSweep } from "@/lib/edu/recordatorios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Fail-closed: sin CRON_SECRET en el entorno, un "Bearer undefined"
  // pasaría y dejaría abierto un endpoint que le manda WhatsApp a pacientes
  // reales con cargo a la tarjeta de cada escuela.
  if (!process.env.CRON_SECRET) {
    console.error("[instituto/cron/recordatorios] CRON_SECRET no configurado");
    return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runEduReminderSweep();

  // AuditLog NO sirve aquí: sus columnas clinicId y userId son FK NOT NULL a
  // las tablas del dental y un cron no tiene usuario. La traza de cada envío
  // vive en edu_whatsapp_messages —que es el registro de verdad, con su
  // resultado— y este log estructurado es el resumen del tick, que queda en
  // los logs de Vercel.
  console.log("[instituto/cron/recordatorios]", JSON.stringify(summary));

  return NextResponse.json(summary);
}
