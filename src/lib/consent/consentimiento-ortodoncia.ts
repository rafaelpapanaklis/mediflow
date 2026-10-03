// ─────────────────────────────────────────────────────────────────────────────
// ¿Esta carta es el consentimiento de ORTODONCIA? (ws1-t3, auditoría BEVADENT F1)
//
// Ortodoncia avisa «Falta el consentimiento informado firmado» mientras el
// paciente no tenga una carta de ortodoncia firmada y vigente. Antes solo
// contaba `procedureKey = "ortodoncia"`, y las cartas creadas desde una
// plantilla DE LA CLÍNICA (Administración → Plantillas) se guardaban con
// `procedureKey = null`: la clínica firmaba su carta de ortodoncia y el aviso
// seguía saliendo.
//
// Dos arreglos, y los dos salen de aquí:
//   · al crear desde una plantilla de la clínica se guarda de qué procedimiento
//     es (`claveDePlantillaPorNombre`): el nombre del catálogo tal cual, o un
//     nombre que diga «ortodoncia»;
//   · las ya creadas (procedureKey null) se reconocen por el título: si dice
//     «ortodoncia», cuenta (`whereConsentimientoDeOrtodoncia`).
//
// El ASENTIMIENTO del menor («Asentimiento del menor — ortodoncia») NO es el
// consentimiento: lo firma el menor junto al de su tutor, no en su lugar.
//
// PURO: sin Prisma ni React. Lo importan el servidor y las pruebas.
// ─────────────────────────────────────────────────────────────────────────────

import { CONSENT_TEMPLATES, findConsentTemplate } from "./templates";

export const CLAVE_ORTODONCIA = "ortodoncia";

/** Nombre del catálogo («Ortodoncia (brackets o alineadores)»): el que dice el aviso. */
export const NOMBRE_CARTA_ORTODONCIA = findConsentTemplate(CLAVE_ORTODONCIA)?.label ?? "Ortodoncia";

/** Minúsculas y sin acentos: «Ortodóncia» y «ORTODONCIA» son la misma palabra. */
function normalizar(texto: string): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function esAsentimiento(titulo: string): boolean {
  return normalizar(titulo).startsWith("asentimiento");
}

/**
 * De qué procedimiento del catálogo es una plantilla de la clínica, por su nombre.
 * Las sembradas se llaman igual que el catálogo; una renombrada que diga
 * «ortodoncia» es la de ortodoncia. `null` = no se sabe (se guarda como hasta hoy).
 */
export function claveDePlantillaPorNombre(nombre: string | null | undefined): string | null {
  const n = normalizar(nombre ?? "");
  if (!n) return null;
  const delCatalogo = CONSENT_TEMPLATES.find((p) => normalizar(p.label) === n);
  if (delCatalogo) return delCatalogo.key;
  if (esAsentimiento(n)) return null;
  return n.includes(CLAVE_ORTODONCIA) ? CLAVE_ORTODONCIA : null;
}

/**
 * La misma regla que `whereConsentimientoDeOrtodoncia`, sobre una fila ya leída
 * (aquí además sin acentos; «ortodoncia» no lleva, así que no cambia nada).
 */
export function esConsentimientoDeOrtodoncia(c: { procedureKey: string | null; procedure: string }): boolean {
  if (c.procedureKey === CLAVE_ORTODONCIA) return true;
  if (c.procedureKey != null) return false;
  return !esAsentimiento(c.procedure) && normalizar(c.procedure).includes(CLAVE_ORTODONCIA);
}

/**
 * Filtro de Prisma: cartas de ortodoncia por clave, o sin clave y con «ortodoncia»
 * en el título (insensible a mayúsculas). Va DENTRO de un `where` que ya lleva
 * `clinicId` y `patientId`; aquí no se filtra por clínica.
 */
export function whereConsentimientoDeOrtodoncia() {
  return {
    OR: [
      { procedureKey: CLAVE_ORTODONCIA },
      {
        procedureKey: null,
        procedure: { contains: CLAVE_ORTODONCIA, mode: "insensitive" as const },
        NOT: { procedure: { startsWith: "asentimiento", mode: "insensitive" as const } },
      },
    ],
  };
}
