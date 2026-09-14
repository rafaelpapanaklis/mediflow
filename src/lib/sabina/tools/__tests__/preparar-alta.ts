/**
 * Lo de `./preparar` y una sustitución más, para las pruebas del alta.
 *
 * `buildPatientSearchSql` arma SQL de Postgres que el doble no ejecuta. Se
 * sustituye por uno que devuelve SOLO sus argumentos, y `conBusqueda`
 * (./busqueda-falsa) los evalúa en memoria. Todo lo demás del alta —el
 * validador del cuerpo, el reparto de duplicados, `buildPatientWhere`,
 * `canSeePatient`, los permisos— corre de verdad.
 *
 * Se importa PRIMERO, igual que `./preparar`.
 */

import "./preparar";
import { mock } from "node:test";

mock.module("@/lib/patients/patient-search", {
  namedExports: {
    buildPatientSearchSql: (args: unknown) => ({ __busqueda: args }),
    findPatientIdsBySearch: async () => {
      throw new Error("el alta de Sabina no debe usar findPatientIdsBySearch (va contra el prisma real)");
    },
  },
});

export {};
