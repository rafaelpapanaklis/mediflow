/**
 * DaleControl INSTITUCIONAL — LAS SEDES, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido). Aquí vive la ÚNICA decisión de esta ola que, si se escribe
 * dos veces, termina discrepando: **a qué sedes puede entrar quien está
 * mirando, y cuál está viendo ahora mismo**.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA SEDE NO SUSTITUYE AL INSTITUTO
 *
 * `institutionId` es el aislamiento DURO entre escuelas y no se toca: sale
 * de getEduContext() y filtra TODA consulta del vertical. La sede es una
 * división DENTRO de una escuela — el campus norte y el campus sur de la
 * misma universidad.
 *
 * Usar `campusId` como si fuera el filtro de tenant dejaría la puerta
 * abierta entre institutos (dos escuelas pueden tener las dos una sede con
 * la misma clave, y los ids son opacos), y el bug se vería exactamente
 * igual que "funciona". Por eso este archivo NUNCA devuelve un filtro de
 * sede suelto: devuelve una LISTA DE IDS que el llamador añade al `where`
 * que ya lleva el institutionId.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 🔴 SIN FILAS DE ACCESO = TODAS LAS SEDES. Ésta es la regla de
 * compatibilidad hacia atrás de la ola: el día que se aplica, NADIE tiene
 * filas en edu_user_campus_access, así que nadie se queda fuera. Con filas,
 * solo esas.
 *
 * ⚠️ Y el corolario que muerde: una lista RESUELTA VACÍA no es lo mismo que
 * "sin filas". Si alguien tiene filas y todas apuntan a sedes que ya no
 * existen, lo correcto es que no vea NINGUNA sede — `campusIds: []`, que en
 * Prisma es `{ in: [] }` y devuelve cero filas — y NO `campusIds: null`,
 * que es "sin filtro" y devuelve el instituto entero. Las dos cosas se
 * escriben casi igual y una de ellas es una fuga.
 */
import type { EduRole } from "@/lib/edu/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · CONSTANTES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cookie del selector. Se VALIDA en cada lectura contra las sedes a las que
 * la persona tiene acceso, así que una cookie vieja (o escrita a mano) no
 * puede ampliar nada: como mucho se degrada a "todas las mías".
 *
 * Mismo mecanismo que `dcb_branch` del vertical de barbería
 * (src/lib/barber/branches.ts), con UNA diferencia que hay que tener
 * clara: allí la sucursal ES el tenant; aquí NO lo es.
 */
export const EDU_CAMPUS_COOKIE = "edu_sede";

/** Valor de la cookie para la vista consolidada. */
export const EDU_CAMPUS_ALL = "todas";

/** Techo de sedes por instituto. Alto pero finito. */
export const EDU_MAX_CAMPUSES = 40;

export const EDU_CAMPUS_NAME_MAX = 80;
export const EDU_CAMPUS_CODE_MAX = 20;
export const EDU_CAMPUS_ADDRESS_MAX = 200;
export const EDU_CAMPUS_NOTES_MAX = 300;

// ═══════════════════════════════════════════════════════════════════════
// 2 · LAS FORMAS QUE VIAJAN A LA PANTALLA
//
// Viven AQUÍ, en el módulo puro, porque los componentes "use client" las
// necesitan y campus.ts importa prisma. Un `import type` se borra al
// compilar, pero basta con que alguien le quite el `type` para arrastrar el
// runtime de Prisma al navegador. Si el tipo no vive ahí, no hay de dónde.
// ═══════════════════════════════════════════════════════════════════════

/** Lo mínimo para pintar el selector y para decidir el alcance. */
export interface EduCampusOption {
  id: string;
  name: string;
  code: string;
  timezone: string;
  isActive: boolean;
}

