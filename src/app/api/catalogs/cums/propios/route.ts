import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";
import { crearMedicamentoPropio } from "@/lib/clinical/medicamentos-propios.server";

export const dynamic = "force-dynamic";

/**
 * POST /api/catalogs/cums/propios — «Agregar medicamento que no está».
 *
 * Body: { nombre, concentracion, forma, via, presentacion? }
 * Guarda el medicamento en la lista PROPIA de la clínica de la sesión (fila de
 * `cums_items` con `clinicId`) y lo devuelve ya con su `clave`, listo para
 * recetarlo; la próxima vez sale al buscar. Mismo permiso que crear la receta.
 *
 * Respuestas:
 *   201 { medicamento }            creado
 *   200 { medicamento, existia }   ya había uno igual (nombre + presentación): se devuelve ese
 *   400 { error: "datos_invalidos", campo }
 *   422 { error: "medicamento_controlado", controlado: { nombre, grupo } }
 *       ← el CANDADO: grupos COFEPRIS I, II y III no se agregan a mano; se
 *         recetan desde el catálogo, donde se pide el folio.
 *   503 { error: "sin_sql" }       la columna `clinicId` aún no existe en la base
 */
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deniedPerm = denyIfMissingPermission(ctx, "prescription.create");
  if (deniedPerm) return deniedPerm;

  const body = await req.json().catch(() => ({}));
  const alta = {
    nombre: body?.nombre,
    concentracion: body?.concentracion,
    forma: body?.forma,
    via: body?.via,
    presentacion: body?.presentacion,
  };

  const r = await crearMedicamentoPropio({ clinicId: ctx.clinicId, userId: ctx.userId, alta });

  // `r.ok === false` y no `!r.ok`: sin strictNullChecks la negación no estrecha la unión.
  if (r.ok === false) {
    if (r.error === "datos_invalidos") return NextResponse.json({ error: r.error, campo: r.campo }, { status: 400 });
    if (r.error === "medicamento_controlado") {
      return NextResponse.json({
        error: r.error,
        controlado: r.controlado,
        detail:
          `«${r.controlado.nombre}» es un medicamento controlado (grupo COFEPRIS ${r.controlado.grupo}). ` +
          "No se puede agregar a mano: búscalo en el catálogo, donde la receta pide el folio del recetario.",
      }, { status: 422 });
    }
    return NextResponse.json({
      error: "sin_sql",
      detail: "La lista propia de medicamentos todavía no está habilitada en esta base.",
    }, { status: 503 });
  }

  if (!r.existia) {
    await logMutation({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      entityType: "clinic-medication",
      entityId: r.medicamento.clave,
      action: "create",
      after: {
        clave: r.medicamento.clave,
        descripcion: r.medicamento.descripcion,
        presentacion: r.medicamento.presentacion,
        formaFarmaceutica: r.medicamento.formaFarmaceutica,
      },
      texto: `Agregó el medicamento «${r.medicamento.descripcion}» a la lista de la clínica`,
      categoria: "otros",
    });
  }

  return NextResponse.json({ medicamento: r.medicamento, existia: r.existia }, { status: r.existia ? 200 : 201 });
}
