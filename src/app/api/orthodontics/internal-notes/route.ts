// Ortodoncia — «Notas internas» del caso. SOLO-EQUIPO (NOTAS_INTERNAS_SOLO_EQUIPO): ni el portal del paciente,
// ni el PDF del expediente, ni los mensajes las leen.
//
//   GET  /api/orthodontics/internal-notes?caseId=…   lista del caso (con sus correcciones) — se audita la LECTURA
//   POST /api/orthodontics/internal-notes            { caseId, text } crea una nota — se audita
//
// NO hay DELETE (ni PUT): una nota no se borra jamás. Corregir es PATCH en ./[id]/route.ts.
// `clinicId` y el autor salen de la sesión; el caso se comprueba contra la clínica y la visibilidad del paciente.

import { NextRequest, NextResponse } from "next/server";
import { logRead } from "@/lib/audit";
import { auditClinicalShared } from "@/lib/clinical-shared/auth/guard";
import { repoNotasInternas } from "@/lib/orthodontics/notas-internas-db";
import {
  MAX_CARACTERES_NOTA,
  aDTO,
  crearNota,
  listarNotas,
} from "@/lib/orthodontics/notas-internas-service";
import {
  casoVisibleDeLaSesion,
  guardaNotasInternas,
  leerIdNotas,
  respuestaNotas,
} from "@/lib/orthodontics/notas-internas-guarda";
import { puedeNotasInternas } from "@/lib/orthodontics/notas-internas-acceso";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await guardaNotasInternas("ver");
  if (g.res) return g.res;
  const ctx = g.ctx;

  const caseId = leerIdNotas(req.nextUrl.searchParams.get("caseId"));
  if (!caseId) return respuestaNotas("SIN_CASO", 400);
  const caso = await casoVisibleDeLaSesion(ctx, caseId);
  if (!caso) return respuestaNotas("NO_ENCONTRADA", 404);

  try {
    const actor = { userId: ctx.userId, role: ctx.role };
    const r = await listarNotas(repoNotasInternas, { clinicId: ctx.clinicId, caseId: caso.caseId });
    const puedeEscribir = puedeNotasInternas({ role: ctx.role, permissionsOverride: ctx.permissionsOverride }, "escribir");
    if (r.ok === false) {
      // Sin las tablas todavía (falta pegar el SQL): se dice, no se rompe.
      if (r.codigo === "SIN_TABLA") return NextResponse.json({ available: false, canWrite: false, maxChars: MAX_CARACTERES_NOTA, notes: [] });
      return respuestaNotas(r.codigo, r.status);
    }
    // Bitácora de LECTURA del expediente (la misma que usa la ficha): quién abrió las notas de este paciente.
    await logRead({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      kind: "orto_notas_internas",
      patientId: caso.patientId,
      recordId: caso.caseId,
    });
    return NextResponse.json(
      {
        available: true,
        canWrite: puedeEscribir,
        maxChars: MAX_CARACTERES_NOTA,
        notes: r.valor.map((n) => aDTO(n, actor)),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[ortodoncia:notas-internas] GET:", err);
    return respuestaNotas("ERROR", 500, { error: "No se pudieron leer las notas internas" });
  }
}

export async function POST(req: NextRequest) {
  const g = await guardaNotasInternas("escribir");
  if (g.res) return g.res;
  const ctx = g.ctx;

  let body: { caseId?: unknown; text?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return respuestaNotas("CUERPO_INVALIDO", 400);
  }
  const caseId = leerIdNotas(body?.caseId);
  if (!caseId) return respuestaNotas("SIN_CASO", 400);
  const caso = await casoVisibleDeLaSesion(ctx, caseId);
  if (!caso) return respuestaNotas("NO_ENCONTRADA", 404);

  try {
    const r = await crearNota(repoNotasInternas, {
      clinicId: ctx.clinicId,
      patientId: caso.patientId,
      caseId: caso.caseId,
      authorId: ctx.userId,
      texto: body?.text,
    });
    if (r.ok === false) return respuestaNotas(r.codigo, r.status);
    // Bitácora: solo ids y el largo del texto, nunca el contenido.
    await auditClinicalShared({
      ctx,
      action: "orthodontics.internal-note.created",
      entityType: "ortho-internal-note",
      entityId: r.valor.id,
      patientId: caso.patientId,
      changes: { caseId: caso.caseId, length: r.valor.texto.length },
    });
    return NextResponse.json(
      { note: aDTO(r.valor, { userId: ctx.userId, role: ctx.role }) },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("[ortodoncia:notas-internas] POST:", err);
    return respuestaNotas("ERROR", 500, { error: "No se pudo guardar la nota interna" });
  }
}
