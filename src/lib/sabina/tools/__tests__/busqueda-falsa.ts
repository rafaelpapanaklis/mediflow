/**
 * La búsqueda SIN ACENTOS de pacientes, evaluada en memoria.
 *
 * El doble de base no habla SQL (su `$queryRaw` lanza a propósito). Pero el
 * aviso de duplicados del alta depende de la consulta normalizada —«Perez»
 * tiene que encontrar a «Pérez»—, así que para probarlo hace falta algo que
 * conteste como ella. Este archivo es ese algo, y NO decide qué es un
 * duplicado: eso lo siguen decidiendo `isProbablePatientDuplicate` y
 * `splitPatientDuplicates`, que corren de verdad.
 *
 * Replica, término por término, `condicionDeTermino` de
 * @/lib/patients/patient-search: el texto normalizado de nombre + apellidos +
 * correo + folio CONTIENE el término, o los dígitos del teléfono contienen sus
 * dígitos, o coinciden los últimos 10. Todos los términos a la vez (AND),
 * acotado por clínica y sin los borrados por ARCO.
 */

import {
  normalizePatientText,
  patientDigitsOnly,
  type PatientSearchToken,
} from "@/lib/patients/patient-search-core";
import type { Fila } from "./doble-base";

export interface ArgsBusqueda {
  clinicIds: string[];
  tokens: PatientSearchToken[];
  limit: number;
}

/** Lo que devuelve el `buildPatientSearchSql` sustituido: los argumentos, sin SQL. */
export interface ConsultaFalsa {
  __busqueda: ArgsBusqueda;
}

export function idsQueCasan(pacientes: Fila[], args: ArgsBusqueda): string[] {
  const out: string[] = [];
  for (const p of pacientes) {
    if (args.clinicIds.indexOf(p.clinicId) === -1) continue;
    if (p.deletedAt !== null && p.deletedAt !== undefined) continue;
    const texto = normalizePatientText(
      `${p.firstName ?? ""} ${p.lastName ?? ""} ${p.email ?? ""} ${p.patientNumber ?? ""}`,
    );
    const tel = patientDigitsOnly(p.phone ?? "");
    const casa = args.tokens.every(
      (t) =>
        texto.indexOf(t.text) !== -1 ||
        (t.digits.length > 0 && tel.indexOf(t.digits) !== -1) ||
        (t.last10.length === 10 && tel.slice(-10) === t.last10),
    );
    if (casa) out.push(p.id);
    if (out.length >= args.limit) break;
  }
  return out;
}

/**
 * Le pone al doble un `$queryRaw` que entiende la consulta falsa. Con
 * `falla: true` lanza, como cuando la consulta normalizada no se puede hacer.
 */
export function conBusqueda<T extends { $queryRaw: (q: any) => Promise<any[]> }>(
  db: T,
  pacientes: Fila[],
  opciones: { falla?: boolean } = {},
): T {
  db.$queryRaw = async (q: any) => {
    if (opciones.falla) throw new Error("búsqueda normalizada caída (simulada)");
    const args = (q as ConsultaFalsa)?.__busqueda;
    if (!args) throw new Error("consulta cruda inesperada en la prueba");
    return idsQueCasan(pacientes, args).map((id) => ({ id }));
  };
  return db;
}
