"use server";
// Mapa 14 — el alta del caso lee el importe del presupuesto aceptado que la
// trajo (`?presupuesto=<id>`, ver src/lib/quotes/ortodoncia.ts). Solo lectura.
//
// Candados: la clínica sale de la sesión; el presupuesto tiene que ser de ESA
// clínica y de ESTE paciente (visible para quien pregunta) y estar ACEPTADO.
// Cualquier otra cosa devuelve `null` sin decir por qué: el alta simplemente
// arranca con el costo vacío, como siempre.

import { prisma } from "@/lib/prisma";
import { leerAceptaciones } from "@/lib/quotes/aceptacion-db";
import { resumirAceptacion } from "@/lib/quotes/aceptacion";
import {
  importeDeOrtodonciaDelPresupuesto,
  type ImporteDelPresupuesto,
} from "@/lib/orthodontics/importe-desde-presupuesto";
import { getOrthoActionContext, loadPatientForOrtho } from "./_helpers";
import { isFailure, ok, type ActionResult } from "./result";

export async function getPresupuestoParaAlta(input: {
  patientId: string;
  quoteId: string;
}): Promise<ActionResult<ImporteDelPresupuesto | null>> {
  const auth = await getOrthoActionContext({ write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;
  if (!ctx.clinicId) return ok(null);

  const patientId = typeof input?.patientId === "string" ? input.patientId : "";
  const quoteId = typeof input?.quoteId === "string" ? input.quoteId : "";
  if (!patientId || !quoteId) return ok(null);

  const patient = await loadPatientForOrtho({ ctx, patientId });
  if (isFailure(patient)) return patient;

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, clinicId: ctx.clinicId, patientId: patient.data.id, status: "ACCEPTED" },
    select: {
      folio: true,
      title: true,
      status: true,
      subtotal: true,
      total: true,
      items: { select: { id: true, name: true, lineTotal: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!quote) return ok(null);

  // Aceptado en parte (ws1-t6): el importe sale SOLO de lo que el paciente
  // aceptó, con su parte del descuento. Sin renglones guardados, todo.
  const g = (await leerAceptaciones(prisma, ctx.clinicId, [quoteId])).porQuote.get(quoteId);
  const si = g ? new Set(g.renglones.filter((r) => r.aceptado).map((r) => r.quoteItemId)) : null;
  const items = si ? quote.items.filter((i) => si.has(i.id)) : quote.items;
  const resumen = g ? resumirAceptacion(g.renglones, Number(quote.total)) : null;

  return ok(
    importeDeOrtodonciaDelPresupuesto({
      folio: quote.folio,
      title: quote.title,
      status: quote.status,
      subtotal: resumen ? resumen.subtotal : Number(quote.subtotal),
      total: resumen ? resumen.total : Number(quote.total),
      items: items.map((i) => ({ name: i.name, lineTotal: Number(i.lineTotal) })),
    }),
  );
}
