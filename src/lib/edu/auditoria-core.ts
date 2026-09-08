/**
 * DaleControl INSTITUCIONAL — LA BITÁCORA (NOM-024) · la parte PURA.
 *
 * Módulo PURO y client-safe: sin prisma, sin "server-only", sin
 * `new Date()` escondido. El catálogo de acciones, el de entidades, el
 * diff campo a campo y el cursor de la paginación. Lo que toca la base
 * vive en auditoria.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 POR QUÉ ESTO EXISTE (fila 21 del informe ws2-t1)
 *
 * «No hay ningún `model EduAudit*` en el esquema: 45 modelos Edu*,
 * ninguno de bitácora. Hay atribución por fila dispersa
 * (`historyRecordedBy`, `authorUserId`, `uploadedById`, `recordedById`)
 * pero ninguna pantalla que las junte, y NO SE REGISTRAN LAS LECTURAS.»
 *
 * Las lecturas son la mitad que más cuesta y la que la norma pide con
 * nombre propio: la NOM-024 §6.3.5 obliga a poder contestar quién ABRIÓ
 * un expediente, no solo quién lo escribió. El dental ya lo hace
 * (`action: "view"`, en el `page.tsx` de la ficha).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UN SOLO ESCRITOR, Y ESTÁ EN auditoria.ts: `eduAudit(...)`.
 *
 * Doce sitios escribiendo la bitácora a mano es cómo se llega a que el
 * decimotercero no la escriba, y una bitácora con huecos no prueba nada:
 * "no hay renglón" y "no pasó" se ven exactamente igual desde fuera. Es
 * el mismo argumento que ya sostiene `visibility.ts` y `permissions.ts`.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════
// 1 · QUÉ SE REGISTRA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las acciones. Son SIETE y no una cadena libre: `"update"`, `"UPDATE"` y
 * `"actualizar"` en la misma columna hacen que el filtro de la pantalla
 * mienta, y nadie lo nota porque la bitácora nunca sale en rojo.
 *
 * Los valores son los MISMOS que usa el `AuditLog` del dental
 * ("create" | "update" | "delete" | "view") más los tres actos que este
 * vertical tiene y el dental no.
 */
export const EDU_AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  /** La LECTURA de un expediente. Es la que pide la NOM-024 §6.3.5. */
  "view",
  /** Firmar una nota, expedir una receta, contrafirmar un consentimiento. */
  "sign",
  /** Exportar a CSV o descargar un PDF: el dato SALE de la escuela. */
  "export",
  /** Baja ARCO, anonimización y fusión. Actos de datos personales. */
  "arco",
  /**
   * ENTRADA y SALIDA. Las dos preguntas que la bitácora no podía contestar
   * y que son las primeras que hace cualquiera que investiga algo: «¿quién
   * entró esa tarde?» y «¿había cerrado sesión?». El panel se usa de pie en
   * el piso clínico y en equipo compartido — lo dice la propia hoja del
   * vertical—, así que no son un adorno de cumplimiento.
   */
  "login",
  "logout",
] as const;

export type EduAuditAction = (typeof EDU_AUDIT_ACTIONS)[number];

export const EDU_AUDIT_ACTION_LABELS: Record<EduAuditAction, string> = {
  create: "Creó",
  update: "Modificó",
  delete: "Dio de baja",
  view: "Abrió",
  sign: "Firmó",
  export: "Exportó",
  arco: "Datos personales",
  login: "Entró",
  logout: "Salió",
};

/**
 * Las entidades. Cerradas por la misma razón que las acciones, y con el
 * nombre del MODELO en singular y en minúsculas para que el renglón se
 * pueda leer sin diccionario.
 */
export const EDU_AUDIT_ENTITIES = [
  "patient",
  "case",
  "appointment",
  "record",
  "odontogram",
  "study",
  "photo",
  "consent",
  "prescription",
  "charge",
  "payment",
  "invoice",
  "quote",
  "treatmentPlan",
  "questionnaire",
  "cashSession",
  "feeSchedule",
  "user",
  "student",
  "institution",
  "agendaBlock",
  "aiQuota",
  /** La sesión de la persona: entrar, salir y estrenar contraseña. */
  "session",
  // ⚠️ NO se añade `campus` todavía, y es a propósito. H-140 (dar y quitar
  // el acceso de alguien a una sede desde /instituto/sedes) sigue sin dejar
  // renglón, pero su escritor —`setEduCampusAccess`, en campus.ts— no
  // recibe hoy el nombre del actor que `eduAudit` necesita. Poner la
  // entidad sin nadie que la escriba dejaría un filtro que SIEMPRE sale
  // vacío en la pantalla de dirección, que es justo el defecto que la
  // auditoría le señala a «Odontograma». Se añade el día que se añada el
  // renglón. (Dar y quitar sedes desde la FICHA de la persona sí deja
  // renglón: `setEduTeamMemberCampuses`, con entidad `user`.)
] as const;

