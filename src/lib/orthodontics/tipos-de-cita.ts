// Ortodoncia — el catálogo de tipos de cita de Configuración: qué fila es la
// FIJA y cuándo un catálogo se puede guardar (ws1-t3, 28-sep-2026).
//
// Puro: sin Prisma, sin React. Lo usan la pantalla de Configuración, la acción
// que guarda y el cargador; y lo prueban los tests en node.
//
// EL FALLO QUE ARREGLA. La fila fija («Control de ortodoncia») se reconocía
// por su TEXTO. Si alguien agregaba un tipo nuevo y tecleaba ese mismo texto,
// la fila nueva se volvía «fija» a media escritura: el campo se bloqueaba, el
// botón de quitar desaparecía y quedaba un duplicado que solo se iba
// recargando. Ahora la fila fija se reconoce por su CLAVE (`id: "control"`).
//
// LO QUE NO CAMBIA. La Agenda sigue reconociendo un control por el TEXTO de la
// cita (`Appointment.type`, que es texto libre en la base: `esCitaControlOrto`).
// Por eso la fila fija lleva SIEMPRE ese texto exacto y ninguna otra fila puede
// llamarse igual: dos chips con el mismo nombre al agendar serían el mismo
// control con dos caras.

import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";

/** La clave de la fila fija. Es la que ya traía el catálogo por defecto. */
export const ID_TIPO_CITA_CONTROL = "control";

export interface TipoDeCita {
  id: string;
  label: string;
  /** ws1-t1 ronda 2 — minutos de esta cita. `null`/`undefined` = sin valor
   * propio, cae al mejor esfuerzo (`whatsapp-bot-booking.ts`). */
  durationMin?: number | null;
}

/** ¿Es la fila fija? Por su CLAVE, nunca por lo que diga su texto. */
export function esTipoFijo(tipo: Pick<TipoDeCita, "id">): boolean {
  return tipo.id === ID_TIPO_CITA_CONTROL;
}

/** Para comparar nombres: sin espacios de más, sin mayúsculas y sin acentos. */
export function nombreComparable(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Deja el catálogo con UNA fila fija, con su clave y su texto exacto, sin
 * mover las demás de sitio:
 *  - la fila con clave "control" recupera su texto exacto, diga lo que diga;
 *  - si no hay ninguna con esa clave pero sí una con ese texto (catálogos
 *    guardados antes de este cambio), esa pasa a ser la fija;
 *  - si no hay ninguna de las dos, se añade al final;
 *  - cualquier OTRA fila que se llame igual que la fija se quita: era el
 *    duplicado que dejaba el fallo.
 */
/** Copia id/label y, SOLO si trae una duración de verdad, también
 * durationMin — nunca la clave con `undefined`: un catálogo sin duraciones
 * propias (el caso de hoy, el de casi todos los tests) tiene que seguir
 * comparando IGUAL con `assert.deepEqual` que antes de esta ronda. */
function copiar(t: TipoDeCita): TipoDeCita {
  return t.durationMin != null ? { id: t.id, label: t.label, durationMin: t.durationMin } : { id: t.id, label: t.label };
}

export function normalizarCatalogo(tipos: readonly TipoDeCita[]): TipoDeCita[] {
  const textoFijo = nombreComparable(TIPO_CITA_CONTROL_ORTO);
  const conClave = tipos.findIndex((t) => esTipoFijo(t));
  const sitio = conClave >= 0 ? conClave : tipos.findIndex((t) => nombreComparable(t.label) === textoFijo);
  // La duración SÍ se conserva (ws1-t1 ronda 2): solo el id/label de la fila
  // fija son inmovibles, su duración la sigue editando la clínica.
  const fija: TipoDeCita = copiar({
    id: ID_TIPO_CITA_CONTROL,
    label: TIPO_CITA_CONTROL_ORTO,
    durationMin: sitio >= 0 ? tipos[sitio].durationMin : undefined,
  });

  const salida: TipoDeCita[] = [];
  tipos.forEach((t, i) => {
    if (i === sitio) {
      salida.push(fija);
      return;
    }
    if (esTipoFijo(t) || nombreComparable(t.label) === textoFijo) return;
    salida.push(copiar(t));
  });
  if (sitio < 0) salida.push(fija);
  return salida;
}

/**
 * ¿Se puede guardar este catálogo? Devuelve el motivo por el que no, en
 * palabras para la clínica, o `null` si está bien. Es la MISMA regla en la
 * pantalla y en el servidor.
 */
export function motivoDeRechazo(tipos: readonly TipoDeCita[]): string | null {
  if (tipos.length === 0) return "Deja al menos un tipo de cita en el catálogo.";
  if (tipos.some((t) => !t.id.trim() || !t.label.trim())) return "Cada tipo de cita necesita clave y nombre.";
  if (tipos.some((t) => t.durationMin != null && (!Number.isFinite(t.durationMin) || t.durationMin <= 0))) {
    return "La duración tiene que ser un número de minutos mayor que cero, o dejarse en blanco.";
  }

  const fijas = tipos.filter((t) => esTipoFijo(t));
  if (fijas.length !== 1 || fijas[0].label !== TIPO_CITA_CONTROL_ORTO) {
    return `El catálogo tiene que conservar el tipo de cita «${TIPO_CITA_CONTROL_ORTO}»: la Agenda lo usa para reconocer los controles.`;
  }

  const claves = new Set<string>();
  const nombres = new Map<string, string>();
  for (const t of tipos) {
    if (claves.has(t.id)) return "Hay dos tipos de cita con la misma clave. Recarga la página e inténtalo otra vez.";
    claves.add(t.id);
    const n = nombreComparable(t.label);
    if (nombres.has(n)) {
      return n === nombreComparable(TIPO_CITA_CONTROL_ORTO)
        ? `«${TIPO_CITA_CONTROL_ORTO}» ya existe y es fijo. Ponle otro nombre al tipo nuevo.`
        : `Hay dos tipos de cita que se llaman «${t.label.trim()}». Cámbiale el nombre a uno.`;
    }
    nombres.set(n, t.label);
  }
  return null;
}

/** Una clave nueva para un tipo que agrega la clínica. Nunca la de la fila fija. */
export function nuevaClave(existentes: readonly Pick<TipoDeCita, "id">[]): string {
  let n = existentes.length + 1;
  while (existentes.some((t) => t.id === `tipo-${n}`)) n++;
  return `tipo-${n}`;
}
