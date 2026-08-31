/**
 * DaleControl INSTITUCIONAL — Ola 12 · EL RESUMEN DE LA FICHA, sin base de
 * datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin
 * `new Date()` escondido). Aquí viven las dos decisiones del resumen que
 * una prueba tiene que poder fijar sin Postgres:
 *
 *   1. QUÉ BLOQUES VE CADA ROL — el resumen cruza tres recursos con
 *      alcances distintos (citas, expediente clínico y dinero), y la
 *      pantalla se arma con los tres a la vez. Si cada consulta decidiera
 *      su alcance por su cuenta, el día que una se equivoque el error se
 *      vería igual que "funciona".
 *   2. LOS AVISOS — qué convierte un caso en una alerta. Es lógica de
 *      producto (¿cuándo "falta" un consentimiento?) y se prueba con
 *      datos armados a mano.
 *
 * 🔴 EL CONTRATO DEL RESUMEN, por rol:
 *   · ALUMNO   → sus citas y sus casos con este paciente. NI UN PESO: el
 *     bloque de saldo NO SE CONSULTA (no es que se esconda — no se lee).
 *   · DOCENTE  → lo de sus alumnos vigentes. Tampoco ve dinero.
 *   · CAJA     → citas y saldo completos. NADA clínico: ni casos, ni
 *     avisos (los tres avisos nacen de los casos y contarían lo que caja
 *     no puede ver — "hay un caso de endodoncia sin carta" ya dice la
 *     especialidad).
 *   · DIRECCION→ todo.
 */
import {
  eduVisibility,
  type EduVisibilityActor,
  type EduVisibilityScope,
} from "@/lib/edu/visibility";
import type { EduCaseStatus } from "@/lib/edu/types";
import { EDU_CASE_CLOSED_STATUSES } from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS TRES ALCANCES DEL RESUMEN, DECIDIDOS EN UN SOLO SITIO
// ═══════════════════════════════════════════════════════════════════════

export interface EduResumenScopes {
  /** Cuántas veces vino, la última y la próxima → recurso "appointments". */
  citas: EduVisibilityScope;
  /** Los casos abiertos y los tres avisos → recurso "cases" (el alcance
   *  del EXPEDIENTE, el mismo de la Ola 3: para caja es "none"). */
  clinico: EduVisibilityScope;
  /** Cobrado y pendiente → recurso "charges" (todo o nada, Ola 5). */
  dinero: EduVisibilityScope;
}

/**
 * Punto ÚNICO: resumen.ts no llama a eduVisibility por su cuenta, llama
 * aquí. Así la prueba que fija "caja sin clínico, alumno sin dinero" y el
 * código que consulta usan LA MISMA función.
 */
export function eduResumenScopes(actor: EduVisibilityActor): EduResumenScopes {
  return {
    citas: eduVisibility(actor, "appointments"),
    clinico: eduVisibility(actor, "cases"),
    dinero: eduVisibility(actor, "charges"),
  };
}

/** ¿Se consulta (y se pinta) el bloque de dinero? Solo con alcance
 *  COMPLETO: el saldo de un paciente recortado "a lo mío" sería un número
 *  falso presentado como saldo. */
export function eduResumenVeDinero(scopes: EduResumenScopes): boolean {
  return scopes.dinero.kind === "all";
}