export type EduAuditEntity = (typeof EDU_AUDIT_ENTITIES)[number];

export const EDU_AUDIT_ENTITY_LABELS: Record<EduAuditEntity, string> = {
  patient: "Paciente",
  case: "Caso",
  appointment: "Cita",
  record: "Nota clínica",
  odontogram: "Odontograma",
  study: "Estudio",
  photo: "Foto clínica",
  consent: "Consentimiento",
  prescription: "Receta",
  charge: "Cobro",
  payment: "Pago",
  invoice: "Factura",
  quote: "Presupuesto",
  treatmentPlan: "Plan de tratamiento",
  questionnaire: "Cuestionario de salud",
  cashSession: "Turno de caja",
  feeSchedule: "Lista de precios",
  user: "Cuenta",
  student: "Estudiante",
  institution: "Instituto",
  agendaBlock: "Bloqueo de agenda",
  aiQuota: "Cupo de IA",
  session: "Sesión",
};

export function eduAuditIsAction(raw: unknown): raw is EduAuditAction {
  return typeof raw === "string" && (EDU_AUDIT_ACTIONS as readonly string[]).includes(raw);
}

export function eduAuditIsEntity(raw: unknown): raw is EduAuditEntity {
  return typeof raw === "string" && (EDU_AUDIT_ENTITIES as readonly string[]).includes(raw);
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL DIFF
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los campos que NUNCA entran a la bitácora, ni en `before` ni en
 * `after`.
 *
 * 🔴 ESTO NO ES ESTÉTICA: una bitácora es una tabla que se lee ENTERA
 * desde una pantalla de dirección, y meter ahí el índice de búsqueda con
 * el nombre y el teléfono del paciente sería copiar el PII a un sitio del
 * que la anonimización ARCO no lo puede sacar. Lo mismo con la fecha de
 * modificación, que no dice nada y ensucia todos los diffs.
 */
export const EDU_AUDIT_CAMPOS_IGNORADOS = new Set([
  "searchIndex",
  "updatedAt",
  "createdAt",
  "updatedById",
]);

/** Tope de campos por diff. Un renglón de bitácora no es un volcado. */
export const EDU_AUDIT_MAX_CAMPOS = 40;

/** Tope de caracteres por valor. Una nota SOAP de 4 000 no cabe entera. */
export const EDU_AUDIT_MAX_VALOR = 300;

/**
 * Normaliza un valor para poder compararlo y guardarlo en JSON.
 *
 * Las fechas se pasan a ISO (dos `Date` del mismo instante no son `===`),
 * los arrays se ordenan y se juntan (`["a","b"]` y `["b","a"]` son el
 * mismo conjunto de alergias) y todo lo demás se recorta.
 */
export function eduAuditNormalizarValor(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return [...v].map((x) => String(x)).sort().join(", ").slice(0, EDU_AUDIT_MAX_VALOR);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v).slice(0, EDU_AUDIT_MAX_VALOR);
    } catch {
      return "[objeto]";
    }
  }
  if (typeof v === "string") return v.slice(0, EDU_AUDIT_MAX_VALOR);
  return v;
}

export interface EduAuditDiff {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Cuántos campos cambiaron. 0 = no hay nada que registrar. */
  cambios: number;
}

/**
 * El diff campo a campo entre dos fotos de la misma fila.
 *
 * 🔴 SOLO LOS CAMPOS QUE CAMBIARON. Guardar la fila entera en cada
 * renglón convierte la bitácora en una copia de la tabla, y leer "¿qué
 * cambió?" en un ejercicio de comparar dos párrafos a ojo. El dental
 * guarda `{ field: { before, after } }` por la misma razón.
 *
 * 🔴 SI NO CAMBIÓ NADA, `cambios` es 0 y el escritor NO escribe. Un
 * `update` que no cambió nada no es un acto: es un botón que alguien
 * pulsó dos veces, y llenar la bitácora de esos es como se deja de poder
 * leer.
 */
