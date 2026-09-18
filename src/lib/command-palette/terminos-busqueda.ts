/**
 * Los TÉRMINOS de la búsqueda global (la paleta del topbar) y las condiciones
 * de Prisma que salen de ellos. LÓGICA PURA: sin Prisma en runtime (solo
 * tipos), sin React, para poder probarla sin base de datos.
 *
 * ── EL BUG QUE ARREGLA ─────────────────────────────────────────────────
 * GET /api/dashboard/search comparaba la CADENA ENTERA contra cada campo:
 * `firstName contains "Ana Pérez"` OR `lastName contains "Ana Pérez"`. Ningún
 * campo contiene el nombre completo, así que teclear nombre y apellido —lo
 * más natural para encontrar a alguien— devolvía cero pacientes, cero citas
 * y cero facturas.
 *
 * Ahora la búsqueda se parte por espacios y CADA término tiene que casar en
 * ALGÚN campo (AND de ORs): "Ana Pérez" y "Pérez Ana" encuentran lo mismo.
 * Es el mismo criterio que ya usa el buscador de pacientes
 * (src/lib/patients/patient-search-core.ts → patientSearchTokens).
 *
 * Los CAMPOS son exactamente los de antes —no se amplía qué se puede buscar—
 * y la visibilidad (clinicId + patientVisibilityAnd) la sigue poniendo la
 * ruta: estas funciones solo arman el texto.
 */
import type { Prisma } from "@prisma/client";

/** "  Ana   Pérez " → ["Ana", "Pérez"]. Nunca términos vacíos. */
export function terminosBusqueda(q: unknown): string[] {
  if (typeof q !== "string") return [];
  return q.trim().split(/\s+/).filter(Boolean);
}

/**
 * Largo mínimo para consultar la base. Era 2 y por eso «c» no enseñaba nada:
 * Rafael quiere que una sola letra ya traiga pacientes, facturas y citas que
 * la contengan. El rebote de 200 ms del input y el rate limit de la ruta
 * siguen frenando el goteo de peticiones.
 */
export const LARGO_MINIMO_BUSQUEDA = 1;

const ci = (t: string) => ({ contains: t, mode: "insensitive" as const });

/** Nombre o apellido del paciente de la fila: los dos campos de siempre. */
function porPaciente(t: string) {
  return [{ patient: { firstName: ci(t) } }, { patient: { lastName: ci(t) } }];
}

/** Citas: cada término casa en el nombre o el apellido del paciente. */
export function condicionesCitas(terminos: string[]): Prisma.AppointmentWhereInput[] {
  return terminos.map((t) => ({ OR: porPaciente(t) }));
}

/** Facturas: cada término casa en el folio o en el nombre/apellido del paciente. */
export function condicionesFacturas(terminos: string[]): Prisma.InvoiceWhereInput[] {
  return terminos.map((t) => ({ OR: [{ invoiceNumber: ci(t) }, ...porPaciente(t)] }));
}

/**
 * Pacientes, RESPALDO: si la consulta normalizada (sin acentos, teléfono
 * limpio) de findPatientIdsBySearch falla, se cae a estos cinco campos, que
 * son los mismos que la ruta miraba desde siempre.
 */
export function condicionesPacientesRespaldo(terminos: string[]): Prisma.PatientWhereInput[] {
  return terminos.map((t) => ({
    OR: [
      { firstName: ci(t) },
      { lastName: ci(t) },
      { patientNumber: { contains: t } },
      { phone: { contains: t } },
      { email: ci(t) },
    ],
  }));
}
