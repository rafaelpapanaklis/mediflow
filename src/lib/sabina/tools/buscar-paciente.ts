/**
 * `buscar_paciente` — encuentra a una persona por nombre, teléfono o folio.
 *
 * ── SE REUSA EL BUSCADOR DEL PANEL, NO SE ESCRIBE OTRO ─────────────────
 * El criterio sale entero de @/lib/patients: `patientSearchTokens` parte el
 * término y `buildPatientSearchSql` es la consulta normalizada. Eso trae gratis
 * las dos cosas que un `contains` no hace, y que costaron un hallazgo cada una:
 *
 *  · SIN ACENTOS — `mode:"insensitive"` es ILIKE: arregla las mayúsculas y NO
 *    los acentos, así que "Perez" devolvía CERO teniendo a "Pérez" en la ficha.
 *    La normalización va dentro de la consulta, con `translate()` y no
 *    `unaccent()` (que es una extensión y en esta base no está instalada).
 *  · TELÉFONO NORMALIZADO — se guarda como lo teclea recepción
 *    ("+52 55 1234 5678"), así que pegar el número copiado de WhatsApp
 *    ("5512345678") no encontraba a nadie. Se compara por dígitos y por los
 *    últimos 10, que es la convención de emparejamiento de toda la casa.
 *
 * Y el folio entra en el texto buscable, así que "P0042" —lo que trae impreso
 * el recibo del paciente— encuentra al paciente.
 *
 * ── EL CINTURÓN ────────────────────────────────────────────────────────
 * Si la consulta normalizada no se puede hacer, se cae al `contains` de siempre
 * en vez de devolver una lista vacía: peor que no encontrar a "Pérez" sin acento
 * es no encontrar a nadie. Es el mismo cinturón, y por el mismo motivo, que
 * `findPatientIdsBySearch`.
 *
 * ── EL TENANT NO SE MUEVE DE SITIO ─────────────────────────────────────
 * La búsqueda solo devuelve ids CANDIDATOS y entran como un `AND` más dentro de
 * `buildPatientWhere(ctx)`, que sigue llevando el clinicId de la sesión, la
 * visibilidad por paciente y el `deletedAt: null` de ARCO. Aun así la propia
 * consulta va acotada por clinicId.
 *
 * ── QUÉ DEVUELVE, Y QUÉ NO ─────────────────────────────────────────────
 * Identidad y contacto (nombre, folio, teléfono, correo, edad), última visita y
 * próxima cita. NO devuelve alergias, padecimientos, medicación, notas ni saldo:
 * el expediente no viaja al modelo por una búsqueda, y el dinero exige
 * `billing.view` — que esta herramienta no comprueba.
 */

import { z } from "zod";
import { buildPatientWhere } from "@/lib/auth-context";
import { ageFromDob } from "@/lib/format";
import { patientSearchTokens } from "@/lib/patients/patient-search-core";
import { buildPatientSearchSql } from "@/lib/patients/patient-search";
import {
  comoAuthContext,
  dbDe,
  definirHerramienta,
  fraseRecorte,
  plural,
  recortar,
  type Lista,
} from "./base";
import { fechaDe } from "./fechas";
import { ESTADOS_ACTIVOS, etiquetaEstado } from "./estados";
import type { SabinaCtx, SabinaDb } from "../tipos";

/** Igual que el default de `findPatientIdsBySearch`: acota el trabajo del raw. */
const TOPE_CANDIDATOS = 5000;

const parametros = z.object({
  /** Nombre, apellido, teléfono, correo o folio. Se puede mezclar: "Ana Pérez 5512". */
  termino: z.string().min(1, "hace falta algo que buscar").max(120),
});

export type ParamsBuscar = z.infer<typeof parametros>;

export interface PacienteFila {
  paciente: string;
  folio: string | null;
  telefono: string | null;
  correo: string | null;
  edad: number | null;
  estado: string;
  /** Última nota del expediente, en el calendario de la clínica. */
  ultimaVisita: string | null;
  proximaCita: { fecha: string; estado: string; motivo: string | null } | null;
}

export interface DatosBuscar {
  termino: string;
  resultados: Lista<PacienteFila>;
  /** `true` si la búsqueda normalizada no se pudo hacer y se usó el criterio simple. */
  busquedaDegradada: boolean;
}