/** La fila de /instituto/sedes. */
export interface EduCampusRow extends EduCampusOption {
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  notes: string | null;
  orderIndex: number;
  /** Sillones dados de alta en esta sede (y cuántos siguen activos). */
  chairs: number;
  activeChairs: number;
  /** Citas futuras que cuelgan de sus sillones. Lo lee el aviso de baja. */
  upcoming: number;
  /**
   * Personas con acceso EXPLÍCITO a esta sede. 0 NO significa "no entra
   * nadie": significa que nadie la tiene restringida a ella, y quien no
   * tiene ninguna fila entra a todas. La pantalla lo dice con todas sus
   * letras porque es al revés de lo que sugiere una lista de accesos.
   */
  people: number;
  createdAt: string;
}

/** Una persona en la lista de acceso de una sede. */
export interface EduCampusPersonRow {
  userId: string;
  name: string;
  email: string;
  role: EduRole;
  isActive: boolean;
  /** ¿Tiene fila para ESTA sede? */
  allowed: boolean;
  /** Cuántas sedes tiene marcadas EN TOTAL (0 = entra a todas). */
  campusCount: number;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL ACCESO Y EL ALCANCE
// ═══════════════════════════════════════════════════════════════════════

/**
 * A qué sedes entra una persona.
 *
 * 🔴 "all" NO es un privilegio: es lo que devuelve NO tener ninguna fila,
 * que es el estado de todo el mundo el día que se aplica esta ola.
 */
export type EduCampusAccess = { kind: "all" } | { kind: "some"; campusIds: string[] };

/** El alcance ya resuelto: lo que la pantalla pinta y lo que el `where` aplica. */
export interface EduCampusScope {
  /**
   * Los ids que hay que meter en el `where`, o `null` = SIN filtro de sede.
   *
   * 🔴 `null` y `[]` son lo contrario: `null` no filtra (todo el instituto)
   * y `[]` no devuelve nada. Nunca se pueden confundir — ver la nota de
   * arriba del archivo.
   */
  campusIds: string[] | null;
  /** La sede elegida en el selector; null = vista consolidada. */
  activeId: string | null;
  /** La sede elegida, entera (para el título y la zona horaria). */
  active: EduCampusOption | null;
  /** Las sedes que esta persona puede elegir. */
  options: EduCampusOption[];
  /**
   * ¿Se pinta el selector? Con UNA sola opción, NO: nadie elige entre una
   * opción, y una barra superior con un desplegable de un solo elemento
   * hace creer que falta algo.
   */
  showPicker: boolean;
  /** Etiqueta honesta de la opción consolidada. */
  allLabel: string;
  /** La zona horaria que toca aplicar (la de la sede, o la del instituto). */
  timezone: string;
  /**
   * true = esta persona ve sedes en HUSOS distintos y está en consolidado.
   * La agenda lo DICE: pintar dos husos en la misma rejilla es mentir.
   */
  mixedTimezones: boolean;
  /** true = el instituto tiene sedes y esta persona no puede entrar a ninguna. */
  locked: boolean;
}

/**
 * Lo que hay que sumarle a un contexto de sesión para que la capa de datos
 * respete la sede. Se pasa EXPLÍCITO y no por una variable global: un
 * alcance implícito es el que un endpoint nuevo olvida.
 */
export interface EduCampusAware {
  campusIds?: string[] | null;
}

/**
 * Acceso a partir de las filas guardadas. Sin filas → todas.
 *
 * Se cruza con las sedes que EXISTEN en el instituto para cerrar el tenant:
 * una fila que apuntara a la sede de otra escuela (por un insert a mano) no
 * puede colarse en el resultado.
 */
export function eduCampusAccessFromRows(
  rows: { campusId: string }[] | null | undefined,
  campusesDelInstituto: { id: string }[],
): EduCampusAccess {
  if (!Array.isArray(rows) || rows.length === 0) return { kind: "all" };
  const existentes = new Set((campusesDelInstituto ?? []).map((c) => c.id));
  const ids: string[] = [];
  for (const r of rows) {
    if (!r || typeof r.campusId !== "string") continue;
    if (!existentes.has(r.campusId)) continue;
    if (ids.includes(r.campusId)) continue;
    ids.push(r.campusId);
  }
  // 🔴 Ojo: si el cruce se queda vacío NO se devuelve "all". Tenía filas
  // —alguien decidió restringirla— y que sus sedes hayan desaparecido no es
  // motivo para abrirle el instituto entero.
  return { kind: "some", campusIds: ids };
}

/**
 * EL ALCANCE POR SEDE, resuelto.
 *
 * Entra: las sedes del instituto (todas), el acceso de la persona y lo que
 * pidió el cliente (la cookie del selector). Sale: qué se filtra, qué se
 * pinta y con qué zona horaria.
 *
 * Reglas, en orden:
 *  1. `allowed` = las sedes del instituto ∩ el acceso. Ese cruce es lo que
 *     cierra el tenant: un id de otra escuela no está en la lista y no
 *     puede entrar por la cookie.
 *  2. El selector solo ofrece sedes ACTIVAS, más la elegida si sigue siendo
 *     suya pero la cerraron (si no, un enlace guardado saltaría de sede sin
 *     decir nada).
 *  3. Una petición que no está en `allowed` NO es un error: se degrada a la
 *     vista consolidada DE LO SUYO. Pasa de verdad —a alguien le retiran el
 *     acceso y su cookie se queda vieja— y un 403 en la barra superior
 *     dejaría el panel inservible hasta que alguien borre una cookie.
 *  4. `campusIds` = [la elegida] · o la lista de las suyas · o `null`
 *     cuando entra a todas y no eligió ninguna (no filtrar es más barato y
 *     más honesto que enumerar el instituto entero).
 */
export function eduResolveCampusScope(input: {
  campuses: EduCampusOption[];
  access: EduCampusAccess;
  requested?: string | null;
  /** Zona del instituto: el respaldo cuando no hay una sede elegida. */
  institutionTimezone: string;
}): EduCampusScope {
  const campuses = Array.isArray(input?.campuses) ? input.campuses : [];
  const access = input?.access ?? { kind: "all" as const };
  const requested = typeof input?.requested === "string" ? input.requested.trim() : null;
  const fallbackTz = input?.institutionTimezone || "America/Mexico_City";

  // Sin sedes en el instituto: la ola no está aplicada o no se ha dado de
  // alta ninguna. NO se filtra nada — el panel tiene que seguir funcionando
  // exactamente como antes de esta ola.
  if (campuses.length === 0) {
    return {
      campusIds: null,
      activeId: null,
      active: null,
      options: [],
      showPicker: false,
      allLabel: "Todas las sedes",
      timezone: fallbackTz,
      mixedTimezones: false,
      locked: false,
    };
  }

  const allowed =
    access.kind === "all" ? campuses : campuses.filter((c) => access.campusIds.includes(c.id));

  const allLabel = access.kind === "all" ? "Todas las sedes" : "Todas mis sedes";

  // El instituto tiene sedes y a esta persona no le tocó ninguna. `[]` deja
  // sus pantallas vacías, que es exactamente lo correcto: se le restringió
  // a unas sedes y ninguna existe ya.
  if (allowed.length === 0) {
    return {
      campusIds: [],
      activeId: null,
      active: null,
      options: [],
      showPicker: false,
      allLabel,
      timezone: fallbackTz,
      mixedTimezones: false,
      locked: true,
    };
  }

  const active =
    requested && requested !== EDU_CAMPUS_ALL
      ? allowed.find((c) => c.id === requested) ?? null
      : null;

  const options = allowed.filter((c) => c.isActive || c.id === active?.id);

  if (active) {
    return {
      campusIds: [active.id],
      activeId: active.id,
      active,
      options,
      showPicker: options.length > 1,
      allLabel,
      timezone: active.timezone || fallbackTz,
      mixedTimezones: false,
      locked: false,
    };
  }

  // Consolidado. Si entra a todas, no se filtra (`null`); si entra a unas,
  // se enumeran las suyas.
  const zonas = new Set(allowed.map((c) => c.timezone || fallbackTz));
  return {
    campusIds: access.kind === "all" ? null : allowed.map((c) => c.id),
    activeId: null,
    active: null,
    options,
    showPicker: options.length > 1,
    allLabel,
    timezone: fallbackTz,
    mixedTimezones: zonas.size > 1,
    locked: false,
  };
}

/**
 * El contexto de la capa de datos, con la sede puesta.
 *
 * Existe para que las páginas no escriban `{ ...ctx, campusIds }` a mano
 * catorce veces: si una lo escribe mal (o lo olvida), esa pantalla deja de
 * respetar la sede y no lo dice.
 */
export function eduWithCampus<T extends object>(
  ctx: T,
  scope: EduCampusScope | null,
): T & EduCampusAware {
  return { ...ctx, campusIds: scope ? scope.campusIds : null };
}

/**
 * Cómo se lee una sede en pantalla: "Campus Norte (NORTE)".
 *
 * El código va entre paréntesis y no solo: la escuela habla por el nombre y
 * archiva por el código, y quien mira el selector busca el nombre.
 */
export function eduCampusLabel(c: { name: string; code: string } | null | undefined): string {
  if (!c) return "";
  const code = (c.code ?? "").trim();
  return code ? `${c.name} (${code})` : c.name;
}

/**
 * Clave corta de la sede: MAYÚSCULAS, sin espacios internos.
 *
 * Se normaliza porque el índice único es (institutionId, code) y Postgres
 * distingue mayúsculas: sin esto, "norte" y "NORTE" serían dos sedes con la
 * misma clave impresa en los papeles de la escuela.
 */
export function normalizeEduCampusCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (v.length === 0 || v.length > EDU_CAMPUS_CODE_MAX) return null;
  return v;
}

