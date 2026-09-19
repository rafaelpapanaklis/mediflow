"use server";
// Clinical-shared — server action que deja sembradas las plantillas dentales
// de la clínica de la sesión antes de montar el selector en la ficha dental.
//
// Por qué existe: `listEvolutionTemplates` (src/app/actions/clinical-shared/
// evolution-templates.ts) solo sabe sembrar pediatría y ortodoncia. Su rama
// natural para `dental` son tres líneas allí; ese archivo quedaba fuera del
// alcance de esta tarea, así que el sembrado dental se dispara desde aquí.

import { getAuthContext } from "@/lib/auth-context";
import { fail, ok, type ActionResult } from "@/lib/clinical-shared/result";
import { ensureDentalDefaults } from "./seed-dental";

export async function ensureDentalEvolutionTemplates(): Promise<
  ActionResult<{ created: number; total: number }>
> {
  const ctx = await getAuthContext();
  if (!ctx?.clinicId || !ctx.userId) return fail("No autenticado");
  try {
    return ok(await ensureDentalDefaults({ clinicId: ctx.clinicId, createdBy: ctx.userId }));
  } catch (e) {
    // Lo esperable aquí es que falte el valor `dental` del enum en la base
    // (sql/clinical-module-dental-enum.sql sin aplicar). La ficha sigue
    // funcionando sin selector; no se rompe la consulta por esto.
    console.error("[evolution-templates] no se pudieron sembrar las plantillas dentales:", e);
    return fail("No se pudieron preparar las plantillas");
  }
}
