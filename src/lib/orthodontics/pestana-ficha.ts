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

/**
 * En solo lectura, ¿esta etiqueta de botón es una acción que ESCRIBE (registrar,
 * cobrar, editar, abrir un caso…)? Es un freno de cliente para no dejar botones
 * vivos que el servidor va a rechazar; el bloqueo de verdad sigue estando en el
 * servidor. Ver, filtrar, cambiar de sección y recargar NO son escritura.
 */
export function esAccionDeEscritura(etiqueta: string): boolean {
  const t = etiqueta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return /\b(registrar|iniciar consulta|agendar|reagendar|reprogramar|cobrar|editar|completar|avanzar|guardar|firmar|nuevo|nueva|abrir|enviar|generar|subir|crear|confirmar|aplicar|agregar|anadir|eliminar|borrar|marcar|recordar|pedir|solicitar|cambiar|reasignar|pausar|reanudar|terminar|finalizar|condonar|imprimir orden)\b/.test(t);
}

// ── Quién ve qué de la pestaña (X2 / MAPA 19) ───────────────────────────────
//
// Dos llaves, además del contrato de la sede (`AccesoOrtoFicha`):
//  · `specialties.orthodontics` — la llave del módulo. Sin ella la pestaña no
//    sale: quitarle «Ortodoncia» a una doctora en Equipo → Permisos le quita el
//    menú Y la pestaña de la ficha.
//  · `medicalRecord.view` — la misma que exigen las lecturas clínicas del
//    módulo (`getOrthoActionContext({ write: false })`). Sin ella (recepción,
//    solo lectura) la pestaña sale en su cara ADMINISTRATIVA: citas y cobro,
//    sin diagnóstico, plan clínico, hojas, fotos ni cefalometría — y esos datos
//    ni se cargan en el servidor.
// El contrato manda primero: sin módulo y sin caso que conservar no hay pestaña
// para nadie; sin módulo CON caso se conserva la lectura (decisión 3, NOM-004)
// para quien tenga las dos llaves.

export type VistaOrtoPorPermisos =
  /** No hay pestaña: la sede no la tiene o la persona no tiene la llave del módulo. */
  | "oculta"
  /** Pestaña con solo lo administrativo (citas, cobro) y el aviso «Lo clínico del caso lo ven doctores». */
  | "administrativa"
  /** La pestaña de siempre, con lo clínico. */
  | "clinica";

export function vistaOrtoPorPermisos(e: {
  acceso: AccesoOrtoFicha;
  /** `hasPermission(usuario, "specialties.orthodontics")`, con overrides. */
  llaveModulo: boolean;
  /** `hasPermission(usuario, "medicalRecord.view")`, con overrides. */
  verExpediente: boolean;
}): VistaOrtoPorPermisos {
  if (e.acceso === "oculto" || !e.llaveModulo) return "oculta";
  return e.verExpediente ? "clinica" : "administrativa";
}
