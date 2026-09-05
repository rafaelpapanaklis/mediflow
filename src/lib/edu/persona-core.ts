/**
 * DaleControl INSTITUCIONAL — EL NOMBRE DE UNA PERSONA, EN UN SOLO SITIO.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only". Lo importan el
 * layout del panel (servidor), el componente EduPersonaLink (cliente) y las
 * pruebas sin base. Mismo criterio que permissions.ts y campus-core.ts.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────
 * En el panel hay ~90 sitios donde se pinta el nombre de un estudiante, un
 * docente o un paciente. Volverlos clicables metiendo <Link> a mano en cada
 * uno deja, en tres semanas, cuatro maneras distintas de hacer lo mismo: uno
 * con /instituto/estudiantes/{id}, otro con el id equivocado, otro sin
 * comprobar el permiso y otro subrayado en azul dentro de una tabla.
 *
 * Aquí se decide UNA vez: a dónde va cada clase de persona, qué permiso abre
 * su ficha y —lo que de verdad importa— si este nombre concreto DEBE ser un
 * enlace. Quien pinta solo pinta.
 *
 * ── 🔴 LA TRAMPA DEL ID ─────────────────────────────────────────────────
 * No son el mismo id, y confundirlos manda a una ficha que no existe o —peor—
 * a la de otra persona:
 *
 *   · estudiante → el id de **EduStudent** (la INSCRIPCIÓN al padrón),
 *                  NO el de EduUser. Un estudiante tiene las dos filas.
 *   · docente    → el id de **EduUser** (la cuenta). No hay EduTeacher.
 *   · paciente   → el id de EduPatient.
 *
 * Si tienes un EduUser de un alumno en la mano y quieres enlazar su ficha,
 * primero tienes que resolver su EduStudent. No hay atajo y no lo va a haber:
 * este módulo es puro y no consulta la base.
 *
 * ── LO QUE NO ENLAZA NUNCA ──────────────────────────────────────────────
 * La lista completa, con su porqué, vive en el JSDoc de EduPersonaLink
 * (src/components/edu/persona/persona-link.tsx). En una línea: la cadena de
 * custodia, los documentos legales e impresos, los testigos y la vista previa
 * del alta masiva.
 */

/** Las TRES —y sólo tres— clases de persona con ficha propia. */
export type EduPersonaKind = "paciente" | "estudiante" | "docente";

/** Qué fichas puede abrir quien está mirando la pantalla. */
export interface EduPersonaLinksAllowed {
  paciente: boolean;
  estudiante: boolean;
  docente: boolean;
}

/**
 * La raíz de cada ficha.
 *
 * ⚠️ /instituto/estudiantes y /instituto/docentes/{id} todavía NO existen
 * mientras se escribe esto: los crea la ola siguiente, que sale de esta misma
 * rama. Es a propósito — la herramienta se entrega antes que el uso, y ninguna
 * de las dos ramas se integra a main por separado.
 */
const EDU_PERSONA_BASE: Record<EduPersonaKind, string> = {
  paciente: "/instituto/pacientes",
  estudiante: "/instituto/estudiantes",
  docente: "/instituto/docentes",
};

/**
 * El permiso que abre la ficha de cada clase. Son keys de EDU_ALL_PERMISSIONS
 * (src/lib/edu/permissions.ts) escritas como string a propósito: importar el
 * catálogo desde aquí ataría este módulo puro a otro más pesado sin ganar
 * nada. El tipado real lo pone quien llama a eduPersonaLinksAllowed, que sí
 * conoce EduPermissionKey.
 *
 * 🔴 El item del menú escondido nunca fue el candado, y este enlace tampoco:
 * cada ficha vuelve a exigir su permiso en el servidor. Esto decide si se
 * PINTA un enlace, no si se puede entrar.
 */
export const EDU_PERSONA_PERMISSION: Record<EduPersonaKind, string> = {
  paciente: "pacientes.view",
  estudiante: "padron.view",
  docente: "docentes.view",
};

/**
 * La ruta de la ficha. Un id vacío o que no sea cadena LANZA: el que decide
 * no enlazar es quien llama (con eduPersonaDebeEnlazar), no esta función. Si
 * se tragara el id vacío devolvería "/instituto/pacientes/", que es la LISTA
 * de pacientes — un enlace que parece funcionar y lleva a otro sitio.
 *
 * El id va con encodeURIComponent: hoy son cuid, pero una barra o un signo de
 * interrogación en un id partiría la ruta en dos.
 */
export function eduPersonaHref(kind: EduPersonaKind, id: string): string {
  const base = EDU_PERSONA_BASE[kind];
  if (!base) {
    throw new Error(`eduPersonaHref: clase de persona desconocida: ${String(kind)}`);
  }
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(
      `eduPersonaHref: id vacío o no-string para "${kind}". ` +
        "Si el id puede faltar, no llames aquí: usa eduPersonaDebeEnlazar y pinta texto plano.",
    );
  }
  return `${base}/${encodeURIComponent(id)}`;
}

/**
 * Los tres booleanos, a partir de una FUNCIÓN de permiso.
 *
 * Recibe `has` en vez de importar permissions.ts para que este módulo siga
 * siendo puro y sin dependencias. Quien lo llama (el layout del panel) le pasa
 * hasEduPermission ya atado a la sesión.
 *
 * Cinturón: si llega algo que no es una función, se niega todo. Falla cerrado.
 */
export function eduPersonaLinksAllowed(has: (key: string) => boolean): EduPersonaLinksAllowed {
  if (typeof has !== "function") {
    return { paciente: false, estudiante: false, docente: false };
  }
  return {
    paciente: has(EDU_PERSONA_PERMISSION.paciente) === true,
    estudiante: has(EDU_PERSONA_PERMISSION.estudiante) === true,
    docente: has(EDU_PERSONA_PERMISSION.docente) === true,
  };
}

/**
 * LA decisión, en una función pura: ¿este nombre concreto se vuelve enlace?
 *
 * Las dos condiciones tienen que cumplirse, y las dos niegan por sí solas:
 *   1. Hay id. Un paciente enmascarado en la clínica en vivo llega con
 *      patientId: null A PROPÓSITO — no puede volverse enlace.
 *   2. Quien mira puede abrir esa ficha. A un alumno sin padron.view los
 *      nombres de sus compañeros se le quedan como texto, igual que hoy.
 *
 * Vive aquí y no dentro del componente para poder probarla sin montar React.
 */
export function eduPersonaDebeEnlazar(
  kind: EduPersonaKind,
  id: string | null | undefined,
  allowed: EduPersonaLinksAllowed | null | undefined,
): boolean {
  if (typeof id !== "string" || id.trim() === "") return false;
  if (typeof allowed !== "object" || allowed === null) return false;
  return allowed[kind] === true;
}
