// La biblioteca de hojas VISTA POR LA CLÍNICA (ws1-t6): el repositorio de siempre
// con la versión de la clínica puesta encima de cada hoja de fábrica que editó.
//
// La fila de fábrica (`patient_handout_templates`) no cambia nunca: la versión
// vive en `clinic_template_versions` y aquí solo se le sustituye el TEXTO al
// leer. Id, nombre, liga a procedimientos y «en uso» siguen siendo los de la fila.
// PURO: recibe los dos repositorios, así lo prueban los tests con los de memoria.

import type { RepoVersiones, VersionClinica } from "@/lib/plantillas-fabrica/versiones";
import type { FilaHoja, RepoHojas } from "./servicio";
import type { TipoHoja } from "./fabrica";

export function familiaDeHoja(tipo: TipoHoja): "HOJA_INDICACIONES" | "HOJA_CONSTANCIA" {
  return tipo === "CONSTANCIA" ? "HOJA_CONSTANCIA" : "HOJA_INDICACIONES";
}

async function vigentes(vr: RepoVersiones, clinicId: string): Promise<Map<string, VersionClinica>> {
  const m = new Map<string, VersionClinica>();
  if (!(await vr.disponible())) return m;
  for (const familia of ["HOJA_INDICACIONES", "HOJA_CONSTANCIA"] as const) {
    for (const v of await vr.activas(clinicId, familia)) m.set(`${familia}:${v.clave}`, v);
  }
  return m;
}

function poner(f: FilaHoja, m: ReadonlyMap<string, VersionClinica>): FilaHoja {
  if (!f.factoryKey) return f;
  const v = m.get(`${familiaDeHoja(f.tipo)}:${f.factoryKey}`);
  if (!v) return f;
  return { ...f, cuerpo: v.cuerpo, updatedAt: v.updatedAt, versionDeClinica: true };
}

export function conVersiones(base: RepoHojas, versiones: RepoVersiones): RepoHojas {
  return {
    ...base,
    async listar(clinicId, tipo) {
      const filas = await base.listar(clinicId, tipo);
      if (!filas.some((f) => f.factoryKey)) return filas;
      const m = await vigentes(versiones, clinicId);
      return filas.map((f) => poner(f, m));
    },
    async obtener(clinicId, id) {
      const f = await base.obtener(clinicId, id);
      if (!f || !f.factoryKey) return f;
      return poner(f, await vigentes(versiones, clinicId));
    },
    async actualizar(clinicId, id, c) {
      const r = await base.actualizar(clinicId, id, c);
      if (!r || r === "NOMBRE_OCUPADO" || !r.factoryKey) return r;
      return poner(r, await vigentes(versiones, clinicId));
    },
  };
}
