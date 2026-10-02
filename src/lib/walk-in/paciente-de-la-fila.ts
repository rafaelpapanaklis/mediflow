// Quién es el paciente que llega a la fila de walk-in (ws1-t4, fallo 1 de la revisión final, 2-oct-2026).
//
// El formulario «Agregar a la fila» solo guardaba un nombre libre y «Iniciar» daba de alta SIEMPRE un paciente
// nuevo: el paciente de mañana que llega hoy acababa con dos expedientes (P0193 y P0194 con el mismo nombre).
// Ahora, mientras recepción escribe el nombre (o el teléfono), la pantalla busca en los pacientes de la clínica
// (`/api/patients/search`, el mismo buscador de «Nueva cita») y deja ELEGIR uno; la fila guarda su `patientId` e
// «Iniciar» lo reutiliza. Solo se da de alta uno nuevo si no se eligió ninguno, y si hay alguien con el MISMO
// nombre la pantalla pregunta antes de agregarlo como nuevo.
//
// PURO: sin Prisma ni React (lo usan la pantalla y las pruebas).

export type PacienteEncontrado = { id: string; name: string; phone: string | null };

/** Cuántos resultados del buscador se ofrecen debajo del nombre. */
export const MAX_SUGERENCIAS = 5;
/** Desde cuántas letras se busca (el buscador contesta vacío con menos de 2). */
export const MIN_LETRAS_BUSQUEDA = 2;

/** «  José   PÉREZ » → «jose perez»: sin acentos, sin mayúsculas, un espacio entre palabras. */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Los encontrados que se llaman EXACTAMENTE como lo escrito (acentos, mayúsculas y espacios aparte). */
export function conElMismoNombre(escrito: string, encontrados: readonly PacienteEncontrado[]): PacienteEncontrado[] {
  const n = normalizarNombre(escrito);
  if (!n) return [];
  return encontrados.filter((p) => normalizarNombre(p.name) === n);
}

/**
 * Qué hace «Agregar»: con un paciente elegido, agregarlo ligado; sin elegir y con alguien del mismo nombre,
 * PREGUNTAR (puede ser la misma persona); si no, agregarlo como nuevo. `comoNuevo` = recepción ya contestó
 * «Es otra persona».
 */
export function decidirAlAgregar(args: {
  patientName: string;
  patientId: string | null | undefined;
  encontrados: readonly PacienteEncontrado[];
  comoNuevo?: boolean;
}): "ligado" | "preguntar" | "nuevo" {
  if (args.patientId) return "ligado";
  if (!args.comoNuevo && conElMismoNombre(args.patientName, args.encontrados).length > 0) return "preguntar";
  return "nuevo";
}

/** El cuerpo del POST /api/walk-in: el `patientId` solo viaja si se eligió un paciente. */
export function cuerpoAlAgregar(form: { patientName: string; service: string; patientId?: string | null }) {
  return {
    patientName: form.patientName.trim(),
    service: form.service.trim(),
    ...(form.patientId ? { patientId: form.patientId } : {}),
  };
}
