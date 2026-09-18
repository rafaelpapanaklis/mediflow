/**
 * `pacientes_con_etiqueta` — quiénes llevan una etiqueta (por defecto, VIP).
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────
 * Sustituye a la chip «VIP» de /dashboard/patients, que se quitó de la lista
 * (ws1-t5). El criterio es el de esa chip y el del filtro «Etiquetas clínicas»
 * del cajón de filtros avanzados, que sigue en la pantalla:
 * `tags: { hasSome: [...] }` sobre `Patient.tags` (src/app/api/patients/route.ts).
 * La estrella de la fila marca VIP escribiendo literalmente "VIP" en `tags`;
 * el resto de etiquetas las escribe recepción a mano ("Alergia", "Crónico",
 * "Embarazo", "Pediátrico", "Nuevo"…).
 *
 * ── MAYÚSCULAS ─────────────────────────────────────────────────────────
 * Postgres compara los elementos del arreglo tal cual, así que "vip" no
 * encontraría a los "VIP". Se prueban las cuatro formas usuales de la misma
 * palabra en una sola consulta; es lo más lejos que se llega sin traerse el
 * padrón entero para filtrarlo a mano.
 *
 * ── EL SCOPE SALE DE `buildPatientWhere` ───────────────────────────────
 * El clinicId de la sesión, la visibilidad por paciente y el `deletedAt: null`
 * de ARCO. Sin filtro de estado, igual que la chip con «Todos» puesto; el
 * estado viaja en la fila. Devuelve identidad y contacto: nada de expediente
 * ni de saldo (eso es de pacientes_con_deuda y exige `billing.view`).
 */

import { z } from "zod";
import { buildPatientWhere } from "@/lib/auth-context";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  plural,
  recortar,
  type Lista,
} from "./base";
import { etiquetaEstadoPaciente } from "./cumpleanos";
import type { SabinaCtx } from "../tipos";

export const ETIQUETA_VIP = "VIP";

const parametros = z.object({
  /** La etiqueta a buscar, tal como está en la ficha. Sin ella, "VIP". */
  etiqueta: z.string().trim().min(1, "la etiqueta no puede ir vacía").max(60).optional(),
});

export type ParamsEtiqueta = z.infer<typeof parametros>;

export interface EtiquetaFila {
  paciente: string;
  folio: string | null;
  telefono: string | null;
  correo: string | null;
  /** Todas las etiquetas de la ficha, no solo la buscada. */
  etiquetas: string[];
  /** ACTIVE | INACTIVE | ARCHIVED, tal cual en la ficha. */
  estado: string;
}

export interface DatosEtiqueta {
  etiqueta: string;
  pacientes: Lista<EtiquetaFila>;
}

export const pacientesConEtiqueta = definirHerramienta<ParamsEtiqueta, DatosEtiqueta>({
  nombre: "pacientes_con_etiqueta",
  descripcion:
    "Los pacientes que llevan una etiqueta en su ficha —por defecto VIP—, con su folio, teléfono y correo. " +
    "Úsala para «¿quiénes son mis pacientes VIP?», «¿cuántos VIP tengo?» o «¿quién tiene la etiqueta " +
    "Alergia / Crónico / Embarazo / Pediátrico?». No devuelve saldo ni expediente.",
  parametros,
  permiso: "patients.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosEtiqueta> {
    const db = dbDe(ctx);
    const etiqueta = params.etiqueta?.trim() || ETIQUETA_VIP;

    const where = buildPatientWhere(comoAuthContext(ctx), {
      tags: { hasSome: variantes(etiqueta) },
    });

    const [total, filas] = await Promise.all([
      db.patient.count({ where }),
      db.patient.findMany({
        where,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: 51,
        select: {
          firstName: true,
          lastName: true,
          patientNumber: true,
          phone: true,
          email: true,
          tags: true,
          status: true,
        },
      }),
    ]);

    const pacientes: EtiquetaFila[] = (filas as any[]).map((p) => ({
      paciente: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
      folio: p.patientNumber ?? null,
      telefono: p.phone ?? null,
      correo: p.email ?? null,
      etiquetas: Array.isArray(p.tags) ? p.tags : [],
      estado: p.status ?? "ACTIVE",
    }));

    return { etiqueta, pacientes: recortar(pacientes, total) };
  },

  vacio: (d) => d.pacientes.total === 0,

  resumir(d) {
    const linea = (p: EtiquetaFila) =>
      `${p.paciente} (folio ${p.folio ?? "sin folio"}${p.telefono ? `, tel. ${p.telefono}` : ""})` +
      `${p.estado !== "ACTIVE" ? ` [${etiquetaEstadoPaciente(p.estado)}]` : ""}`;
    const lista = lineasDeLista(d.pacientes.filas, linea);
    const primero = d.pacientes.filas[0];
    const cola = lista ? "" : primero ? ` Es ${linea(primero)}.` : "";
    return (
      `${plural(d.pacientes.total, "paciente con la etiqueta", "pacientes con la etiqueta")} ${d.etiqueta}` +
      `${fraseRecorte(d.pacientes, "pacientes")}.${cola}${lista}`
    );
  },
});

/** "vip" → ["vip", "VIP", "Vip"]; sin duplicados, para el `hasSome`. */
function variantes(etiqueta: string): string[] {
  const capital = etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1).toLowerCase();
  const out: string[] = [];
  for (const v of [etiqueta, etiqueta.toUpperCase(), etiqueta.toLowerCase(), capital]) {
    if (out.indexOf(v) === -1) out.push(v);
  }
  return out;
}
