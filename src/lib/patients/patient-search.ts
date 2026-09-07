/**
 * Búsqueda de pacientes SIN ACENTOS y con el TELÉFONO NORMALIZADO — la
 * mitad que habla con Postgres. La lógica pura (cómo se parte el término,
 * cómo se normaliza) vive en ./patient-search-core.ts.
 *
 * ── EL BUG ─────────────────────────────────────────────────────────────
 * `contains` + `mode:"insensitive"` de Prisma es ILIKE: arregla las
 * MAYÚSCULAS y no los acentos. En la clínica de prueba, buscar "Perez"
 * devolvía CERO con "Pérez" en la ficha. Y el teléfono se guarda como lo
 * teclea recepción ("+52 55 1234 5678"), así que pegar "5512345678" —lo que
 * hace cualquiera con el número copiado de WhatsApp— tampoco encontraba
 * nada: el LIKE es literal y los espacios están en medio.
 *
 * ── POR QUÉ ASÍ, Y NO COMO EN INSTITUTO ────────────────────────────────
 * El vertical instituto resuelve lo mismo con una COLUMNA normalizada que
 * la aplicación escribe en cada alta y cada edición (src/lib/edu/search.ts
 * + sql/edu-ola-1b.sql). Es mejor si se puede: se busca con el `contains`
 * de siempre y hay índice.
 *
 * Aquí NO se puede sin romper cosas: un paciente dental nace desde SEIS
 * sitios distintos (alta manual, importación masiva, bot de WhatsApp,
 * portal del paciente, mini-web, sembrado de demo) y se edita desde otros
 * tantos. Una columna que solo escribieran algunos de ellos dejaría
 * pacientes INVISIBLES en el buscador — peor que el bug que arregla — y
 * escribirla desde todos exige tocar rutas que hoy son de otras tareas,
 * más una migración con backfill sobre una base en producción.
 *
 * Así que la normalización va DENTRO de la consulta. Es exactamente el
 * mismo movimiento que ya hace el Inbox para emparejar teléfonos
 * (src/lib/whatsapp/inbox-log.ts:70 — `right(regexp_replace(...), 10)`),
 * incluido su cinturón: si el raw falla, se cae al criterio de siempre y
 * el buscador sigue funcionando como hoy en vez de reventar.
 *
 * ── EL TENANT NO SE MUEVE DE SITIO ─────────────────────────────────────
 * Esta consulta NO decide qué ve nadie: devuelve ids CANDIDATOS y el
 * llamador los mete como un `AND` más dentro del `where` de Prisma, que
 * sigue llevando su `buildPatientWhere` (clinicId + visibilidad +
 * deletedAt). Aun así la propia consulta va acotada por clinicId: si
 * alguien la copiara a otro sitio, seguiría sin cruzar clínicas.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PatientSearchToken } from "./patient-search-core";

/**
 * Espejo EN SQL de normalizePatientText(): minúsculas y sin tildes,
 * diéresis, virgulilla ni cedilla.
 *
 * 🔴 translate() y NO unaccent(): unaccent es una EXTENSIÓN y en esta base
 * no está instalada (ya lo comprobó el triaje). Misma decisión, y por el
 * mismo motivo, que sql/edu-ola-1b.sql — de donde sale este mapa, letra por
 * letra, para que los dos verticales no puedan discrepar.
 */
const SIN_ACENTOS_DE = "ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ";
const SIN_ACENTOS_A = "aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyy";

/** `lower(translate(<expr>))` — el texto de la fila, listo para comparar. */
function normalizado(expr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`translate(lower(coalesce(${expr}, '')), ${SIN_ACENTOS_DE}, ${SIN_ACENTOS_A})`;
}

/**
 * Todo lo que se puede teclear de un paciente, en un solo texto: nombre,
 * apellidos, correo y FOLIO. El folio entra aquí a propósito — el buscador
 * de «Nueva cita» no lo miraba y por eso no se podía agendar tecleando
 * "P0042", que es lo que trae impreso el recibo del paciente.
 */
const TEXTO_BUSCABLE = Prisma.sql`
  "firstName" || ' ' || "lastName" || ' ' ||
  coalesce("email", '') || ' ' || coalesce("patientNumber", '')
`;

/** Solo los dígitos del teléfono guardado: "+52 55 1234 5678" → "525512345678". */
const TELEFONO_DIGITOS = Prisma.sql`regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g')`;

/**
 * Arma el `WHERE` de un término: tiene que casar en ALGÚN campo. Cada
 * término es un AND (los ORs van dentro), así que "Ana Perez" exige las dos
 * cosas y el orden da igual.
 *
 * El teléfono se compara por dos vías, y hacen falta las dos:
 *  · `contains` de los dígitos — cubre lo parcial ("1234 5678") y el caso
 *    de pegar el número sin lada contra uno guardado CON lada;
 *  · igualdad de los últimos 10 — cubre el caso inverso, pegar el número
 *    CON lada ("+52 55…") contra uno guardado sin ella. Es la convención
 *    de emparejamiento por teléfono de toda la casa (bot de WhatsApp,
 *    Inbox, importador).
 */
function condicionDeTermino(tok: PatientSearchToken): Prisma.Sql {
  const partes: Prisma.Sql[] = [
    Prisma.sql`${normalizado(TEXTO_BUSCABLE)} LIKE '%' || ${tok.text} || '%'`,
  ];
  if (tok.digits.length > 0) {
    partes.push(Prisma.sql`${TELEFONO_DIGITOS} LIKE '%' || ${tok.digits} || '%'`);
  }
  if (tok.last10.length === 10) {
    partes.push(Prisma.sql`right(${TELEFONO_DIGITOS}, 10) = ${tok.last10}`);
  }
  return Prisma.sql`(${Prisma.join(partes, " OR ")})`;
}

/** La consulta completa. Separada para poder probarla sin base. */
export function buildPatientSearchSql(args: {
  clinicIds: string[];
  tokens: PatientSearchToken[];
  limit: number;
}): Prisma.Sql {
  const { clinicIds, tokens, limit } = args;
  return Prisma.sql`
    SELECT "id"
      FROM "patients"
     WHERE "clinicId" IN (${Prisma.join(clinicIds)})
       AND "deletedAt" IS NULL
       AND ${Prisma.join(tokens.map(condicionDeTermino), " AND ")}
     LIMIT ${limit}
  `;
}

/**
 * Ids de los pacientes que casan con el término, ya sin acentos y con el
 * teléfono normalizado.
 *
 * Devuelve `null` —y NO un array vacío— cuando la consulta falla. La
 * diferencia importa: vacío significa "no hay nadie con ese nombre" y `null`
 * significa "no pude preguntar", y ante lo segundo el llamador tiene que
 * volver al `contains` de siempre en vez de enseñar una lista vacía o, peor,
 * dejar de aplicar el filtro y enseñar el padrón entero.
 *
 * `limit` acota el trabajo: un término que casa con miles de pacientes no es
 * una búsqueda, es la lista sin filtrar.
 */
export async function findPatientIdsBySearch(args: {
  clinicIds: string[];
  tokens: PatientSearchToken[];
  limit?: number;
}): Promise<string[] | null> {
  const { clinicIds, tokens, limit = 5000 } = args;
  if (clinicIds.length === 0 || tokens.length === 0) return null;
  try {
    const filas = await prisma.$queryRaw<Array<{ id: string }>>(
      buildPatientSearchSql({ clinicIds, tokens, limit }),
    );
    return filas.map((f) => f.id);
  } catch (err) {
    console.error("[patients/search] la búsqueda normalizada falló, uso el contains:", err);
    return null;
  }
}
