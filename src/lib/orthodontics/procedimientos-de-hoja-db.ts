// Ortodoncia — «Procedimientos de esta visita»: lectura y escritura en la nota
// del expediente de la hoja (`medical_records.specialtyData`). Las reglas de
// dinero y de expediente están en `procedimientos-de-visita.ts`; aquí solo se
// habla con la base. `clinicId` SIEMPRE de la sesión.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listarProcedimientosDeOrtodoncia } from "./catalog-procedures";
import { ORTHO_CATALOG_CATEGORY } from "./catalog-procedures-constantes";
import {
  armarLineas,
  esElegibleEnLaHoja,
  hayPorCobrar,
  lineasDeLaNota,
  textoParaLaNota,
  type FilaDeCatalogo,
  type LineaDeVisita,
  type Pedido,
} from "./procedimientos-de-visita";
import { fusionarNotaDeConsulta } from "./hoja-de-control-reglas";

/** Los procedimientos de ortodoncia que se pueden elegir en la hoja (activos, con cobro definido, sin el control). */
export async function cargarCatalogoElegible(clinicId: string): Promise<FilaDeCatalogo[]> {
  if (!clinicId) return [];
  const filas = await listarProcedimientosDeOrtodoncia(clinicId);
  // `code` (la llave del control) no viene en esa lectura: se pide aparte para
  // reconocer el control aunque lo hayan renombrado.
  const codigos = await prisma.procedureCatalog
    .findMany({ where: { clinicId, category: ORTHO_CATALOG_CATEGORY }, select: { id: true, code: true } })
    .catch(() => [] as { id: string; code: string | null }[]);
  const codigoDe = new Map(codigos.map((c) => [c.id, c.code]));
  return filas
    .map((f) => ({
      id: f.id,
      name: f.name,
      code: codigoDe.get(f.id) ?? null,
      category: ORTHO_CATALOG_CATEGORY,
      basePrice: Number(f.basePrice) || 0,
      isActive: f.isActive,
      orthoIncludedInTreatment: f.orthoIncludedInTreatment,
    }))
    .filter(esElegibleEnLaHoja);
}

export interface NotaDeHoja {
  id: string;
  specialtyData: Record<string, unknown>;
  firmada: boolean;
}

export async function buscarNotaDeHoja(clinicId: string, cardId: string): Promise<NotaDeHoja | null> {
  if (!clinicId || !cardId) return null;
  const n = await prisma.medicalRecord.findFirst({
    where: { clinicId, specialtyData: { path: ["treatmentCardId"], equals: cardId } },
    select: { id: true, specialtyData: true },
  });
  if (!n) return null;
  const sd = (n.specialtyData && typeof n.specialtyData === "object" ? n.specialtyData : {}) as Record<string, unknown>;
  return { id: n.id, specialtyData: sd, firmada: sd.status === "SIGNED" };
}

/**
 * ws1-t8 (ticket BEVADENT, punto 3): el borrador que «Pasar a consulta» creó para ESTA cita
 * (`POST /api/clinical-notes` guarda `specialtyData.appointmentId`), sin firmar y sin otra hoja.
 * Es la nota de la visita: la hoja la adopta al firmar en vez de crear una segunda.
 */
