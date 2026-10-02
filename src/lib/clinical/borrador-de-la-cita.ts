/**
 * ws1-t8 (revisión de ws1-t9, fallo 1): UNA nota por visita también en la ruta dental.
 *
 * «Iniciar consulta» crea el BORRADOR de la nota de esa cita (POST /api/clinical-notes,
 * specialtyData.appointmentId). Si luego el doctor escribe la consulta en «Nueva consulta» y pulsa
 * «Guardar consulta», el formulario hace POST /api/clinical. Antes, como la cita «ya tenía nota», la
 * nueva se guardaba SUELTA (firmada, sin cita) y el borrador vacío seguía ligado: «Completar consulta»
 * intentaba firmar ese borrador vacío y moría con 422. Ahora la consulta guardada ADOPTA el borrador:
 * se escribe en ESE registro, que queda como la única nota de la visita.
 *
 * Archivo PURO: la decisión y la fusión. La lectura y la escritura las hace la ruta.
 */

export interface NotaLigadaALaCita {
  id: string;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  specialtyData?: unknown;
}

/**
 * ¿Se adopta? Solo un BORRADOR explícito (status "DRAFT"). Una nota ya firmada de esa cita es otra
 * visita cerrada (el paciente volvió por la tarde): la nueva sigue yendo suelta, como siempre.
 */
export function esBorradorAdoptable(nota: NotaLigadaALaCita | null | undefined): nota is NotaLigadaALaCita {
  const spec = nota?.specialtyData;
  return !!nota && !!spec && typeof spec === "object" && (spec as { status?: unknown }).status === "DRAFT";
}

/**
 * Lo que el doctor escribió en el borrador (el SOAP de la barra de consulta) no se pierde: va delante de lo
 * de «Nueva consulta», sin repetirlo si ya está dentro. Misma regla que la hoja de ortodoncia al adoptar.
 */
export function fusionarTextoDeNota(borrador: string | null | undefined, nuevo: string | null | undefined): string | null {
  const b = (borrador ?? "").trim();
  const n = (nuevo ?? "").trim();
  if (!b) return n ? (nuevo as string) : null;
  if (!n) return b;
  if (n.includes(b)) return nuevo as string;
  return `${b}\n\n${nuevo}`;
}

export function fusionarConElBorrador(
  borrador: NotaLigadaALaCita,
  nueva: { subjective?: string | null; objective?: string | null; assessment?: string | null; plan?: string | null },
) {
  return {
    subjective: fusionarTextoDeNota(borrador.subjective, nueva.subjective),
    objective: fusionarTextoDeNota(borrador.objective, nueva.objective),
    assessment: fusionarTextoDeNota(borrador.assessment, nueva.assessment),
    plan: fusionarTextoDeNota(borrador.plan, nueva.plan),
  };
}

/**
 * specialtyData de la nota adoptada: lo del borrador (adjuntos de la barra de consulta) + lo de la consulta,
 * con el estado y la cita que decide el servidor. Los adjuntos del borrador se conservan aunque la consulta
 * traiga los suyos.
 */
export function specialtyDataAdoptada(
  borradorSpec: unknown,
  nuevaSpec: Record<string, unknown>,
  servidor: { status: string; appointmentId: string; signedAt?: string },
): Record<string, unknown> {
  const previo = borradorSpec && typeof borradorSpec === "object" ? (borradorSpec as Record<string, unknown>) : {};
  const adjPrevios = Array.isArray(previo.attachments) ? previo.attachments : [];
  const adjNuevos = Array.isArray(nuevaSpec.attachments) ? nuevaSpec.attachments : [];
  const { signedAt: _s, ...previoSinFirma } = previo;
  return {
    ...previoSinFirma,
    ...nuevaSpec,
    ...(adjPrevios.length || adjNuevos.length ? { attachments: [...adjPrevios, ...adjNuevos] } : {}),
    status: servidor.status,
    appointmentId: servidor.appointmentId,
    ...(servidor.signedAt ? { signedAt: servidor.signedAt } : {}),
  };
}