/** ¿Se consultan los casos y los avisos? Caja cae aquí en `false`. */
export function eduResumenVeClinico(scopes: EduResumenScopes): boolean {
  return scopes.clinico.kind !== "none";
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS AVISOS
// ═══════════════════════════════════════════════════════════════════════

/** Lo que el aviso necesita saber de un caso ABIERTO. */
export interface EduResumenCasoInsumo {
  id: string;
  status: EduCaseStatus;
  programName: string;
  /** El responsable designado al abrir el caso (columna del caso). */
  supervisorUserId: string | null;
  /** ¿El alumno tiene titular con asignación VIGENTE hoy? */
  tieneTitularVigente: boolean;
}

/** Lo que el aviso necesita saber de una carta de consentimiento. */
export interface EduResumenConsentInsumo {
  caseId: string | null;
  signedAt: Date | string | null;
  revokedAt: Date | string | null;
}

export type EduResumenAvisoKind = "consentimiento" | "docente" | "autorizacion";

export interface EduResumenAviso {
  kind: EduResumenAvisoKind;
  text: string;
}

/** ¿El caso está vivo? (ni terminado, ni transferido, ni abandonado). */
export function eduResumenCasoAbierto(status: EduCaseStatus): boolean {
  return !(EDU_CASE_CLOSED_STATUSES as string[]).includes(status);
}

/**
 * Los avisos de la ficha, derivados de datos YA leídos.
 *
 * Reglas, y por qué cada una es como es:
 *
 * · CONSENTIMIENTO FALTANTE — solo para casos EN TRATAMIENTO. Un caso
 *   asignado que todavía no empieza no "debe" carta (la carta se firma
 *   cuando se explica el plan); uno en tratamiento sin carta firmada es
 *   exactamente lo que la NOM no permite. Una carta REVOCADA no cuenta
 *   como firmada — pintar como cubierto algo que el paciente retiró es
 *   cómo alguien acaba tratando a quien dijo que no (Ola 3B).
 *
 * · CASO SIN DOCENTE — un caso ABIERTO cuyo responsable designado es null
 *   Y cuyo alumno no tiene titular vigente. Con titular vigente no se
 *   avisa aunque la columna esté vacía: el titular ES quien responde
 *   (Ola 1A), y avisar ahí sería ruido en cada caso abierto desde el
 *   tamizaje.
 *
 * · AUTORIZACIÓN PENDIENTE — se suma sobre los casos visibles y se dice
 *   el total: la bandeja de la Ola 4 es donde se firma; aquí solo se
 *   avisa que hay algo esperando.
 *
 * ⚠️ Esta función recibe SOLO casos que quien mira puede ver (los recortó
 * eduCaseScopeWhere antes de llegar aquí): los avisos nunca cuentan lo que
 * el alcance negó.
 */
export function eduResumenAvisos(
  casos: EduResumenCasoInsumo[],
  consents: EduResumenConsentInsumo[],
  pendientesPorCaso: Record<string, number>,
): EduResumenAviso[] {
  const out: EduResumenAviso[] = [];

  const firmadosPorCaso = new Set<string>();
  for (const c of consents) {
    if (c.caseId && c.signedAt && !c.revokedAt) firmadosPorCaso.add(c.caseId);
  }

  for (const caso of casos) {
    if (caso.status === "IN_TREATMENT" && !firmadosPorCaso.has(caso.id)) {
      out.push({
        kind: "consentimiento",
        text: `El caso de ${caso.programName} está en tratamiento sin carta de consentimiento firmada.`,
      });
    }
    if (
      eduResumenCasoAbierto(caso.status) &&
      !caso.supervisorUserId &&
      !caso.tieneTitularVigente
    ) {
      out.push({
        kind: "docente",
        text: `El caso de ${caso.programName} no tiene docente que responda: ni responsable en el caso ni titular vigente del estudiante.`,
      });
    }
  }

  let pendientes = 0;
  for (const caso of casos) pendientes += pendientesPorCaso[caso.id] ?? 0;
  if (pendientes > 0) {
    out.push({
      kind: "autorizacion",
      text:
        pendientes === 1
          ? "Hay 1 autorización esperando firma en la bandeja."
          : `Hay ${pendientes} autorizaciones esperando firma en la bandeja.`,
    });
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LAS FORMAS QUE VIAJAN A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

export interface EduResumenCasoRow {
  id: string;
  status: EduCaseStatus;
  programName: string;
  studentName: string;
  studentMatricula: string;
  supervisorName: string | null;
  abiertoLabel: string;
}

export interface EduResumenCita {
  /** "lun 31 ago 09:30", ya formateado en la zona del instituto. */
  label: string;
  studentName: string;
  studentMatricula: string;
  chairName: string | null;
  /** La sede del sillón; null cuando el instituto no reparte por sedes. */
  campusName: string | null;
  supervisorName: string | null;
}

export interface EduResumenSaldo {
  cobradoCents: number;
  pendienteCents: number;
  cobros: number;
}

export interface EduPatientResumenData {
  /** Citas COMPLETADAS dentro del alcance de quien mira. */
  visitas: number;
  /** true = lo que se ve está recortado a "lo tuyo" (alumno/docente): la
   *  pantalla lo dice para que nadie lea "2 visitas" como el total. */
  recortado: boolean;
  ultimaVisita: EduResumenCita | null;
  proximaCita: EduResumenCita | null;
  /** null = quien mira NO ve el expediente (caja): el bloque no existe. */
  casos: EduResumenCasoRow[] | null;
  /** null = quien mira NO ve dinero (alumno/docente): NO SE CONSULTÓ. */
  saldo: EduResumenSaldo | null;
  avisos: EduResumenAviso[];
}
