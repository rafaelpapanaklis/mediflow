import { NextResponse, type NextRequest } from "next/server";
import { loadClinicSession } from "@/lib/agenda/api-helpers";
import { extractAuditMeta } from "@/lib/audit";
import { HorarioError } from "@/lib/horario-doctor/core";
import {
  borrarHorario,
  ctxDeSesion,
  guardarHorario,
  verHorario,
} from "@/lib/horario-doctor/service";

export const dynamic = "force-dynamic";

/**
 * EL HORARIO PROPIO DE UN DOCTOR — WS1-T2 · horario.
 *
 *   GET    /api/team/[id]/horario → { horario: Dia[], hereda, clinica, avisos }
 *   PUT    /api/team/[id]/horario   { horario: Dia[] }  (los 7 días SIEMPRE)
 *                                 → { horario: Dia[], hereda: false, clinica, avisos }
 *   DELETE /api/team/[id]/horario → { horario: Dia[] (el de la clínica), hereda: true, clinica, avisos: [] }
 *
 *   Dia = { dayOfWeek: 0..6 (0=lunes), enabled, openTime: "HH:MM", closeTime: "HH:MM" }
 *
 * `hereda: true` = el doctor no tiene horario propio y sigue el de la clínica;
 * `horario` trae entonces el de la clínica, para que la pantalla arranque de
 * lo que el doctor ya tiene en la práctica. `clinica` y `avisos` son ADEMÁS de
 * la forma pactada: el horario de la clínica para pintarlo al lado, y los días
 * en que lo guardado se sale de él (se acepta y se avisa; el cálculo de
 * huecos recorta a la intersección).
 *
 * PERMISOS, en el servidor (ver src/lib/horario-doctor/service.ts):
 *   · llave `agenda.bloqueos` para las tres;
 *   · ADMIN / SUPER_ADMIN → cualquier doctor de SU clínica;
 *   · DOCTOR → solo el suyo (otro id → 403);
 *   · RECEPTIONIST → nada por defecto (no tiene la llave).
 *
 * Errores: `{ error: <código estable>, mensaje }` con 400/401/403/404, y 503
 * `SQL_PENDIENTE` si se intenta guardar antes de aplicar
 * sql/doctor-horarios.sql.
 */

function respuestaDeError(err: unknown): NextResponse {
  if (err instanceof HorarioError) {
    return NextResponse.json({ error: err.codigo, mensaje: err.message }, { status: err.status });
  }
  // Lo que no previmos sale como un 500 de verdad, no disfrazado de 400.
  throw err;
}

const SIN_CACHE = { "Cache-Control": "no-store, must-revalidate" };

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  try {
    const res = await verHorario(ctxDeSesion(session), params.id);
    return NextResponse.json(res, { headers: SIN_CACHE });
  } catch (err) {
    return respuestaDeError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;

  let body: { horario?: unknown } = {};
  try {
    const b = await req.json();
    body = b && typeof b === "object" ? (b as { horario?: unknown }) : {};
  } catch {
    // Cuerpo ilegible: `parseSemana` lo rechaza con su mensaje (400).
  }

  try {
    const res = await guardarHorario(ctxDeSesion(session), params.id, body, extractAuditMeta(req));
    return NextResponse.json(res, { headers: SIN_CACHE });
  } catch (err) {
    return respuestaDeError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await loadClinicSession();
  if (session instanceof NextResponse) return session;
  try {
    const res = await borrarHorario(ctxDeSesion(session), params.id, extractAuditMeta(req));
    return NextResponse.json(res, { headers: SIN_CACHE });
  } catch (err) {
    return respuestaDeError(err);
  }
}