/**
 * Una clave propuesta a partir del nombre, para que dar de alta una sede no
 * empiece por inventarse un código. Solo letras y dígitos ASCII: es una
 * clave de archivo, no un texto — "Campus Norte" → "CAMPUSNORTE".
 */
export function suggestEduCampusCode(name: string): string {
  const base = (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return base.slice(0, EDU_CAMPUS_CODE_MAX);
}

/**
 * El resultado de decidir en qué sede se está cobrando.
 *
 * ⚠️ NO es una unión discriminada (`{ok:true,...} | {ok:false,...}`) y no es
 * por gusto: este repo compila con `strict: false`, y sin strictNullChecks
 * TypeScript NO estrecha una unión por un booleano literal — el `reason` de
 * la rama negativa "no existe" después de un `if (!x.ok)`. Un solo objeto
 * con los dos campos opcionales dice lo mismo y compila igual aquí y en un
 * repo estricto.
 */
export interface EduCampusForCharge {
  ok: boolean;
  /** La sede que se sella. null = el instituto todavía no tiene sedes. */
  campusId: string | null;
  /** Por qué no se puede cobrar. Solo cuando ok es false. */
  reason: string | null;
}

/**
 * ¿Qué sede se SELLA en un cobro?
 *
 * 🔴 Cobrar es un acto que ocurre en UN mostrador. Con la vista consolidada
 * puesta no hay respuesta —"todas" no es un lugar—, así que:
 *   · una sola sede en el instituto → ésa, sin preguntar;
 *   · una sede elegida en el selector → ésa;
 *   · consolidado con varias → se pide elegir, con un mensaje que dice
 *     dónde está el selector.
 *
 * Devuelve `{ campusId: null }` cuando el instituto todavía no tiene sedes:
 * el dinero no se detiene por una columna de infraestructura.
 */
export function eduCampusForCharge(scope: EduCampusScope | null | undefined): EduCampusForCharge {
  if (!scope) return { ok: true, campusId: null, reason: null };
  if (scope.locked) {
    return {
      ok: false,
      campusId: null,
      reason:
        "Tu cuenta no tiene acceso a ninguna sede de este instituto. Pídele a la dirección que te dé una.",
    };
  }
  if (scope.activeId) return { ok: true, campusId: scope.activeId, reason: null };
  if (scope.options.length === 1) return { ok: true, campusId: scope.options[0].id, reason: null };
  if (scope.options.length === 0) return { ok: true, campusId: null, reason: null };
  return {
    ok: false,
    campusId: null,
    reason:
      "Elige arriba en qué sede estás cobrando. Un cobro ocurre en un mostrador concreto, y con todas las sedes a la vez no se puede decir en cuál.",
  };
}
