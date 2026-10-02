// Puente entre los DOS importadores que tocan los controles de ortodoncia de Dentalink (ws1-t10, 29-sep-2026):
//   · 06_Presupuestos (ws1-t12) crea el CASO y, por cada renglón de control HECHO, una hoja de control (OrthoTreatmentCard);
//   · 05_Citas (ws1-t10) trae las mismas visitas como CITAS (atendida, no asistió…).
// Los dos ven el mismo control: el de un caso en un día. Para no contarlo dos veces, quien llega primero deja su marca en
// `import_external_ids` y quien llega después la encuentra y se ADJUNTA en vez de crear otro. Da igual el orden.
//
//   entity 'ortho_case'    externalId = «# Tratamiento»            localId = OrthodonticTreatmentPlan.id   (lo escribe 06)
//   entity 'ortho_control' externalId = «# Tratamiento|AAAA-MM-DD» localId = id de la hoja (06) o de la cita (05)
//
// Aislamiento: TODA consulta lleva clinicId (viene de la sesión). Tolera que la tabla no exista (SQL pendiente).

import { prisma } from "@/lib/prisma";
import { faltaLaTabla, limpiarId, type ExternosCargados } from "../externos";
import { newId } from "../migrado";
import { textoLocal } from "../valores";

export { limpiarId };

export const ENTIDAD_CASO_ORTO = "ortho_case";
export const ENTIDAD_CONTROL_ORTO = "ortho_control";

/** Tope por sentencia: el JSON de un lote de 200 filas cabe de sobra. */
const LOTE = 500;

/**
 * La clave de «este control de este caso en este día»: «# Tratamiento|AAAA-MM-DD». Es LA MISMA función para 05 y 06.
 * El día es de calendario (sin hora): el de la «Fecha Realización» tal cual viene en 06, y el de la cita en la zona de
 * la clínica (`diaLocal`) en 05. Devuelve null si falta el tratamiento o el día no tiene forma de fecha.
 */
export function claveControlCaso(numTratamiento: unknown, dia: unknown): string | null {
  const t = limpiarId(numTratamiento);
  const d = typeof dia === "string" ? dia.trim() : "";
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return `${t}|${d}`;
}

/** El día de calendario «AAAA-MM-DD» de un instante, en la zona de la clínica. */
export function diaLocal(d: Date, timezone: string | null | undefined): string {
  const [fecha] = textoLocal(d, timezone).split(" ");
  const [dd, mm, yyyy] = fecha.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

/** Los pares (externalId → localId) de UNA entidad de import_external_ids, de esta clínica y este sistema de origen. */
export async function cargarExternosDe(clinicId: string, source: string, entity: string): Promise<ExternosCargados> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("cargarExternosDe: falta clinicId");
  if (!source) return { mapa: new Map(), disponible: true }; // sin sistema de origen no hay IDs externos que valgan
  try {
    const rows = await prisma.$queryRaw<{ externalId: string; localId: string }[]>`
      SELECT "externalId", "localId"
      FROM "import_external_ids"
      WHERE "clinicId" = ${clinicId} AND "source" = ${source} AND "entity" = ${entity}`;
    return { mapa: new Map(rows.map((r) => [r.externalId, r.localId])), disponible: true };
  } catch (e) {
    if (faltaLaTabla(e)) return { mapa: new Map(), disponible: false };
    throw e;
  }
}

/**
 * Guarda pares externalId → localId (ON CONFLICT DO NOTHING: el que ya estaba se respeta). Devuelve false si la tabla
 * no existe; nunca lanza por eso: los datos ya se importaron, solo falta el recuerdo.
 */
export async function guardarExternosDe(
  clinicId: string,
  source: string,
  entity: string,
  pares: Array<{ externalId: string; localId: string }>,
): Promise<boolean> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("guardarExternosDe: falta clinicId");
  if (!source || pares.length === 0) return true;
  try {
    for (let i = 0; i < pares.length; i += LOTE) {
      const json = JSON.stringify(pares.slice(i, i + LOTE).map((p) => ({ id: newId("import_external_ids"), ext: p.externalId, loc: p.localId })));
      await prisma.$executeRaw`
        INSERT INTO "import_external_ids" ("id", "clinicId", "source", "entity", "externalId", "localId")
        SELECT x.id, ${clinicId}, ${source}, ${entity}, x.ext, x.loc
        FROM jsonb_to_recordset(${json}::jsonb) AS x(id text, ext text, loc text)
        ON CONFLICT ("clinicId", "source", "entity", "externalId") DO NOTHING`;
    }
    return true;
  } catch (e) {
    if (faltaLaTabla(e)) return false;
    throw e;
  }
}

/** Casos de ortodoncia ya importados de 06: «# Tratamiento» → id del plan (OrthodonticTreatmentPlan). */
export const cargarCasosOrto = (clinicId: string, source: string) => cargarExternosDe(clinicId, source, ENTIDAD_CASO_ORTO);

/** Controles ya registrados (hoja o cita): «# Tratamiento|día» → id de la hoja o de la cita. */
export const cargarControlesOrto = (clinicId: string, source: string) => cargarExternosDe(clinicId, source, ENTIDAD_CONTROL_ORTO);

/** Recuerda controles recién creados. Los pares con `localId` de una CITA los escribe 05; los de una HOJA, 06. */
export const guardarControlesOrto = (
  clinicId: string,
  source: string,
  pares: Array<{ externalId: string; localId: string }>,
) => guardarExternosDe(clinicId, source, ENTIDAD_CONTROL_ORTO, pares);
