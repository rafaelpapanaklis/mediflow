"use server";
// Ortodoncia — «Condiciones del convenio» (ws1-t4, 29-sep-2026). Las lee y
// las guarda la tarjeta de Ortodoncia → Configuración; las imprime el
// convenio de pago en PDF. Es ajuste de la clínica: leer pide
// `settings.view`, guardar `settings.edit` (getOrthoConfigActionContext), y
// el `clinicId` sale SIEMPRE de la sesión.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auditOrtho, getOrthoConfigActionContext } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";
import {
  guardarCondicionesDelConvenio as guardarEnBase,
  leerCondicionesDelConvenio,
} from "@/lib/orthodontics/cobro/condiciones-convenio-db";
import { CONDICIONES_CONVENIO_EJEMPLO, MAX_CONDICIONES_CONVENIO } from "@/lib/orthodontics/cobro/condiciones-convenio";

export interface CondicionesDelConvenioPayload {
  /** Lo que se edita: las guardadas, o el ejemplo si la clínica nunca las editó. */
  texto: string;
  /** true = la clínica todavía no las ha guardado nunca (se le enseña el ejemplo). */
  esEjemplo: boolean;
  /** false = falta pegar sql/ortodoncia-condiciones-convenio.sql: se ve el ejemplo pero no se puede guardar. */
  columnaLista: boolean;
  puedeEditar: boolean;
}

export async function cargarCondicionesDelConvenio(): Promise<ActionResult<CondicionesDelConvenioPayload>> {
  const auth = await getOrthoConfigActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const [{ texto, columnaLista }, edicion] = await Promise.all([
    leerCondicionesDelConvenio(ctx.clinicId),
    getOrthoConfigActionContext(),
  ]);
  return ok({
    texto: texto ?? CONDICIONES_CONVENIO_EJEMPLO,
    esEjemplo: texto == null,
    columnaLista,
    puedeEditar: !isFailure(edicion),
  });
}

const entrada = z.object({ texto: z.string().max(MAX_CONDICIONES_CONVENIO + 500) });

export async function guardarCondicionesDelConvenio(
  input: unknown,
): Promise<ActionResult<{ texto: string }>> {
  const auth = await getOrthoConfigActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  const parsed = entrada.safeParse(input);
  if (!parsed.success) return fail("Las condiciones son demasiado largas.");

  const r = await guardarEnBase(ctx.clinicId, parsed.data.texto);
  if (r.sinColumna) {
    return fail("Falta pegar sql/ortodoncia-condiciones-convenio.sql en Supabase antes de guardar las condiciones.");
  }
  if (!r.ok || r.texto == null) return fail("No se pudieron guardar las condiciones. Intenta de nuevo.");

  await auditOrtho({
    ctx,
    action: "ortho.agreementTerms.updated",
    entityType: "OrthodonticBillingConfig",
    entityId: ctx.clinicId,
    meta: { largo: r.texto.length },
  });
  try {
    revalidatePath("/dashboard/orthodontics/configuracion");
  } catch {
    // fuera de un request (pruebas): no pasa nada
  }
  return ok({ texto: r.texto });
}
