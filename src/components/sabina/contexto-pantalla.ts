/**
 * DÓNDE ESTÁ QUIEN PREGUNTA — el lado del navegador.
 *
 * Traduce la ruta del panel a la pista mínima que viaja con la pregunta.
 * Módulo PURO (sin React, sin `window`) para poder probarlo entero: lo que
 * decide qué se manda es una función con entradas y salidas, no un efecto.
 *
 * 🔴 ESTO NO AUTORIZA NADA. Lo que sale de aquí es una sugerencia; el servidor
 * (`@/lib/sabina/contexto`) vuelve a comprobar el paciente contra la sesión
 * —clínica, visibilidad, `deletedAt` y `patients.view`— antes de creérselo, y
 * las herramientas lo comprueban otra vez. Si alguien cambiara a mano el id
 * en la petición, no leería ni una fila de un paciente que no le toca.
 *
 * ── LO QUE SE MANDA, Y NADA MÁS (regla 2 del contrato: se paga en CADA
 *    pregunta) ───────────────────────────────────────────────────────────
 *   · `pantalla` — un id de una lista CERRADA, la misma que valida el
 *     servidor. Nunca la ruta cruda: una URL lleva ids, filtros y a veces
 *     texto escrito por el usuario, y eso acabaría dentro del prompt.
 *   · `pacienteId` — solo el de la ficha abierta, el de la pantalla de
 *     radiografías, o el de la consulta EN CURSO (el paciente que está en el
 *     sillón). Es el dato que hace que valga la pena todo esto: sin él, el
 *     doctor tiene que escribir el nombre de quien tiene delante.
 *   · `fecha` — el día que está mirando la agenda.
 *
 * ── LO QUE NO SE MANDA ──────────────────────────────────────────────────
 *   · la pestaña abierta de la ficha (`?tab=…`), los filtros y el resto de
 *     parámetros: no cambian ninguna respuesta;
 *   · el id de la cita abierta: reagendar y cancelar ESCRIBEN, y darles un id
 *     puesto por el cliente es justo lo que prohíbe la regla roja del encargo;
 *   · nada de las pantallas que no están en la lista: en ellas la pregunta
 *     cuesta exactamente lo que costaba antes de que Sabina viviera en un cajón.
 */

/**
 * La pista que viaja con la pregunta. Vive aquí, en el módulo PURO, y no en el
 * almacén: la importan el navegador (para armarla) y el servidor (para validar
 * las etiquetas), y ninguno de los dos debe arrastrar al otro.
 */
export interface ContextoPantalla {
  pantalla?: string;
  pacienteId?: string;
  fecha?: string;
}

/** Los ids de pantalla que existen. Lista CERRADA. */
export type PantallaSabina =
  | "ficha-paciente"
  | "pacientes"
  | "agenda"
  | "caja"
  | "facturacion"
  | "radiografias"
  | "inicio";

/**
 * Cómo se llama cada pantalla en español. FUENTE ÚNICA: la usa el prompt del
 * servidor (@/lib/sabina/contexto) y el cartelito del cajón que le dice al
 * doctor qué está viendo Sabina. Dos copias de esta lista se separan al primer
 * cambio y entonces la pantalla promete una cosa y el prompt dice otra.
 */
export const ETIQUETA_PANTALLA: Record<PantallaSabina, string> = {
  "ficha-paciente": "la ficha de un paciente",
  pacientes: "la lista de pacientes",
  agenda: "la agenda",
  caja: "Caja",
  facturacion: "facturación",
  radiografias: "las radiografías de un paciente",
  inicio: "el inicio del panel",
};

/** ¿Este id es una pantalla de la lista? Lo usa el servidor antes de creérselo. */
export function esPantallaConocida(id: unknown): id is PantallaSabina {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(ETIQUETA_PANTALLA, id);
}

/** Un id de la base: cuid/uuid y poco más. Lo que no encaje, no viaja. */
const ID_PLAUSIBLE = /^[A-Za-z0-9_-]{6,64}$/;
/** Segmentos de ruta que NO son un id de paciente aunque estén en su sitio. */
const NO_SON_ID = new Set(["new", "nuevo", "nueva", "create"]);

function idValido(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  if (!v || NO_SON_ID.has(v.toLowerCase()) || !ID_PLAUSIBLE.test(v)) return null;
  return v;
}

function fechaValida(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Lo mínimo que hace falta de la consulta activa: quién está en el sillón. */
export interface ConsultaEnCurso {
  patientId?: string | null;
}

/**
 * La pista, a partir de la ruta.
 *
 * @param pathname  `usePathname()`.
 * @param buscar    `useSearchParams()` o cualquier cosa con `.get(clave)`.
 * @param consulta  La consulta abierta, si la hay (`useActiveConsult`).
 */
export function contextoDePantalla(
  pathname: string | null | undefined,
  buscar?: { get(clave: string): string | null } | null,
  consulta?: ConsultaEnCurso | null,
): ContextoPantalla {
  const ruta = typeof pathname === "string" ? pathname.replace(/\/+$/, "") : "";
  const partes = ruta.split("/").filter(Boolean); // ["dashboard", "patients", "id"]
  const param = (clave: string) => (buscar ? buscar.get(clave) : null);

  let pantalla: PantallaSabina | null = null;
  let pacienteId: string | null = null;
  let fecha: string | null = null;

  if (partes[0] === "dashboard") {
    const seccion = partes[1] ?? "";
    if (partes.length === 1) {
      pantalla = "inicio";
    } else if (seccion === "patients") {
      pacienteId = idValido(partes[2]);
      pantalla = pacienteId ? "ficha-paciente" : "pacientes";
    } else if (seccion === "xrays") {
      pantalla = "radiografias";
      pacienteId = idValido(partes[2]) ?? idValido(param("patient"));
    } else if (seccion === "agenda") {
      pantalla = "agenda";
      fecha = fechaValida(param("date"));
    } else if (seccion === "caja") {
      pantalla = "caja";
    } else if (seccion === "billing") {
      pantalla = "facturacion";
    }
  }

  // El paciente que está EN EL SILLÓN. Vale para cualquier pantalla: el doctor
  // con una consulta abierta que pregunta «¿qué problemas dentales tiene?»
  // habla de ese, esté mirando la agenda o la caja. Nunca pisa al de la URL:
  // si la ficha abierta es de otro, manda la ficha.
  if (!pacienteId) pacienteId = idValido(consulta?.patientId);

  return {
    ...(pantalla ? { pantalla } : {}),
    ...(pacienteId ? { pacienteId } : {}),
    ...(fecha ? { fecha } : {}),
  };
}
