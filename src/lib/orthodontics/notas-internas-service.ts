// Ortodoncia — «Notas internas» del caso: las reglas, SIN base de datos ni React.
// `repo` es cualquier cosa con la forma de `RepoNotasInternas` (en producción, `repoNotasInternas` de
// ./notas-internas-db.ts; en las pruebas, uno en memoria).
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔒 SOLO-EQUIPO (NOTAS_INTERNAS_SOLO_EQUIPO)
// Este módulo, su base (./notas-internas-db), su acceso (./notas-internas-acceso), la ruta
// /api/orthodontics/internal-notes, la tabla `ortho_internal_notes` y la herramienta `orto_notas_internas`
// de Sabina son de uso INTERNO de la clínica. NUNCA deben importarse ni mencionarse desde:
//   · el portal del paciente  (src/app/api/paciente/**, src/lib/patient-portal/**, src/app/paciente/**),
//   · el PDF del expediente   (src/lib/expediente-pdf/**, src/app/api/patients/[id]/expediente-pdf/**),
//   · los mensajes al paciente ni el bot de WhatsApp (src/lib/whatsapp/**).
// `notas-internas-solo-equipo.test.ts` lee esos fuentes y FALLA si encuentra cualquiera de los nombres de
// arriba. Si algún día una nota tiene que salir, no se cuela por aquí: se decide aparte y se cambia esa prueba
// a propósito.
// ═══════════════════════════════════════════════════════════════════════════
//
// Leyes (NOM-004 / NOM-024: el expediente no se destruye):
//  · `clinicId` sale SIEMPRE de la sesión; sin él, todo se corta ANTES de consultar (nunca `clinicId: undefined`).
//  · Una nota NO se borra jamás: este servicio no tiene «borrar» y el repo tampoco.
//  · Corregir una nota guarda el texto ANTERIOR como una revisión (quién la corrigió y cuándo) y recién
//    después cambia el texto vigente. Cada corrección deja una revisión; ninguna se pierde.
//  · Quién corrige: el AUTOR de la nota o un ADMIN / SUPER_ADMIN (`puedeCorregirNota`).

/** El tope de caracteres de una nota interna (y de cada corrección). UNA sola constante. */
export const MAX_CARACTERES_NOTA = 4000;

/** La marca que las pruebas buscan para saber que este módulo es de solo-equipo. */
export const MARCA_SOLO_EQUIPO = "NOTAS_INTERNAS_SOLO_EQUIPO";

export interface RevisionNota {
  id: string;
  noteId: string;
  /** El texto que había ANTES de esta corrección. */
  textoAnterior: string;
  /** Cuándo se había escrito (o corregido por última vez) ese texto anterior. */
  textoAnteriorDesde: Date;
  /** Quién hizo esta corrección y cuándo. */
  corregidaPorId: string;
  corregidaPorNombre: string | null;
  corregidaEl: Date;
}

export interface NotaInterna {
  id: string;
  clinicId: string;
  patientId: string;
  /** El id del caso de ortodoncia (`orthodontic_treatment_plans.id`). */
  caseId: string;
  authorId: string;
  authorNombre: string | null;
  texto: string;
  createdAt: Date;
  updatedAt: Date;
  /** De la más reciente a la más antigua. Vacía si nunca se corrigió. */
  revisiones: RevisionNota[];
}

export interface FilaNotaNueva {
  clinicId: string;
  patientId: string;
  caseId: string;
  authorId: string;
  texto: string;
}

export interface RepoNotasInternas {
  tablaExiste(): Promise<boolean>;
  /** Las notas del caso (con sus revisiones), de la más reciente a la más antigua. Siempre con `clinicId`. */
  listar(clinicId: string, caseId: string): Promise<NotaInterna[]>;
  obtener(clinicId: string, id: string): Promise<NotaInterna | null>;
  insertar(fila: FilaNotaNueva): Promise<NotaInterna>;
  /**
   * Guarda el texto vigente como revisión y pone el nuevo, todo junto (o nada). `null` = la nota no existe
   * en esa clínica. NO existe un «borrar».
   */
  corregir(clinicId: string, id: string, texto: string, corregidaPorId: string): Promise<NotaInterna | null>;
}

export type CodigoNota =
  | "SIN_CLINICA"
  | "SIN_USUARIO"
  | "SIN_CASO"
  | "SIN_PACIENTE"
  | "TEXTO_VACIO"
  | "TEXTO_LARGO"
  | "SIN_CAMBIOS"
  | "NO_ENCONTRADA"
  | "SOLO_AUTOR_O_ADMIN"
  | "SIN_TABLA";

export const STATUS_NOTA: Record<CodigoNota, 400 | 403 | 404 | 409 | 503> = {
  SIN_CLINICA: 400,
  SIN_USUARIO: 400,
  SIN_CASO: 400,
  SIN_PACIENTE: 400,
  TEXTO_VACIO: 400,
  TEXTO_LARGO: 400,
  SIN_CAMBIOS: 409,
  NO_ENCONTRADA: 404,
  SOLO_AUTOR_O_ADMIN: 403,
  SIN_TABLA: 503,
};

export type ResultadoNota<T> = { ok: true; valor: T } | { ok: false; codigo: CodigoNota; status: number };

const falla = <T>(codigo: CodigoNota): ResultadoNota<T> => ({ ok: false, codigo, status: STATUS_NOTA[codigo] });
const bien = <T>(valor: T): ResultadoNota<T> => ({ ok: true, valor });

const hay = (x: unknown): x is string => typeof x === "string" && x.length > 0;

