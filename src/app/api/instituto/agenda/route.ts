import { NextResponse } from "next/server";
import { eduApiError, eduApiGuard, eduReadJson } from "@/lib/edu/api-guard";
import { parseEduAgendaQuery } from "@/lib/edu/agenda-core";
import { createEduAppointment, listEduAgenda } from "@/lib/edu/agenda";

export const dynamic = "force-dynamic";

/**
 * GET /api/instituto/agenda — las citas del rango que le tocan a quien
 * pregunta (?vista=dia|semana&dia=AAAA-MM-DD&sillon=&programa=&alumno=…).
 *
 * 🔴 El institutionId y la ZONA HORARIA salen de la sesión, nunca de la
 * query. La zona importa: el rango del día va de medianoche a medianoche
 * DEL INSTITUTO, y si se calculara con la del servidor (UTC en Vercel), la
 * agenda de una escuela en Tijuana empezaría a las 5 de la tarde del día
 * anterior.
 */
export async function GET(request: Request) {
  const g = await eduApiGuard("agenda.view");
  if ("response" in g) return g.response;

  try {
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    const tz = g.ctx.institution.timezone;
    const page = await listEduAgenda(g.ctx, parseEduAgendaQuery(params, tz), tz);
    return NextResponse.json({ rows: page.rows, days: page.days, truncated: page.truncated });
  } catch (err) {
    return eduApiError(err, "GET /api/instituto/agenda");
  }
}

/**
 * POST /api/instituto/agenda — agenda una cita.
 *
 * Exige "agenda.manage": repartir huecos y sillones es administrar la
 * clínica. Un alumno con agenda.view ve su día y registra lo que pasa en su
 * sillón, pero no se agenda pacientes a sí mismo.
 *
 * La hora llega como día + minuto del día (AAAA-MM-DD + 08:30) y se
 * convierte a instante con la zona del instituto en un solo lugar
 * (agenda-core.ts). El servidor comprueba además que quepa en el horario
 * del sillón y que no choque con otra cita del mismo sillón ni del mismo
 * alumno.
 */
export async function POST(request: Request) {
  const g = await eduApiGuard("agenda.manage");
  if ("response" in g) return g.response;

  try {
    const created = await createEduAppointment(
      g.ctx,
      await eduReadJson(request),
      g.ctx.institution.timezone,
    );
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return eduApiError(err, "POST /api/instituto/agenda");
  }
}
