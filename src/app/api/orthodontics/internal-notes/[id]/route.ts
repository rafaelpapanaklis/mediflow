// Ortodoncia — corregir una nota interna. SOLO-EQUIPO (NOTAS_INTERNAS_SOLO_EQUIPO).
//
//   PATCH /api/orthodontics/internal-notes/:id   { text }
//
// El texto anterior queda guardado como revisión (quién corrigió y cuándo); NO hay DELETE: una nota no se borra.
// Corrige el autor de la nota o un ADMIN / SUPER_ADMIN (`puedeCorregirNota`). La nota se busca con la clínica de
// la sesión y su paciente tiene que ser visible para quien corrige.

import { NextRequest, NextResponse } from "next/server";
import { auditClinicalShared } from "@/lib/clinical-shared/auth/guard";
import { repoNotasInternas } from "@/lib/orthodontics/notas-internas-db";
import { aDTO, corregirNota } from "@/lib/orthodontics/notas-internas-service";
import {
  guardaNotasInternas,
  leerIdNotas,
  pacienteVisibleDeLaSesion,
  respuestaNotas,
} from "@/lib/orthodontics/notas-internas-guarda";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const g = await guardaNotasInternas("escribir");
  if (g.res) return g.res;
  const ctx = g.ctx;

  const params = await props.params;
  const id = leerIdNotas(params.id);
  if (!id) return respuestaNotas("NO_ENCONTRADA", 404);

  let body: { text?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return respuestaNotas("CUERPO_INVALIDO", 400);
  }

  try {
    if (!(await repoNotasInternas.tablaExiste())) return respuestaNotas("SIN_TABLA", 503);
    // La nota de otra clínica «no existe»; la de un paciente que no ves, tampoco.
    const nota = await repoNotasInternas.obtener(ctx.clinicId, id);
    if (!nota || !(await pacienteVisibleDeLaSesion(ctx, nota.patientId))) return respuestaNotas("NO_ENCONTRADA", 404);

    const actor = { userId: ctx.userId, role: ctx.role };
    const r = await corregirNota(repoNotasInternas, { clinicId: ctx.clinicId, id, actor, texto: body?.text });
    if (r.ok === false) return respuestaNotas(r.codigo, r.status);
    // Bitácora: solo ids y largos (antes y después), nunca el contenido.
    await auditClinicalShared({
      ctx,
      action: "orthodontics.internal-note.corrected",
      entityType: "ortho-internal-note",
      entityId: r.valor.id,
      patientId: r.valor.patientId,
      changes: {
        caseId: r.valor.caseId,
        lengthBefore: nota.texto.length,
        lengthAfter: r.valor.texto.length,
        revisions: r.valor.revisiones.length,
      },
    });
    return NextResponse.json({ note: aDTO(r.valor, actor) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[ortodoncia:notas-internas] PATCH:", err);
    return respuestaNotas("ERROR", 500, { error: "No se pudo corregir la nota interna" });
  }
}
