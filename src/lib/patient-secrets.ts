/**
 * Campos de `Patient` que son CREDENCIALES y jamás deben salir del servidor.
 *
 * Espejo exacto de `@/lib/clinic-secrets` (mismo patrón, misma forma de uso),
 * pero para el paciente. Existe porque varias rutas devuelven la fila completa
 * (`findFirst`/`update` sin `select`, o `include: { patient: true }`) y varias
 * páginas la pasan entera a un componente cliente: cada campo sensible nuevo se
 * filtraba al navegador por default.
 *
 * `portalToken` es el bearer de `/portal/[token]` y `/api/portal/[token]`: con
 * él se abre el expediente del paciente SIN sesión, y no caduca hasta
 * `portalTokenExpiry`. Un link permanente que sobrevive a que le revoquen la
 * cuenta de staff a quien lo copió. El contrato del portal ya lo decía
 * (`@/lib/patient-portal/types.ts`: "Patient: NUNCA … portalToken"); lo que
 * faltaba era el punto único donde quitarlo (P1-N1, auditoría 2026-08-06).
 *
 * NO incluye `curp`, `rfcPaciente` ni `notes`: son datos que la propia ficha
 * muestra y edita. Son PII, no credenciales — su control es el de visibilidad
 * por paciente (`@/lib/patient-visibility`), no este helper.
 */
const PATIENT_SECRET_FIELDS = [
  "portalToken",       // bearer del portal de solo lectura → expediente sin sesión
  "portalTokenExpiry", // sin el token no sirve, pero es metadato del mismo secreto
] as const;

/**
 * Devuelve una copia del paciente sin credenciales. Acepta null/undefined para
 * poder envolver un `findFirst` directo, y arrays para envolver un `findMany`
 * (la lista de pacientes serializa 50 filas completas por página).
 *
 * Usarlo SIEMPRE en el borde: justo en el `NextResponse.json(...)` o en el prop
 * que cruza al cliente. Si se usa antes, un `...spread` posterior lo deshace.
 */
export function stripPatientSecrets<T>(patient: T): T {
  if (Array.isArray(patient)) {
    return patient.map((p) => stripPatientSecrets(p)) as unknown as T;
  }
  if (!patient || typeof patient !== "object") return patient;
  const copy: Record<string, any> = { ...(patient as Record<string, any>) };
  for (const field of PATIENT_SECRET_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * Igual, pero para una entidad que TRAE un paciente colgando
 * (`include: { patient: true }` en facturas, citas, notas…). Sólo toca la
 * relación `patient`; el resto del objeto queda intacto.
 */
export function stripNestedPatientSecrets<T>(entity: T): T {
  if (Array.isArray(entity)) {
    return entity.map((e) => stripNestedPatientSecrets(e)) as unknown as T;
  }
  if (!entity || typeof entity !== "object") return entity;
  const row = entity as Record<string, any>;
  if (!row.patient || typeof row.patient !== "object") return entity;
  return { ...row, patient: stripPatientSecrets(row.patient) } as T;
}

/** Sólo para tests y para el barrido: la lista canónica de campos a quitar. */
export const PATIENT_SECRET_FIELD_NAMES: readonly string[] = PATIENT_SECRET_FIELDS;
