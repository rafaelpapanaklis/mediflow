/**
 * DaleControl INSTITUCIONAL — la PANTALLA DE CASOS, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"). Aquí viven las
 * tres decisiones del listado global de casos que una prueba tiene que
 * poder fijar sin Postgres:
 *
 *   1. QUÉ ESTÁ ESPERANDO UN CASO — la columna que convierte la lista en
 *      una herramienta: "firma pendiente", "plan firmado: puede iniciar",
 *      "nada". Se deriva de los estados GUARDADOS de sus autorizaciones,
 *      nunca se captura (una columna "esperando" en la base mentiría al
 *      minuto siguiente).
 *   2. LOS FILTROS DE LA URL — viajan en la query string y no en un
 *      useState, como en la agenda: así se comparten ("mira los casos de
 *      endodoncia atorados"), sobreviven a un refresh y el filtrado ocurre
 *      en la BASE.
 *   3. EL CSV — con los MISMOS renglones que la pantalla, nunca una
 *      consulta "para exportar".
 *
 * 🔴 Aquí NO se lee ningún institutionId ni se decide ningún alcance: el
 * tenant sale de getEduContext() y el recorte de eduCaseScopeWhere
 * (visibility.ts), los dos en src/lib/edu/casos.ts. Este módulo solo
 * transforma datos que YA pasaron por ahí.
 */
import {
  EDU_APPROVAL_STAGE_LABELS,
  EDU_CASE_CLOSED_STATUSES,
  EDU_CASE_STATUS_LABELS,
  type EduApprovalStage,
  type EduApprovalStatus,
  type EduCaseStatus,
} from "@/lib/edu/types";
import { parseEduCaseStatus } from "@/lib/edu/agenda-core";
import { eduCsvFile, eduCsvRow } from "@/lib/edu/evaluacion-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · QUÉ ESTÁ ESPERANDO EL CASO
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo que hay que saber de una autorización para derivar la espera. */
export interface EduCasoApprovalInsumo {
  stage: EduApprovalStage;
  /**
   * El estado GUARDADO en la columna. Una APPROVED cuyo contenido se editó
   * después puede seguir diciendo APPROVED hasta que alguien abra el
   * detalle (ahí se recalcula el hash y se persiste EXPIRED) — para una
   * LISTA eso es aceptable: el gate real vuelve a comprobar el hash al
   * escribir, así que esta columna informa, no autoriza.
   */
  status: EduApprovalStatus;
}

export type EduCasoEsperaKind =
  /** Hay una autorización PENDING: la pelota está en el docente. */
  | "firma"
  /** La puerta ya está firmada: la pelota está en quien mueve el caso. */
  | "listo"
  /** No se ha mandado nada a autorizar y el caso no puede avanzar sin eso. */
  | "falta"
  /** Nada pendiente. */
  | "nada"
  /** El caso está cerrado: no espera nada. */
  | "cerrado";

export interface EduCasoEspera {
  kind: EduCasoEsperaKind;
  label: string;
}

/** El orden en que se nombra la primera firma pendiente: el del flujo del
 *  caso, no el alfabético. */
const ESPERA_STAGE_ORDER: EduApprovalStage[] = [
  "PLAN",
  "PROCEDURE",
  "SESSION",
  "DISCHARGE",
  "PRESCRIPTION",
];

export function eduCasoAbierto(status: EduCaseStatus): boolean {
  return !(EDU_CASE_CLOSED_STATUSES as string[]).includes(status);
}

/**
 * Qué está esperando un caso, derivado de su estado y de sus
 * autorizaciones tal como están guardadas.
 *
 * Las reglas, en orden de prioridad:
 *
 * · CERRADO → no espera nada ("—" en la tabla).
 * · CON PENDING → "Firma pendiente: <etapa>" (+N si hay varias). Es la
 *   fila que un docente busca en esta pantalla.
 * · EN TRATAMIENTO → si el ALTA ya está firmada, "puede cerrarse"; si no,
 *   nada pendiente (un caso en tratamiento sin alta firmada no "debe"
 *   nada: está trabajándose).
 * · ASIGNADO / EN VALORACIÓN → si el PLAN ya está firmado, "puede pasar a
 *   tratamiento"; si no, "falta mandar el plan" — que es la fila que
 *   dirección busca cuando un caso lleva un mes sin moverse.
 * · EN PAUSA → en pausa; la espera es del paciente, no del gate.
 */
