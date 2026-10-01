import type { PermissionKey } from "@/lib/auth/permissions";

/**
 * Quién puede dictar (POST /api/ai/transcribe). Es EL mismo conjunto que ve el
 * micrófono en la interfaz: se muestra donde se escribe algo clínico, y esos
 * sitios se abren con estos permisos —
 *   · medicalRecord.edit      notas SOAP, nota de evolución, consultas
 *   · consents.create         consentimientos
 *   · xrays.upload            notas de placas
 *   · treatments.edit         plan de tratamiento y presupuestos
 *   · specialties.orthodontics  formularios del módulo de Ortodoncia
 * Cualquiera de ellos basta (OR). Un rol de solo lectura no tiene ninguno.
 *
 * Sin `server-only`: lo leen la ruta y las pruebas.
 */
export const PERMISOS_DE_DICTADO: readonly PermissionKey[] = [
  "medicalRecord.edit",
  "consents.create",
  "xrays.upload",
  "treatments.edit",
  "specialties.orthodontics",
];