export function eduAuditDiff(
  antes: Record<string, unknown> | null | undefined,
  despues: Record<string, unknown> | null | undefined,
): EduAuditDiff {
  if (!antes && !despues) return { before: null, after: null, cambios: 0 };

  // Un alta (sin `antes`) o una baja (sin `despues`) no son un diff: se
  // guarda la foto que hay, recortada.
  if (!antes) return { before: null, after: eduAuditFoto(despues ?? {}), cambios: 1 };
  if (!despues) return { before: eduAuditFoto(antes), after: null, cambios: 1 };

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  let cambios = 0;

  for (const key of Object.keys(despues)) {
    if (EDU_AUDIT_CAMPOS_IGNORADOS.has(key)) continue;
    if (cambios >= EDU_AUDIT_MAX_CAMPOS) break;
    const a = eduAuditNormalizarValor(antes[key]);
    const b = eduAuditNormalizarValor(despues[key]);
    if (a === b) continue;
    before[key] = a;
    after[key] = b;
    cambios += 1;
  }

  if (cambios === 0) return { before: null, after: null, cambios: 0 };
  return { before, after, cambios };
}

/** Una foto recortada de una fila, para un alta o una baja. */
export function eduAuditFoto(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const key of Object.keys(row)) {
    if (EDU_AUDIT_CAMPOS_IGNORADOS.has(key)) continue;
    if (n >= EDU_AUDIT_MAX_CAMPOS) break;
    out[key] = eduAuditNormalizarValor(row[key]);
    n += 1;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA PAGINACIÓN POR CURSOR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cuántos renglones por página. La bitácora de una escuela con 120 alumnos
 * crece a miles de filas por semana: no hay una vista de "todo".
 */
export const EDU_AUDIT_PAGE_SIZE = 50;
export const EDU_AUDIT_PAGE_MAX = 200;

export interface EduAuditCursor {
  createdAt: Date;
  id: string;
}

/**
 * El cursor: `<createdAt ISO>|<id>`.
 *
 * 🔴 EL PAR COMPLETO, NO SOLO LA FECHA. Dos renglones escritos en el mismo
 * milisegundo —y la bitácora los escribe: una fusión mete nueve— se
 * ordenarían de forma arbitraria entre dos consultas y el cursor saltaría
 * uno. El `orderBy` y la condición del cursor son la MISMA pareja
 * (createdAt desc, id desc), y por eso el desempate es total.
 *
 * ⚠️ El cursor NO es una credencial y no abre nada: el `where` del
 * instituto se aplica igual, así que uno copiado de otra sesión sigue sin
 * enseñar la bitácora de otra escuela.
 */
export function eduAuditCursorEncode(row: { createdAt: Date | string; id: string }): string {
  const iso = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  return `${iso}|${row.id}`;
}

export function eduAuditCursorDecode(raw: unknown): EduAuditCursor | null {
  if (typeof raw !== "string") return null;
  const corte = raw.indexOf("|");
  if (corte <= 0) return null;
  const id = raw.slice(corte + 1);
  if (!id || id.length > 40 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const d = new Date(raw.slice(0, corte));
  if (Number.isNaN(d.getTime())) return null;
  return { createdAt: d, id };
}

export function eduAuditParseTake(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return EDU_AUDIT_PAGE_SIZE;
  return Math.min(Math.trunc(n), EDU_AUDIT_PAGE_MAX);
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LO QUE SE PINTA
// ═══════════════════════════════════════════════════════════════════════

export interface EduAuditRow {
  id: string;
  createdAt: string;
  actorName: string;
  actorRole: string;
  action: EduAuditAction | string;
  actionLabel: string;
  entity: EduAuditEntity | string;
  entityLabel: string;
  entityId: string | null;
  patientId: string | null;
  campos: { campo: string; antes: unknown; despues: unknown }[];
  ip: string | null;
}

/**
 * Aplana el diff a la tabla de tres columnas que se pinta (Campo · Antes ·
 * Después), que es la misma forma que el dental.
 */
export function eduAuditCampos(
  before: unknown,
  after: unknown,
): { campo: string; antes: unknown; despues: unknown }[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const claves = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  return claves.map((campo) => ({ campo, antes: b[campo] ?? null, despues: a[campo] ?? null }));
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL RANGO DE FECHAS (Ola C·2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Un día `YYYY-MM-DD` del filtro, convertido al instante que le
 * corresponde en UTC.
 *
 * ⚠️ SE FILTRA EN UTC Y LA PANTALLA LO DICE. La bitácora guarda
 * `createdAt` en UTC y esta función no sabe la zona del instituto, así que
 * «7 de septiembre» aquí es de 00:00Z a 24:00Z. En México eso desplaza el
 * corte unas horas: un renglón de las 19:00 del día 6 en Tijuana cae en el
 * 7. Se acepta a propósito —el filtro es para acotar, no para cuadrar un
 * libro contable— y el renglón trae SU hora escrita, que es el dato con el
 * que se responde de verdad. Convertirlo bien pide la zona del instituto
 * en el cliente de la pantalla, y esa es una vuelta que no cambia ninguna
 * respuesta.
 *
 * `fin: true` devuelve el instante EXCLUSIVO del día siguiente, para que
 * «hasta el 7» incluya el 7 entero. Un `lte` sobre las 00:00 del 7 se
 * comería el día completo, que es el error clásico de este filtro.
 */
export function eduAuditParseDia(raw: unknown, fin = false): Date | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (fin) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// ═══════════════════════════════════════════════════════════════════════
// LA ANONIMIZACIÓN DE LOS RENGLONES YA ESCRITOS (ARCO)
// ═══════════════════════════════════════════════════════════════════════

/**
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 SUSTITUYE, EN UN `before`/`after` YA GUARDADO, LAS CLAVES QUE SON PII.
 *
 * `anonymizeEduPatient` promete por escrito que «la bitácora no guarda el
 * PII que se borró», y no era verdad: el alta del paciente escribe
 * `{ folio, nombre }` y la corrección de la ficha guarda el antes y el
 * después de siete columnas, entre ellas `phone`, `email` y `curp`. La
 * anonimización solo tocaba `eduPatient`, así que se anonimizaba a la
 * paciente, se abría «Bitácora de este paciente» —el botón está en la
 * propia pantalla de ARCO— y ahí seguía su nombre y su teléfono.
 *
 * 🔴 SE SUSTITUYE EL VALOR, NO SE BORRA EL RENGLÓN. Que alguien corrigió el
 * teléfono el 3 de marzo es la constancia que la NOM-024 quiere poder leer,
 * y es lo que separa esta tabla de un cajón. Lo que deja de estar es CUÁL
 * era el teléfono. Por eso tampoco se toca `folio`: es la llave con la que
 * la escuela encuentra el expediente en papel, y la propia anonimización lo
 * conserva (prefijado) por ese mismo motivo.
 *
 * 🔴 Y NO ES RECURSIVO. Los `before`/`after` de esta bitácora son objetos
 * planos de un nivel —los arma `eduAuditDiff` a partir de listas cerradas
 * de columnas— y una sustitución que baje por estructuras anidadas es una
 * que un día sustituye una clave que resultó llamarse igual dentro de otra
 * cosa. Si algún día se guarda algo anidado, esto se queda corto de forma
 * VISIBLE (el valor sigue ahí) y no en silencio.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Devuelve `null` en `valor` cuando no había nada que redactar, para que
 * quien llama sepa que ese renglón no hace falta reescribirlo.
 */
export function eduAuditRedactaClaves(
  crudo: unknown,
  claves: readonly string[],
  marca: string,
): { valor: Record<string, unknown> | null; cambios: number } {
  if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) {
    return { valor: null, cambios: 0 };
  }
  const set = new Set(claves);
  const out: Record<string, unknown> = { ...(crudo as Record<string, unknown>) };
  let cambios = 0;
  for (const k of Object.keys(out)) {
    if (!set.has(k)) continue;
    // Un valor que ya está sustituido no se vuelve a contar: correr la
    // anonimización dos veces no puede dar dos resultados distintos.
    if (out[k] === marca || out[k] === null || out[k] === undefined) continue;
    out[k] = marca;
    cambios += 1;
  }
  return { valor: cambios > 0 ? out : null, cambios };
}
