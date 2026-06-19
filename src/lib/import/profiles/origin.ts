// ═══════════════════════════════════════════════════════════════════════════
// Importar mi clínica — TIPOS LOCALES de perfiles de origen (WS2-T2).
//
// T1 es dueño del engine y de `src/lib/import/types.ts`. Para NO bloquearnos en
// T1, definimos aquí los tipos mínimos que necesita esta capa de perfiles. Si
// más adelante `@/lib/import/types` expone un contrato equivalente, estos tipos
// se re-exportan desde ahí y este archivo queda como alias. (A propósito NO se
// llama `types.ts`: ese nombre pertenece a T1.)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Campos canónicos de DaleControl a los que mapea una columna del origen.
 * Alineados con el importador real de pacientes
 * (`src/app/api/patients/import/route.ts` → HEADER_VARIANTS):
 *   firstName, lastName, email, phone, dob, gender, address, bloodType, notes
 * Extendidos con campos que aparecen en el contrato/diseño (hoja Saldos y
 * DC_FIELDS del prototipo): fullName, rfc, balance.
 *
 * `fullName` es para sistemas que exportan el nombre en UNA sola columna; el
 * engine (T1) decide cómo partirlo. Lo dejamos explícito en vez de forzar
 * firstName para no perder el apellido en silencio.
 */
export type DcField =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "dob"
  | "gender"
  | "address"
  | "rfc"
  | "bloodType"
  | "notes"
  | "balance";

/** Paso de instrucción "cómo exportar" (h = título, p = detalle, admite <code>). */
export interface OriginInstruction {
  h: string;
  p: string;
}

/**
 * Perfil interno completo de un origen. Vive solo en el server; el endpoint
 * lo proyecta a `Origin` (forma del contrato) antes de exponerlo.
 */
export interface OriginProfile {
  /** id estable del contrato (dentalink, opendental, excel, otro, …). */
  id: string;
  name: string;
  /** true = tenemos mapeo automático best-effort; false = mapeo manual (excel/otro). */
  hasProfile: boolean;
  /**
   * HONESTIDAD: true SOLO si el mapeo se validó contra un export REAL del
   * sistema. Hoy no tenemos muestras reales de ningún sistema → todos en
   * `false` (mapeos plausibles por convención). El wizard puede mostrar
   * "perfil estimado" vs "verificado" con esta bandera.
   */
  verified: boolean;
  /** Instrucciones "cómo exportar" para el Paso 2 del wizard. */
  instructions: OriginInstruction[];
  /** columna conocida del origen → campo canónico de DaleControl. */
  mapping: Record<string, DcField>;
}

/**
 * Forma pública que devuelve GET /api/import/origins (contrato WS2).
 * Superset del contrato: incluye `verified` (extra, ignorable por T1/T3).
 */
export interface Origin {
  id: string;
  name: string;
  hasProfile: boolean;
  verified: boolean;
  instructions?: OriginInstruction[];
  mapping?: Record<string, DcField>;
}