export function eduCasoEsperando(
  status: EduCaseStatus,
  approvals: EduCasoApprovalInsumo[],
): EduCasoEspera {
  if (!eduCasoAbierto(status)) return { kind: "cerrado", label: "—" };

  const pendientes = ESPERA_STAGE_ORDER.filter((s) =>
    approvals.some((a) => a.stage === s && a.status === "PENDING"),
  );
  if (pendientes.length > 0) {
    const extra = pendientes.length > 1 ? ` (+${pendientes.length - 1})` : "";
    return {
      kind: "firma",
      label: `Firma pendiente: ${EDU_APPROVAL_STAGE_LABELS[pendientes[0]].toLowerCase()}${extra}`,
    };
  }

  const firmada = (stage: EduApprovalStage) =>
    approvals.some((a) => a.stage === stage && a.status === "APPROVED");

  if (status === "IN_TREATMENT") {
    return firmada("DISCHARGE")
      ? { kind: "listo", label: "Alta firmada: se puede cerrar" }
      : { kind: "nada", label: "En tratamiento, nada pendiente" };
  }
  if (status === "ON_HOLD") {
    return { kind: "nada", label: "En pausa" };
  }
  // SCREENING y ASSIGNED: la puerta que les toca es el PLAN.
  return firmada("PLAN")
    ? { kind: "listo", label: "Plan firmado: puede pasar a tratamiento" }
    : { kind: "falta", label: "Falta mandar el plan a autorización" };
}

/** El tono del tag con el que la tabla pinta la espera. */
export const EDU_CASO_ESPERA_TAG: Record<EduCasoEsperaKind, string> = {
  firma: "edu-tag--warn",
  listo: "edu-tag--info",
  falta: "edu-tag--danger",
  nada: "edu-tag--ok",
  cerrado: "edu-tag--muted",
};

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS FILTROS DE LA URL
// ═══════════════════════════════════════════════════════════════════════

export interface EduCasosPanelFilters {
  status: EduCaseStatus | null;
  programId: string | null;
  studentId: string | null;
  /** El docente RESPONSABLE del caso (la columna, no el titular vigente:
   *  la lista contesta "quién respondía por este caso", no "quién
   *  supervisa hoy al alumno"). */
  supervisorUserId: string | null;
  /** true = también los cerrados. El default son solo los vivos: es la
   *  lista de trabajo del día, no el archivo histórico. */
  incluirCerrados: boolean;
  /** Apertura desde/hasta, días de CALENDARIO del instituto (AAAA-MM-DD).
   *  `hasta` es inclusivo — la consulta lo convierte en un < exclusivo
   *  sobre la medianoche siguiente. */
  desdeISO: string | null;
  hastaISO: string | null;
  /** Búsqueda por paciente (nombre/folio/teléfono) o matrícula. */
  q: string | null;
}

