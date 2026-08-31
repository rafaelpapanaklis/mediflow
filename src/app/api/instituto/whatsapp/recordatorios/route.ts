import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard } from "@/lib/edu/api-guard";
import { runEduReminderSweep } from "@/lib/edu/recordatorios";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/instituto/whatsapp/recordatorios — corre el barrido AHORA, solo
 * para ESTE instituto.
 *
 * Existe por una razón muy concreta y temporal: el cron
 * (/api/instituto/cron/recordatorios) todavía no está dado de alta, porque
 * vercel.json está fuera del vertical y no se toca desde aquí. Sin este
 * botón, la única forma de comprobar que la conexión funciona sería esperar
 * al día siguiente.
 *
 * 🔴 institutionId de la SESIÓN. El barrido acepta uno acotado justo para
 * esto, y si viniera del cuerpo, cualquiera podría gastarle las plantillas
 * —y la tarjeta— a otra escuela.
 *
 * Exige "whatsapp.manage": disparar envíos reales a pacientes reales no es
 * mirar una pantalla.
 */
export async function POST() {
  const g = await eduApiGuard("whatsapp.manage");
  if ("response" in g) return g.response;

  try {
    const summary = await runEduReminderSweep({ institutionId: g.ctx.institutionId });
    return NextResponse.json({ summary });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/whatsapp/recordatorios");
  }
}