export async function buscarBorradorDeLaConsulta(
  clinicId: string,
  patientId: string,
  appointmentId: string,
): Promise<{ id: string; specialtyData: Record<string, unknown>; subjective: string | null; objective: string | null; assessment: string | null; plan: string | null } | null> {
  if (!clinicId || !patientId || !appointmentId) return null;
  const filas = await prisma.medicalRecord.findMany({
    where: { clinicId, patientId, specialtyData: { path: ["appointmentId"], equals: appointmentId } },
    select: { id: true, specialtyData: true, subjective: true, objective: true, assessment: true, plan: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const f of filas) {
    const sd = (f.specialtyData && typeof f.specialtyData === "object" ? f.specialtyData : {}) as Record<string, unknown>;
    if (sd.status === "SIGNED") continue;
    // La nota de una hoja (esta u otra) no es el borrador de la consulta: esa se busca por su hoja.
    if (sd.treatmentCardId) continue;
    return { ...f, specialtyData: sd };
  }
  return null;
}

/** Valida los pedidos contra el catálogo SIN escribir nada (para rechazar antes de firmar). */
export async function validarPedidos(args: { clinicId: string; cardId: string | null; pedidos: readonly Pedido[] }): Promise<string | null> {
  const catalogo = await cargarCatalogoElegible(args.clinicId);
  const nota = args.cardId ? await buscarNotaDeHoja(args.clinicId, args.cardId) : null;
  const previas = lineasDeLaNota(nota?.specialtyData);
  return armarLineas({ pedidos: args.pedidos, catalogo, previas }).error;
}

export interface EscribirNota {
  clinicId: string;
  patientId: string;
  planId: string;
  userId: string;
  cardId: string;
  cardNumber: number;
  visitDate: Date;
  appointmentId: string | null;
  soap: { s: string; o: string; a: string; p: string };
  /** undefined = no tocar las líneas que ya tenga la nota. */
  pedidos: readonly Pedido[] | undefined;
  /** true al firmar: la nota queda FIRMADA, con los procedimientos escritos en su texto. */
  firmar: boolean;
}

/**
 * Crea o actualiza la nota de la hoja (borrador o firmada) con sus procedimientos.
 * Una nota ya firmada NO se reescribe: su texto es inalterable (NOM-004/024).
 */
export async function escribirNotaDeHoja(a: EscribirNota): Promise<{ ok: boolean; error: string | null; lineas: LineaDeVisita[]; notaId: string | null }> {
  let nota = await buscarNotaDeHoja(a.clinicId, a.cardId);
  const previas = lineasDeLaNota(nota?.specialtyData);
  let lineas = previas;
  if (a.pedidos !== undefined) {
    const catalogo = await cargarCatalogoElegible(a.clinicId);
    const r = armarLineas({ pedidos: a.pedidos, catalogo, previas });
    if (r.error) return { ok: false, error: r.error, lineas: previas, notaId: nota?.id ?? null };
    lineas = r.lineas;
  }
  if (nota?.firmada) return { ok: true, error: null, lineas: previas, notaId: nota.id };

  // ws1-t8 (punto 3): al FIRMAR una hoja ligada a una cita, la nota de la visita es el borrador de la
  // consulta de esa cita. Sin nota propia de la hoja, se adopta ese borrador; si la hoja ya tenía la suya
  // (borrador con procedimientos), lo escrito en el de la consulta pasa a la de la hoja y ese borrador
  // queda marcado como absorbido. Así completar la cita no encuentra una nota vacía que exigir.
  let soap = a.soap;
  let absorbido: { id: string; specialtyData: Record<string, unknown> } | null = null;
  if (a.firmar && a.appointmentId) {
    const borrador = await buscarBorradorDeLaConsulta(a.clinicId, a.patientId, a.appointmentId);
    if (borrador && borrador.id !== nota?.id) {
      soap = fusionarNotaDeConsulta(borrador, a.soap);
      if (nota) absorbido = borrador;
      else nota = { id: borrador.id, specialtyData: borrador.specialtyData, firmada: false };
    }
  }

  const textoProcedimientos = textoParaLaNota(lineas);
  const planTexto = a.firmar && textoProcedimientos ? `${soap.p}\n\n${textoProcedimientos}` : soap.p;
  const specialtyData = {
    ...(nota?.specialtyData ?? {}),
    type: "orthodontics",
    status: a.firmar ? "SIGNED" : "DRAFT",
    ...(a.firmar ? { signedAt: new Date().toISOString() } : {}),
    treatmentCardId: a.cardId,
    treatmentPlanId: a.planId,
    appointmentId: a.appointmentId,
    cardNumber: a.cardNumber,
    procedimientos: lineas,
    hayPorCobrar: a.firmar && hayPorCobrar(lineas),
  } as unknown as Prisma.InputJsonValue;

  let notaId: string;
  if (!nota) {
    const creada = await prisma.medicalRecord.create({
      data: {
        clinicId: a.clinicId,
        patientId: a.patientId,
        doctorId: a.userId,
        visitDate: a.visitDate,
        subjective: soap.s,
        objective: soap.o,
        assessment: soap.a,
        plan: planTexto,
        specialtyData,
      },
      select: { id: true },
    });
    notaId = creada.id;
  } else {
    await prisma.medicalRecord.update({
      where: { id: nota.id },
      data: {
        visitDate: a.visitDate,
        subjective: soap.s,
        objective: soap.o,
        assessment: soap.a,
        plan: planTexto,
        specialtyData,
      },
    });
    notaId = nota.id;
  }
  if (absorbido) {
    // No se borra ni se vacía (es un registro del expediente): queda como borrador que apunta a la nota firmada.
    await prisma.medicalRecord.update({
      where: { id: absorbido.id },
      data: {
        specialtyData: { ...absorbido.specialtyData, absorbidaEnNota: notaId } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return { ok: true, error: null, lineas, notaId };
}