export const EDU_CASOS_PANEL_EMPTY_FILTERS: EduCasosPanelFilters = {
  status: null,
  programId: null,
  studentId: null,
  supervisorUserId: null,
  incluirCerrados: false,
  desdeISO: null,
  hastaISO: null,
  q: null,
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

function cleanId(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDay(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const v = raw.trim();
  return DAY_RE.test(v) ? v : null;
}

function cleanQ(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (typeof raw !== "string") return null;
  const v = raw.trim().slice(0, 60);
  return v.length > 0 ? v : null;
}

/**
 * Lee los filtros de la query string. Todo lo que no reconoce se descarta.
 *
 * 🔴 Aquí NO se lee ningún institutionId ni ningún alcance: el tenant sale
 * de la sesión. Si esta función aceptara `?institutionId=`, bastaría con
 * teclearlo para listar los casos de otra escuela.
 */
export function parseEduCasosPanelFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduCasosPanelFilters {
  const sp = searchParams ?? {};
  const desde = cleanDay(sp.desde);
  const hasta = cleanDay(sp.hasta);
  return {
    status: parseEduCaseStatus(firstParam(sp.estado)),
    programId: cleanId(sp.especialidad),
    studentId: cleanId(sp.alumno),
    supervisorUserId: cleanId(sp.docente),
    incluirCerrados: firstParam(sp.cerrados) === "1",
    // Un rango al revés no revienta: se ignora el lado que sobra.
    desdeISO: desde && hasta && desde > hasta ? null : desde,
    hastaISO: desde && hasta && desde > hasta ? null : hasta,
    q: cleanQ(sp.q),
  };
}

/** La query string equivalente, para el enlace de exportar y para que la
 *  pantalla escriba la URL al cambiar un filtro. Solo lleva lo que difiere
 *  del default: una URL limpia se puede leer. */
export function eduCasosPanelQuery(f: EduCasosPanelFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set("estado", f.status);
  if (f.programId) p.set("especialidad", f.programId);
  if (f.studentId) p.set("alumno", f.studentId);
  if (f.supervisorUserId) p.set("docente", f.supervisorUserId);
  if (f.incluirCerrados) p.set("cerrados", "1");
  if (f.desdeISO) p.set("desde", f.desdeISO);
  if (f.hastaISO) p.set("hasta", f.hastaISO);
  if (f.q) p.set("q", f.q);
  return p.toString();
}

export function eduHasCasosPanelFilters(f: EduCasosPanelFilters): boolean {
  return Boolean(
    f.status ||
      f.programId ||
      f.studentId ||
      f.supervisorUserId ||
      f.incluirCerrados ||
      f.desdeISO ||
      f.hastaISO ||
      f.q,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA FILA QUE VIAJA A LA PANTALLA
// ═══════════════════════════════════════════════════════════════════════

export interface EduCasosPanelRow {
  id: string;
  status: EduCaseStatus;
  statusLabel: string;

  patientId: string;
  patientName: string;
  patientFolio: string;

  studentId: string;
  studentName: string;
  studentMatricula: string;

  /** El docente RESPONSABLE del caso (columna del caso, congelada al
   *  abrirlo). null = el caso nació sin responsable designado. */
  supervisorName: string | null;

  programName: string;
  /** La generación del ALUMNO ("2026-A"). El caso no guarda generación:
   *  se lee del alumno, que es quien pertenece a una. */
  cohortName: string | null;
  semester: number;

  /** Día de apertura en el calendario del instituto. */
  openedISO: string;
  openedLabel: string;
  closedLabel: string | null;

  espera: EduCasoEspera;
}

export interface EduCasosPanelPage {
  rows: EduCasosPanelRow[];
  truncated: boolean;
}

// ════════════════════════════════════════════════════════════════════════
// EL TOPE DEL EXPORT NO ES EL DE LA PANTALLA
//
// 🔴 UN CSV Y UNA PANTALLA NO SIRVEN PARA LO MISMO, así que no pueden
// compartir techo. Una pantalla se lee: trescientos renglones ya son más
// de los que nadie recorre, y el aviso "acota con los filtros" es un
// consejo Útil. Un export existe justamente para LLEVARSE TODO — una
// acreditación pide los casos cerrados de la generación entera — y ahí
// "acota con los filtros" significa "arma el reporte a mano en cinco
// trozos y pégalos en Excel", que es peor que no tener export.
//
// Con el tope de pantalla, marcar la casilla de "incluir cerrados" en un
// instituto de 400 casos dejaba a la escuela SIN export: 413 y a mano.
// Medido con el instituto de demo.
//
// ⚠️ LO QUE NO CAMBIA es la regla: por encima de ESTE tope el 413 se
// queda. Un CSV silenciosamente incompleto es un reporte falso, y eso no
// depende de dónde esté el número.
// ════════════════════════════════════════════════════════════════════════

/**
 * Cuántos casos caben en UN export.
 *
 * Diez mil no es un número redondo por casualidad: es el orden de
 * magnitud del archivo histórico completo de una escuela mediana (el
 * instituto de demo, con dos generaciones y 18 meses, lleva 400), y a la
 * vez es un CSV de unos dos megas que Excel abre. Por encima de eso el
 * problema deja de ser el tope y pasa a ser que nadie va a leer ese
 * archivo: ahí el 413 con su mensaje es la respuesta correcta.
 */
export const EDU_CASOS_EXPORT_MAX_ROWS = 10000;

/**
 * De cuántos en cuántos se lee ese export.
 *
 * 🔴 SE LEE EN LOTES Y NO DE UN `take: 10001` a propósito. Cada fila
 * arrastra paciente, alumno, especialidad, docente y sus autorizaciones
 * pendientes; diez mil de golpe es un pico de memoria en el servidor por
 * una descarga que casi nunca llega a mil. En lotes, el caso normal paga
 * un solo viaje y el caso extremo paga varios pequeños.
 */
export const EDU_CASOS_EXPORT_BATCH = 500;

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL CSV
// ═══════════════════════════════════════════════════════════════════════

/**
 * El listado en CSV, con LOS MISMOS renglones que la pantalla.
 *
 * Reusa eduCsvCell/Row/File de evaluacion-core: el escape de comillas, el
 * BOM para Excel y el apóstrofe anti-fórmula ya se resolvieron una vez y
 * un segundo constructor de CSV es como se acaba con uno que escapa y otro
 * que no.
 */
export function buildEduCasosCsv(rows: EduCasosPanelRow[]): string {
  const lineas: string[] = [];
  lineas.push(
    eduCsvRow([
      "Folio",
      "Paciente",
      "Matrícula",
      "Estudiante",
      "Docente del caso",
      "Especialidad",
      "Generación",
      "Semestre",
      "Abierto",
      "Estado",
      "Esperando",
    ]),
  );
  for (const r of rows) {
    lineas.push(
      eduCsvRow([
        r.patientFolio,
        r.patientName,
        r.studentMatricula,
        r.studentName,
        r.supervisorName ?? "Sin responsable designado",
        r.programName,
        r.cohortName ?? "",
        r.semester,
        r.openedISO,
        EDU_CASE_STATUS_LABELS[r.status] ?? r.status,
        r.espera.label,
      ]),
    );
  }
  return eduCsvFile(lineas);
}
