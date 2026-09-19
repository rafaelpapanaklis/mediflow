// Lo común de las tres salidas de una nota (PDF, WhatsApp, correo): encontrarla
// en ESTA clínica, comprobar que quien pregunta puede ver a SU paciente, y
// pasarla a los datos planos que entienden `@/lib/patient-documents/*`.
//
// Lo que sale es SIEMPRE la foto guardada (`getNota`), nunca la cabecera de hoy:
// el PDF de una nota firmada trae lo que se firmó.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import type { DocumentoParaPdf } from "@/lib/patient-documents/pdf";
import { notaParaPdf } from "./nota-pdf";
import { pacienteOculto } from "./http";
import { getNota, NOTA_KIND, type NotaCompleta } from "./service";

const NO_ENCONTRADA = () =>
  NextResponse.json({ error: "Nota no encontrada", code: "NOT_FOUND" }, { status: 404 });

export type NotaParaSalida = { nota: NotaCompleta; patientId: string; doc: DocumentoParaPdf };

/** `{ res }` = ya hay respuesta (404 / paciente restringido). */
export async function cargarNotaParaSalida(
  ctx: AuthContext,
  id: string,
): Promise<{ res: Response } | NotaParaSalida> {
  // `ctx.clinicId` viene de la sesión; sin él NO se consulta (undefined no filtra).
  if (!ctx.clinicId || typeof id !== "string" || id.length === 0) return { res: NO_ENCONTRADA() };
  const fila = await prisma.patientDocument.findFirst({
    where: { id, clinicId: ctx.clinicId, kind: NOTA_KIND },
    select: { patientId: true },
  });
  if (!fila) return { res: NO_ENCONTRADA() };
  const oculto = await pacienteOculto(ctx, fila.patientId);
  if (oculto) return { res: oculto };

  const [nota, clinic] = await Promise.all([
    getNota(prisma, ctx.clinicId, id),
    // Solo la zona horaria, para FORMATEAR la hora de la firma. No se imprime
    // ningún dato de la clínica de hoy.
    prisma.clinic.findUnique({ where: { id: ctx.clinicId }, select: { timezone: true } }),
  ]);
  if (!nota) return { res: NO_ENCONTRADA() };
  return { nota, patientId: fila.patientId, doc: notaParaPdf(nota, clinic?.timezone ?? null) };
}

/** Solo lo firmado sale de la clínica: un borrador puede cambiar mañana. */
export function soloFirmadas(nota: NotaCompleta): Response | null {
  if (nota.status === "SIGNED") return null;
  return NextResponse.json(
    { error: "Solo se puede enviar una nota firmada. Fírmala primero.", code: "NOT_SIGNED" },
    { status: 409 },
  );
}
