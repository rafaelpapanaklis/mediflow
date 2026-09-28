// Ortodoncia — la pestaña «Ortodoncia» de la ficha del paciente: cuándo sale y
// qué enseña (decisión de Rafael, 28-sep-2026). Puro, sin React ni Prisma: lo
// prueban los tests en node.
//
// Tres casos, en sedes dentales:
//  1. La sede NO tiene el módulo → la pestaña no aparece.
//  2. La sede lo tiene y el paciente tiene o TUVO algún caso (abierto, en
//     pausa, en retención, terminado o abandonado) → la pestaña completa, con
//     su historial.
//  3. La sede lo tiene y el paciente NUNCA tuvo caso (vino a limpieza, a
//     revisión…) → la pestaña sale igual, pero solo para abrir un caso: una
//     vista limpia con «Abrir caso de ortodoncia», sin secciones vacías.
//
// «Tuvo caso» es tener un plan de tratamiento, en el estado que sea. Un
// paciente valorado (con diagnóstico de ortodoncia, o en observación) también
// tiene historial que enseñar, aunque todavía no lleve plan: va con el caso 2.

export type VistaPestanaOrto =
  /** Sin el módulo en la sede: no hay pestaña. */
  | "oculta"
  /** Nunca tuvo nada de ortodoncia: solo «Abrir caso de ortodoncia». */
  | "solo-abrir-caso"
  /** Tiene o tuvo caso (o una valoración): la pestaña entera. */
  | "completa";

export interface HistorialOrtoDelPaciente {
  /** La sede tiene el módulo contratado de verdad (`hasActiveOrthodonticsModule`). */
  moduloActivo: boolean;
  /** Tiene algún plan de tratamiento sin borrar, en CUALQUIER estado. */
  tienePlan: boolean;
  /** Tiene algún diagnóstico de ortodoncia sin borrar (incluye «en observación»). */
  tieneDiagnostico: boolean;
}

export function vistaDePestanaOrto(h: HistorialOrtoDelPaciente): VistaPestanaOrto {
  if (!h.moduloActivo) return "oculta";
  if (h.tienePlan || h.tieneDiagnostico) return "completa";
  return "solo-abrir-caso";
}

/** Todos los estados de un caso cuentan como «tuvo caso»: ninguno devuelve al paciente a la vista limpia. */
export const ESTADOS_QUE_CUENTAN_COMO_CASO = [
  "PLANNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RETENTION",
  "COMPLETED",
  "DROPPED_OUT",
] as const;

// ── Sin el módulo, el expediente se sigue leyendo (decisión 3 del gerente) ──
//
// Si la clínica deja de pagar el módulo conserva la LECTURA de los casos que ya
// tiene (NOM-004: el expediente no se oculta), pero no puede crear ni cobrar.
// Ese «no puede» lo hace cumplir el servidor (`getOrthoActionContext` & co.
// rechazan sin módulo activo); esto solo decide qué se ENSEÑA.

export type AccesoOrtoFicha =
  /** Módulo activo: la pestaña de siempre. */
  | "completo"
  /** Módulo vencido pero el paciente tiene o tuvo un caso: se lee, no se escribe. */
  | "solo-lectura"
  /** Sin módulo y sin nada de ortodoncia que conservar: no hay pestaña. */
  | "oculto";

export function accesoDeOrtodonciaEnLaFicha(e: { moduloActivo: boolean; tuvoCaso: boolean }): AccesoOrtoFicha {
  if (e.moduloActivo) return "completo";
  return e.tuvoCaso ? "solo-lectura" : "oculto";
}
