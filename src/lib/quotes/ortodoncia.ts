// Presupuestos de ortodoncia → caso de ortodoncia (ws1-t5, 28-sep-2026;
// revisión de lógica de uso, fila 14 del mapa). PURO: sin Prisma ni React.
//
// EL FALLO. Aceptar un presupuesto de brackets y pulsar «Crear plan de
// tratamiento» creaba un plan GENERAL (el de la pestaña «Plan»), no un caso
// de ortodoncia. El módulo no se enteraba: ni Tablero, ni mensualidades, ni
// controles. Y el plan general quedaba ahí, contando sesiones que no existen.
//
// EL ARREGLO. En una sede con el módulo, un presupuesto aceptado que es de
// ortodoncia ofrece «Abrir caso de ortodoncia»: lleva a la ficha del paciente,
// en su pestaña Ortodoncia, con el alta del caso abierta (el mismo asistente
// de siempre; quién puede abrir un caso lo sigue decidiendo la ficha). Si el
// paciente ya tiene un caso en curso, ofrece verlo. El presupuesto viaja en la
// dirección (`presupuesto=<id>`) para que el alta sepa de dónde viene.

const PALABRAS_DE_ORTODONCIA = [
  "ortodoncia", "ortodontico", "ortodontica", "brackets", "bracket", "braquets",
  "alineador", "alineadores", "invisalign",
];

// Lo que se cotiza SUELTO alrededor de un tratamiento y no es el tratamiento:
// una valoración, un control, reponer un bracket, un retenedor… Un presupuesto
// que solo trae esto NO abre un caso (sigue con su botón de siempre). Son las
// palabras del catálogo de procedimientos de ortodoncia «con costo aparte»
// (src/lib/orthodontics/catalog-procedures.ts).
const PALABRAS_DE_EXTRA = [
  "valoracion", "control", "controles", "reposicion", "urgencia", "registros", "estudio",
  "retiro", "retenedor", "retenedores", "refinamiento", "microimplante", "consulta",
  "activacion", "ajuste",
];

/** Sin acentos, en minúsculas. */
function comparable(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function palabrasDe(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return comparable(texto).split(/[^a-z0-9]+/).filter(Boolean);
}

function hablaDeOrtodoncia(texto: string | null | undefined): boolean {
  return palabrasDe(texto).some((p) => PALABRAS_DE_ORTODONCIA.includes(p));
}

function esUnExtra(texto: string | null | undefined): boolean {
  return palabrasDe(texto).some((p) => PALABRAS_DE_EXTRA.includes(p));
}

/** ¿El texto nombra el TRATAMIENTO de ortodoncia (y no un extra suelto)? */
function nombraElTratamiento(texto: string | null | undefined): boolean {
  return hablaDeOrtodoncia(texto) && !esUnExtra(texto);
}

/**
 * ¿Este presupuesto es el de un TRATAMIENTO de ortodoncia? Sí, si alguno de
 * sus conceptos lo nombra («Ortodoncia con brackets metálicos»,
 * «Alineadores»…). El título solo decide cuando ningún concepto habla de
 * ortodoncia («Ortodoncia completa» con conceptos «Fase 1», «Fase 2»).
 *
 * No lo es el presupuesto que solo trae extras sueltos (una valoración, un
 * retenedor, reponer un bracket): ese no abre un caso.
 *
 * No se decide por la categoría del catálogo: el tratamiento vive en el
 * catálogo dental de la clínica, y lo que hay en la categoría de ortodoncia
 * son justo los extras.
 */
export function esPresupuestoDeOrtodoncia(p: {
  title: string | null | undefined;
  items: ReadonlyArray<{ name: string | null | undefined }>;
}): boolean {
  if (p.items.some((i) => nombraElTratamiento(i.name))) return true;
  if (p.items.some((i) => hablaDeOrtodoncia(i.name))) return false;
  return nombraElTratamiento(p.title);
}

/**
 * Los conceptos de un presupuesto que NO son de ortodoncia (ni el tratamiento
 * ni un extra de ortodoncia): «Resina 16», «Extracción 18»… En un presupuesto
 * mixto, el caso de ortodoncia no los cubre: van a un plan general aparte.
 */
export function conceptosGenerales<T extends { name: string | null | undefined }>(items: ReadonlyArray<T>): T[] {
  return items.filter((i) => !hablaDeOrtodoncia(i.name));
}

export const PARAMETRO_PRESUPUESTO = "presupuesto";

const ESTADOS_EN_CURSO = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"];

export interface CasoDesdePresupuesto {
  accion: "abrir-caso" | "ver-caso" | "sin-permiso";
  /** Lo que dice el botón. */
  etiqueta: string;
  /** A dónde lleva. `null` = esta persona no puede entrar al módulo. */
  href: string | null;
  /** Lo que se le dice a quien no puede abrir el caso. */
  aviso?: string;
  /**
   * Presupuesto MIXTO: además del tratamiento trae conceptos que no son de
   * ortodoncia. Para esos se ofrece también «Crear plan general con el resto»
   * (POST …/treatment-plan?general=1), que arma el plan solo con ellos.
   */
  conPlanGeneral?: boolean;
}

export const AVISO_SIN_PERMISO_DE_ORTODONCIA =
  "Este presupuesto es de ortodoncia: en vez de un plan general se abre un caso de ortodoncia. " +
  "Lo abre quien tiene acceso al módulo de Ortodoncia (el doctor o el administrador).";

/**
 * Qué ofrece un presupuesto en vez de «Crear plan de tratamiento». `null` =
 * nada especial: el botón de siempre.
 *
 * Solo aplica si: la sede tiene el módulo, el presupuesto está ACEPTADO, es
 * de ortodoncia y todavía no generó un plan general (si ya lo generó antes de
 * este cambio, se sigue pudiendo abrir).
 *
 * Quien NO tiene el permiso del módulo (recepción, por defecto) tampoco crea
 * el plan general: se le dice quién abre el caso. Si no, el fallo seguiría
 * vivo para media clínica.
 */
export function casoDesdePresupuesto(p: {
  quoteId: string;
  patientId: string;
  status: string;
  treatmentPlanId: string | null;
  esDeOrtodoncia: boolean;
  /** La sede (dental) tiene el módulo contratado de verdad. */
  moduloActivo: boolean;
  /** La persona tiene el permiso del módulo (`specialties.orthodontics`). */
  tienePermiso: boolean;
  /** `status` de los casos de ortodoncia del paciente (sin los borrados). */
  casosDelPaciente: readonly string[];
}): CasoDesdePresupuesto | null {
  if (!p.moduloActivo || !p.esDeOrtodoncia) return null;
  if (p.status !== "ACCEPTED" || p.treatmentPlanId) return null;
  if (!p.patientId) return null;
  if (!p.tienePermiso) {
    return {
      accion: "sin-permiso",
      etiqueta: "Abrir caso de ortodoncia",
      href: null,
      aviso: AVISO_SIN_PERMISO_DE_ORTODONCIA,
    };
  }

  const ficha = `/dashboard/patients/${encodeURIComponent(p.patientId)}?tab=ortodoncia`;
  if (p.casosDelPaciente.some((s) => ESTADOS_EN_CURSO.includes(s))) {
    return { accion: "ver-caso", etiqueta: "Ver su caso de ortodoncia", href: ficha };
  }
  return {
    accion: "abrir-caso",
    etiqueta: "Abrir caso de ortodoncia",
    href: `${ficha}&abrirCaso=1&${PARAMETRO_PRESUPUESTO}=${encodeURIComponent(p.quoteId)}`,
  };
}