export const buscarPaciente = definirHerramienta<ParamsBuscar, DatosBuscar>({
  nombre: "buscar_paciente",
  descripcion:
    "Busca pacientes por nombre, apellido, teléfono, correo o folio y devuelve su identidad, contacto, " +
    "edad, última visita y próxima cita. Encuentra igual con acentos o sin ellos («Perez» halla a " +
    "«Pérez») y con el teléfono en cualquier formato. Úsala cuando la pregunta sea sobre UNA persona " +
    "concreta: «¿tiene cita Ana Pérez?», «¿cuál es el teléfono de Muñoz?», «busca al paciente P0042». " +
    "No devuelve expediente clínico ni saldo.",
  parametros,
  permiso: "patients.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosBuscar> {
    const db = dbDe(ctx);
    const auth = comoAuthContext(ctx);
    const termino = params.termino.trim();

    const crudos = termino.split(/\s+/).filter(Boolean);
    const tokens = patientSearchTokens(termino);

    let candidatos: string[] | null = null;
    // Solo si la normalización dejó algo: si el término era puro comodín de LIKE
    // ("%"), `tokens` sale vacío y saltarse el filtro devolvería el padrón entero
    // — el mismo fallo que el hallazgo 41, por otra puerta.
    if (tokens.length > 0) {
      candidatos = await idsCandidatos(db, ctx.clinicId, tokens);
    }

    const filtro =
      candidatos !== null
        ? [{ id: { in: candidatos } }]
        : crudos.map((tok) => ({
            OR: [
              { firstName: { contains: tok, mode: "insensitive" } },
              { lastName: { contains: tok, mode: "insensitive" } },
              { email: { contains: tok, mode: "insensitive" } },
              { phone: { contains: tok, mode: "insensitive" } },
              { patientNumber: { contains: tok, mode: "insensitive" } },
            ],
          }));

    const where = buildPatientWhere(auth, { AND: filtro });
    const ahora = new Date();

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
          dob: true,
          status: true,
          // Mismos dos includes que la lista de /dashboard/patients: la próxima
          // cita se acota a la SEDE ACTIVA (cada sucursal agenda por separado) y
          // el expediente NO, porque la última visita pudo ser en la otra sede y
          // eso es justo lo que se quiere ver.
          appointments: {
            where: {
              clinicId: ctx.clinicId,
              startsAt: { gte: ahora },
              status: { notIn: [...ESTADOS_ACTIVOS] },
            },
            orderBy: { startsAt: "asc" },
            take: 1,
            select: { startsAt: true, status: true, type: true },
          },
          records: { orderBy: { visitDate: "desc" }, take: 1, select: { visitDate: true } },
        },
      }),
    ]);

    const resultados: PacienteFila[] = (filas as any[]).map((p) => {
      const cita = p.appointments?.[0];
      const visita = p.records?.[0]?.visitDate;
      return {
        paciente: [p.firstName, p.lastName].filter(Boolean).join(" ").trim(),
        folio: p.patientNumber ?? null,
        telefono: p.phone ?? null,
        correo: p.email ?? null,
        edad: ageFromDob(p.dob),
        estado: p.status ?? "ACTIVE",
        ultimaVisita: visita ? fechaDe(new Date(visita), ctx.timezone) : null,
        proximaCita: cita
          ? {
              fecha: fechaDe(new Date(cita.startsAt), ctx.timezone),
              estado: etiquetaEstado(cita.status),
              motivo: cita.type ?? null,
            }
          : null,
      };
    });

    return {
      termino,
      resultados: recortar(resultados, total),
      busquedaDegradada: tokens.length > 0 && candidatos === null,
    };
  },

  vacio: (d) => d.resultados.total === 0,

  resumir(d) {
    if (d.resultados.total === 1) {
      const p = d.resultados.filas[0];
      const cita = p.proximaCita ? `, próxima cita el ${p.proximaCita.fecha}` : ", sin cita agendada";
      return `${p.paciente} (folio ${p.folio ?? "sin folio"}${p.telefono ? `, tel. ${p.telefono}` : ""})${cita}.`;
    }
    return (
      `${plural(d.resultados.total, "paciente coincide", "pacientes coinciden")} con "${d.termino}"` +
      `${fraseRecorte(d.resultados, "pacientes")}.`
    );
  },
});

/**
 * Ids candidatos con la consulta normalizada del repo. `null` = «no pude
 * preguntar», y entonces el llamador cae al criterio de siempre.
 *
 * Se ejecuta el SQL que arma `buildPatientSearchSql` —así el criterio sigue
 * teniendo un solo dueño— pero a través del cliente inyectado, que es lo que
 * permite probar el camino degradado sin base.
 */
async function idsCandidatos(
  db: SabinaDb,
  clinicId: string,
  tokens: ReturnType<typeof patientSearchTokens>,
): Promise<string[] | null> {
  try {
    const filas = await db.$queryRaw(
      buildPatientSearchSql({ clinicIds: [clinicId], tokens, limit: TOPE_CANDIDATOS }),
    );
    return (filas as Array<{ id: string }>).map((f) => f.id);
  } catch (err) {
    console.error("[sabina/buscar_paciente] la búsqueda normalizada falló, uso el contains:", err);
    return null;
  }
}
