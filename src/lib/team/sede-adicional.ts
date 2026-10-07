/**
 * A3 — dar acceso a otra sede a una persona que YA tiene cuenta (núcleo puro).
 *
 * Regla: solo se liga una cuenta existente si la persona ya tiene ficha ACTIVA
 * en otra sede del MISMO dueño (la lista de sedes sale de `sedesDelDueno`, o sea
 * de la sesión). Un correo que sea cuenta de OTRO cliente, o de nadie de este
 * dueño, no se liga: se queda el aviso de siempre. Así nadie puede "adoptar" por
 * correo a una persona de otra clínica ni averiguar quién tiene cuenta.
 */
export interface FichaDePersona {
  supabaseId: string;
  clinicId: string;
  clinicName: string;
  role: string;
  isActive: boolean;
}

export type DecisionSedeAdicional =
  | { ok: true; supabaseId: string; otrasSedes: string[] }
  | { ok: false; motivo: "NO_ES_DE_ESTE_DUENO" | "ES_DUENO" | "CUENTA_AMBIGUA" };

export function decidirSedeAdicional(input: {
  clinicIdActiva: string;
  sedesDelDueno: string[];
  fichas: FichaDePersona[];
}): DecisionSedeAdicional {
  const validas = input.fichas.filter(
    (f) => f.isActive && f.clinicId !== input.clinicIdActiva && input.sedesDelDueno.includes(f.clinicId),
  );
  if (validas.length === 0) return { ok: false, motivo: "NO_ES_DE_ESTE_DUENO" };
  const ids = Array.from(new Set(validas.map((f) => f.supabaseId)));
  if (ids.length !== 1) return { ok: false, motivo: "CUENTA_AMBIGUA" };
  // Un dueño ya tiene ficha en todas sus sedes y no se "rebaja" por correo.
  if (validas.some((f) => f.role === "SUPER_ADMIN")) return { ok: false, motivo: "ES_DUENO" };
  return { ok: true, supabaseId: ids[0], otrasSedes: Array.from(new Set(validas.map((f) => f.clinicName))) };
}

/** Personas distintas (por cuenta) con ficha activa en las sedes dadas: el cupo es por persona. */
export function personasDistintas(filas: Array<{ supabaseId: string }>): number {
  return new Set(filas.map((f) => f.supabaseId)).size;
}
