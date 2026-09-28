// Resolución de paciente para CASOS DE ORTODONCIA MIGRADOS (ws1-t1).
//
// Reutiliza loadPatientIndex/resolvePaymentPatient de pagos-historial/paciente.ts
// (ws1-t6, YA COMMITEADO y estable — no es de los archivos que ws1-t12 cambia
// en paralelo, así que importarlo no pisa a nadie). La resolución no tiene
// nada de "pago": es paciente por ID externo, teléfono, correo o nombre, con
// el mismo criterio STRICT (si el teléfono/correo que lo encontró es de OTRA
// persona, es error — no se abre el caso al hermano/mamá que comparte el
// número). Se reexporta con un nombre propio para que el handler no lea
// "pago" donde no lo hay.
//
// Multi-tenant: clinicId SIEMPRE de la sesión (nunca del cliente).

import { loadPatientIndex, resolvePaymentPatient, type PatientIndex } from "../pagos-historial/paciente";

export { loadPatientIndex, type PatientIndex };

export const resolveCasePatient = resolvePaymentPatient;
