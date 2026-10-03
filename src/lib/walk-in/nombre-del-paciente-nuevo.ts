// Nombre y apellidos del paciente NUEVO que nace de la fila de walk-in (ws1-t1, arreglos de las revisiones,
// 3-oct-2026).
//
// La fila solo guarda un texto libre («Ana María López Ruiz») y «Iniciar» lo partía en «primera palabra / el
// resto»: nombre «Ana», apellido «María López Ruiz». Ahora, cuando «Iniciar» va a dar de alta un paciente, la
// pantalla pide confirmar Nombre(s) y Apellidos POR SEPARADO —prellenados con `sugerirNombreYApellidos`, que
// es solo una propuesta— y el servidor ya no parte nada: sin los dos campos contesta 400 y no crea a nadie.
//
// PURO: sin Prisma ni React (lo usan la ruta, la pantalla y las pruebas).

export type NombreYApellidos = { firstName: string; lastName: string };

/** Partículas que van pegadas al apellido que las sigue («de la Cruz», «del Río», «van der Berg»). */
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "da", "das", "do", "dos", "van", "von", "der", "di", "mac", "mc", "san", "santa"]);

/** Tope de largo de cada campo (el alta general no pide más). */
export const MAX_LARGO = 80;

function limpiar(s: unknown): string {
  return typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
}

/**
 * Propuesta para prellenar: en México lo habitual son DOS apellidos al final.
 *   «Ana» → Ana / —                       «Juan Pérez» → Juan / Pérez
 *   «Juan Pérez López» → Juan / Pérez López
 *   «Ana María López Ruiz» → Ana María / López Ruiz
 *   «José de la Cruz Martínez» → José / de la Cruz Martínez
 * Con un nombre compuesto y UN solo apellido («Juan Carlos Pérez») se equivoca: por eso se confirma.
 */
export function sugerirNombreYApellidos(completo: string): NombreYApellidos {
  const palabras = limpiar(completo).split(" ").filter(Boolean);
  if (palabras.length <= 1) return { firstName: palabras[0] ?? "", lastName: "" };
  // Unidades de apellido desde el final: una palabra más las partículas que la preceden.
  const unidades: string[][] = [];
  let i = palabras.length - 1;
  while (i >= 0) {
    const unidad = [palabras[i]];
    i--;
    while (i > 0 && PARTICULAS.has(palabras[i].toLowerCase())) {
      unidad.unshift(palabras[i]);
      i--;
    }
    unidades.unshift(unidad);
  }
  const cuantos = unidades.length >= 3 ? 2 : 1;
  const nombre = unidades.slice(0, unidades.length - cuantos).flat();
  const apellidos = unidades.slice(unidades.length - cuantos).flat();
  return { firstName: nombre.join(" "), lastName: apellidos.join(" ") };
}

/** Lo que llega en el cuerpo de «Iniciar»: válido solo con los dos campos llenos y de largo razonable. */
export function leerNombreYApellidos(cuerpo: unknown): NombreYApellidos | null {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const firstName = limpiar(c.firstName);
  const lastName = limpiar(c.lastName);
  if (!firstName || !lastName) return null;
  if (firstName.length > MAX_LARGO || lastName.length > MAX_LARGO) return null;
  return { firstName, lastName };
}

/** El nombre de la fila tras confirmar: el que se le dio de alta. */
export function nombreCompleto(n: NombreYApellidos): string {
  return `${n.firstName} ${n.lastName}`.trim();
}

export interface TextosPacienteNuevo {
  titulo: string;
  explicacion: string;
  nombre: string;
  apellidos: string;
  faltan: string;
  iniciar: string;
  cancelar: string;
  motivoServidor: string;
}

const ES: TextosPacienteNuevo = {
  titulo: "Paciente nuevo",
  explicacion: "Se dará de alta en el expediente. Revisa cómo se separa su nombre de sus apellidos.",
  nombre: "Nombre(s)",
  apellidos: "Apellidos",
  faltan: "Escribe el nombre y los apellidos.",
  iniciar: "Dar de alta e iniciar",
  cancelar: "Cancelar",
  motivoServidor: "Confirma el nombre y los apellidos del paciente nuevo antes de iniciar la consulta.",
};

const EN: TextosPacienteNuevo = {
  titulo: "New patient",
  explicacion: "They will be added to the records. Check how their first name and last name are split.",
  nombre: "First name(s)",
  apellidos: "Last name(s)",
  faltan: "Enter the first name and the last name.",
  iniciar: "Add and start",
  cancelar: "Cancel",
  motivoServidor: "Confirm the new patient's first and last name before starting the visit.",
};

export function textosPacienteNuevo(locale: string | null | undefined): TextosPacienteNuevo {
  return (locale ?? "es").toLowerCase().startsWith("en") ? EN : ES;
}
