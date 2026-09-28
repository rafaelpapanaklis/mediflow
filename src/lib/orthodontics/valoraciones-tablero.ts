// Ortodoncia — «Valoraciones» del Tablero (ws1-t4 ronda 6, fila 16 de la
// revisión de lógica de uso). Puro: sin Prisma, sin React, sin `Date.now()`.
//
// EL FALLO QUE ARREGLA. La tarjeta contaba PRESUPUESTOS: todos, de cualquier
// procedimiento y de cualquier fecha, de los pacientes que tuvieran un
// diagnóstico de ortodoncia. Una corona presupuestada en 2024 salía como
// «valoración aceptada», y una valoración de ayer de un paciente sin
// diagnóstico no salía.
//
// QUÉ CUENTA AHORA. Una valoración es una CITA de la Agenda del tipo
// «Valoración de ortodoncia» (el de la clave `valoracion` del catálogo de
// Configuración; también el que usan el bot y la reserva web). Se cuentan
// PACIENTES, no citas, en una ventana de 90 días:
//   - valoraciones: pacientes que ya vinieron a su valoración en la ventana;
//   - abrieron caso: de esos, a cuántos se les abrió un caso después;
//   - por llamar: los que vinieron y siguen sin caso;
//   - agendadas: las valoraciones que todavía no ocurren.
// Quien ya tenía un caso ANTES de su valoración no es un prospecto y no cuenta.

/** La clave de la fila «Valoración» del catálogo de tipos de cita. */
export const ID_TIPO_CITA_VALORACION = "valoracion";

/** El texto de fábrica de esa fila: con él se buscan las citas si la clínica quitó la fila. */
export const TEXTO_TIPO_CITA_VALORACION = "Valoración de ortodoncia";

/** Cuántos días hacia atrás se cuentan las valoraciones. */
export const DIAS_VENTANA_VALORACIONES = 90;

/** Una valoración convierte si el caso se abrió desde un día antes de la cita. */
const MARGEN_MS = 24 * 60 * 60 * 1000;

export interface CitaDeValoracion {
  patientId: string;
  startsAt: Date;
  status: string;
}

export interface CasoDelPaciente {
  patientId: string;
  createdAt: Date;
}

export interface ResumenDeValoraciones {
  /** Pacientes que vinieron a su valoración en la ventana. */
  total: number;
  /** De esos, a cuántos se les abrió un caso. */
  aceptadas: number;
  /** De esos, cuántos siguen sin caso. */
  pendientes: number;
  /** Valoraciones que todavía no ocurren. */
  agendadas: number;
  /** El tamaño de la ventana, para decirlo en pantalla. */
  dias: number;
}

/** El texto con el que la clínica llama a la valoración, o el de fábrica. */
export function textoDelTipoValoracion(tipos: readonly { id: string; label: string }[]): string {
  const fila = tipos.find((t) => t.id === ID_TIPO_CITA_VALORACION);
  const texto = fila?.label.trim();
  return texto ? texto : TEXTO_TIPO_CITA_VALORACION;
}

/** Una cita cancelada o a la que el paciente faltó no es una valoración hecha ni por hacer. */
function cuenta(status: string): boolean {
  return status !== "CANCELLED" && status !== "NO_SHOW";
}

export function resumirValoraciones(
  citas: readonly CitaDeValoracion[],
  casos: readonly CasoDelPaciente[],
  ahora: Date,
  dias: number = DIAS_VENTANA_VALORACIONES,
): ResumenDeValoraciones {
  const desde = ahora.getTime() - dias * 24 * 60 * 60 * 1000;

  // Por paciente: su PRIMERA valoración hecha dentro de la ventana.
  const primera = new Map<string, number>();
  let agendadas = 0;
  for (const c of citas) {
    if (!cuenta(c.status)) continue;
    const t = c.startsAt.getTime();
    if (t > ahora.getTime()) {
      agendadas += 1;
      continue;
    }
    if (t < desde) continue;
    const previa = primera.get(c.patientId);
    if (previa === undefined || t < previa) primera.set(c.patientId, t);
  }

  const casosPorPaciente = new Map<string, number[]>();
  for (const k of casos) {
    const lista = casosPorPaciente.get(k.patientId);
    if (lista) lista.push(k.createdAt.getTime());
    else casosPorPaciente.set(k.patientId, [k.createdAt.getTime()]);
  }

  let total = 0;
  let aceptadas = 0;
  for (const [patientId, valoracion] of primera) {
    const abiertos = casosPorPaciente.get(patientId) ?? [];
    const despues = abiertos.some((t) => t >= valoracion - MARGEN_MS);
    // Ya tenía caso antes de su valoración: no es un prospecto.
    if (!despues && abiertos.length > 0) continue;
    total += 1;
    if (despues) aceptadas += 1;
  }

  return { total, aceptadas, pendientes: total - aceptadas, agendadas, dias };
}