/** El texto de una nota: sin espacios en las puntas, no vacío y dentro del tope. */
export function validarTextoNota(crudo: unknown): { ok: true; texto: string } | { ok: false; codigo: "TEXTO_VACIO" | "TEXTO_LARGO" } {
  const texto = typeof crudo === "string" ? crudo.trim() : "";
  if (!texto) return { ok: false, codigo: "TEXTO_VACIO" };
  if (texto.length > MAX_CARACTERES_NOTA) return { ok: false, codigo: "TEXTO_LARGO" };
  return { ok: true, texto };
}

/** Quién actúa: SIEMPRE de la sesión. */
export interface ActorNota {
  userId: string;
  role: string;
}

/**
 * ¿Puede corregir esta nota? Conservador: el autor, o un ADMIN / SUPER_ADMIN de la clínica.
 * (Decisión por defecto; si Rafael quiere que cualquiera del equipo pueda corregir, es solo esta función.)
 */
export function puedeCorregirNota(nota: Pick<NotaInterna, "authorId">, actor: ActorNota): boolean {
  if (!hay(actor.userId)) return false;
  if (actor.role === "ADMIN" || actor.role === "SUPER_ADMIN") return true;
  return nota.authorId === actor.userId;
}

/** Las notas de un caso. Sin `clinicId` o sin caso no se consulta. */
export async function listarNotas(
  repo: RepoNotasInternas,
  args: { clinicId: string; caseId: string },
): Promise<ResultadoNota<NotaInterna[]>> {
  if (!hay(args.clinicId)) return falla("SIN_CLINICA");
  if (!hay(args.caseId)) return falla("SIN_CASO");
  if (!(await repo.tablaExiste())) return falla("SIN_TABLA");
  return bien(await repo.listar(args.clinicId, args.caseId));
}

/**
 * Crea una nota. El que llama ya comprobó que el caso es de esa clínica y de ese paciente y que el actor
 * puede ver al paciente (la ruta); aquí van las reglas del texto y de la autoría (el autor es quien tiene la
 * sesión, nunca lo que mande el cliente).
 */
export async function crearNota(
  repo: RepoNotasInternas,
  args: { clinicId: string; patientId: string; caseId: string; authorId: string; texto: unknown },
): Promise<ResultadoNota<NotaInterna>> {
  if (!hay(args.clinicId)) return falla("SIN_CLINICA");
  if (!hay(args.authorId)) return falla("SIN_USUARIO");
  if (!hay(args.caseId)) return falla("SIN_CASO");
  if (!hay(args.patientId)) return falla("SIN_PACIENTE");
  const t = validarTextoNota(args.texto);
  if (t.ok === false) return falla(t.codigo);
  if (!(await repo.tablaExiste())) return falla("SIN_TABLA");
  const nota = await repo.insertar({
    clinicId: args.clinicId,
    patientId: args.patientId,
    caseId: args.caseId,
    authorId: args.authorId,
    texto: t.texto,
  });
  return bien(nota);
}

/**
 * Corrige una nota: guarda el texto anterior como revisión y deja el nuevo como vigente. La nota se busca
 * SIEMPRE con la clínica de la sesión: la de otra clínica «no existe».
 */
export async function corregirNota(
  repo: RepoNotasInternas,
  args: { clinicId: string; id: string; actor: ActorNota; texto: unknown },
): Promise<ResultadoNota<NotaInterna>> {
  if (!hay(args.clinicId)) return falla("SIN_CLINICA");
  if (!hay(args.actor?.userId)) return falla("SIN_USUARIO");
  if (!hay(args.id)) return falla("NO_ENCONTRADA");
  const t = validarTextoNota(args.texto);
  if (t.ok === false) return falla(t.codigo);
  if (!(await repo.tablaExiste())) return falla("SIN_TABLA");
  const actual = await repo.obtener(args.clinicId, args.id);
  if (!actual) return falla("NO_ENCONTRADA");
  if (!puedeCorregirNota(actual, args.actor)) return falla("SOLO_AUTOR_O_ADMIN");
  if (actual.texto === t.texto) return falla("SIN_CAMBIOS");
  const nueva = await repo.corregir(args.clinicId, args.id, t.texto, args.actor.userId);
  if (!nueva) return falla("NO_ENCONTRADA");
  return bien(nueva);
}

/** Lo que viaja al navegador: fechas en ISO, y si ESTA persona puede corregir cada nota. Nunca el `clinicId`. */
export interface NotaInternaDTO {
  id: string;
  caseId: string;
  authorId: string;
  authorNombre: string | null;
  texto: string;
  createdAt: string;
  updatedAt: string;
  corregida: boolean;
  puedeCorregir: boolean;
  revisiones: Array<{
    id: string;
    textoAnterior: string;
    textoAnteriorDesde: string;
    corregidaPorNombre: string | null;
    corregidaEl: string;
  }>;
}

export function aDTO(n: NotaInterna, actor: ActorNota): NotaInternaDTO {
  return {
    id: n.id,
    caseId: n.caseId,
    authorId: n.authorId,
    authorNombre: n.authorNombre,
    texto: n.texto,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    corregida: n.revisiones.length > 0,
    puedeCorregir: puedeCorregirNota(n, actor),
    revisiones: n.revisiones.map((r) => ({
      id: r.id,
      textoAnterior: r.textoAnterior,
      textoAnteriorDesde: r.textoAnteriorDesde.toISOString(),
      corregidaPorNombre: r.corregidaPorNombre,
      corregidaEl: r.corregidaEl.toISOString(),
    })),
  };
}
