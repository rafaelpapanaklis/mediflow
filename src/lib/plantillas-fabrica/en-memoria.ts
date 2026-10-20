// Un RepoVersiones en memoria, con las mismas reglas que la tabla (una vigente
// por clínica/familia/plantilla; archivar no borra). Solo para pruebas.

import {
  type FamiliaVersion,
  type GuardarVersion,
  type RepoVersiones,
  type VersionClinica,
} from "./versiones";

export function repoVersionesEnMemoria(opciones: { disponible?: boolean } = {}): RepoVersiones & { filas: VersionClinica[] } {
  const filas: VersionClinica[] = [];
  let n = 0;
  const exigir = (clinicId: string) => {
    if (typeof clinicId !== "string" || clinicId.length === 0) throw new Error("clinicId ausente");
  };
  const mover = (reloj = new Date()) => reloj;
  return {
    filas,
    async disponible() {
      return opciones.disponible !== false;
    },
    async activas(clinicId: string, familia: FamiliaVersion) {
      exigir(clinicId);
      return filas.filter((f) => f.clinicId === clinicId && f.familia === familia && f.archivedAt === null);
    },
    async guardar(v: GuardarVersion) {
      exigir(v.clinicId);
      const actual = filas.find(
        (f) => f.clinicId === v.clinicId && f.familia === v.familia && f.clave === v.clave && f.archivedAt === null,
      );
      if (actual) {
        actual.cuerpo = v.cuerpo;
        actual.updatedAt = mover();
        return actual;
      }
      const fila: VersionClinica = {
        id: `v${++n}`,
        clinicId: v.clinicId,
        familia: v.familia,
        clave: v.clave,
        cuerpo: v.cuerpo,
        createdById: v.userId,
        createdAt: mover(),
        updatedAt: mover(),
        archivedAt: null,
      };
      filas.push(fila);
      return fila;
    },
    async archivar(clinicId, familia, clave) {
      exigir(clinicId);
      const actual = filas.find(
        (f) => f.clinicId === clinicId && f.familia === familia && f.clave === clave && f.archivedAt === null,
      );
      if (!actual) return null;
      actual.archivedAt = mover();
      return actual;
    },
    async archivarTexto(v: GuardarVersion) {
      exigir(v.clinicId);
      const fila: VersionClinica = {
        id: `v${++n}`,
        clinicId: v.clinicId,
        familia: v.familia,
        clave: v.clave,
        cuerpo: v.cuerpo,
        createdById: v.userId,
        createdAt: mover(),
        updatedAt: mover(),
        archivedAt: mover(),
      };
      filas.push(fila);
      return fila;
    },
  };
}
