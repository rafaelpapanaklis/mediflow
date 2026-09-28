"use server";
// Mapa 14 — el alta del caso lee el importe del presupuesto aceptado que la
// trajo (`?presupuesto=<id>`, ver src/lib/quotes/ortodoncia.ts). Solo lectura.
//
// Candados: la clínica sale de la sesión; el presupuesto tiene que ser de ESA
// clínica y de ESTE paciente (visible para quien pregunta) y estar ACEPTADO.
// Cualquier otra cosa devuelve `null` sin decir por qué: el alta simplemente
// arranca con el costo vacío, como siempre.

import { prisma } from "@/lib/prisma";
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
      items: { select: { name: true, lineTotal: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!quote) return ok(null);

  return ok(
    importeDeOrtodonciaDelPresupuesto({
      folio: quote.folio,
      title: quote.title,
      status: quote.status,
      subtotal: Number(quote.subtotal),
      total: Number(quote.total),
      items: quote.items.map((i) => ({ name: i.name, lineTotal: Number(i.lineTotal) })),
    }),
  );
}
