/**
 * DaleControl INSTITUCIONAL — el cerebro del ODONTOGRAMA, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"). Decide qué es
 * un diente válido, qué es una cara válida y qué es un hallazgo válido —
 * las tres cosas que, si no se validan en el SERVIDOR, convierten el
 * odontograma en un campo de texto libre con forma de dibujo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL CATÁLOGO DE HALLAZGOS SE **IMPORTA**, NO SE COPIA.
 *
 * `src/components/dashboard/odontogram-v2/data.ts` es un módulo PURO del
 * dental: no importa prisma, no importa nada de "@/", no toca `window` ni
 * `fetch`, no lleva "use client". Trae los 45 hallazgos agrupados por
 * especialidad (diagnóstico, restauradora, endodoncia, cirugía,
 * ortodoncia, preventivo, periodoncia, odontopediatría) y la clasificación
 * anatómica FDI.
 *
 * El vertical lo IMPORTA tal cual y NO lo edita ni lo copia a medias.
 * Copiarlo habría dado dos catálogos que empiezan iguales y terminan
 * distintos: el día que alguien agregue "caries radicular" al del dental,
 * el del instituto seguiría sin tenerla y nadie lo notaría hasta que un
 * alumno intentara marcarla.
 *
 * Lo que el vertical NO usa del dental es su ADAPTADOR
 * (odontogram-v2/adapter.ts), que habla con /api/odontogram y escribe en
 * la tabla `odontogram_entries` del producto dental. Las escrituras de esta
 * ola van a `edu_odontogram_entries` por /api/instituto/**.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { COND_BY_ID, classify } from "@/components/dashboard/odontogram-v2/data";
import type { Records, ToothRecord } from "@/components/dashboard/odontogram-v2/types";

export type { Records, ToothRecord } from "@/components/dashboard/odontogram-v2/types";

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL DIENTE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Los cuadrantes FDI válidos: 1-4 permanentes, 5-8 temporales.
 * Dentro de cada uno, la pieza va de 1 a 8 en permanentes y de 1 a 5 en
 * temporales (no existe un "56": los niños tienen cinco piezas por
 * cuadrante).
 */
export function eduIsValidFdi(tooth: unknown): tooth is number {
  if (typeof tooth !== "number" || !Number.isInteger(tooth)) return false;
  const q = Math.floor(tooth / 10);
  const n = tooth % 10;
  if (q >= 1 && q <= 4) return n >= 1 && n <= 8;
  if (q >= 5 && q <= 8) return n >= 1 && n <= 5;
  return false;
}

/** El número FDI que venga del cliente, o null. Acepta el string porque un
 *  `<input>` y un JSON mandan cosas distintas y rechazar uno de los dos
 *  obligaría a cada quien a convertir por su cuenta. */
export function parseEduFdi(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  return eduIsValidFdi(n) ? n : null;
}

/** Todos los dientes válidos, para las pruebas y para un recorrido
 *  exhaustivo. 32 permanentes + 20 temporales = 52. */
export function eduAllFdi(): number[] {
  const out: number[] = [];
  for (const q of [1, 2, 3, 4]) for (let n = 1; n <= 8; n++) out.push(q * 10 + n);
  for (const q of [5, 6, 7, 8]) for (let n = 1; n <= 5; n++) out.push(q * 10 + n);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LA CARA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las cinco caras, más la distinción oclusal/incisal.
 *
 * 🔴 LA CADENA VACÍA SIGNIFICA "EL DIENTE ENTERO", y no es un atajo: la
 * columna `surface` de `edu_odontogram_entries` es NOT NULL justamente
 * para eso. Postgres considera DISTINTOS dos NULL dentro de un índice
 * único, así que con `surface` nullable el mismo hallazgo de diente
 * completo se podría insertar mil veces y el índice no diría nada — y el
 * upsert que lo evita no tendría índice completo al que agarrarse.
 */
export const EDU_TOOTH_WHOLE = "" as const;

export const EDU_SURFACES = ["O", "I", "M", "D", "V", "L"] as const;
export type EduSurface = (typeof EDU_SURFACES)[number];

export const EDU_SURFACE_LABELS: Record<EduSurface, string> = {
  O: "Oclusal",
  I: "Incisal",
  M: "Mesial",
  D: "Distal",
  V: "Vestibular",
  L: "Lingual / palatina",
};

/**
 * La cara que llega del cliente, normalizada. Devuelve "" para el diente
 * entero (null, undefined o "") y null cuando la cara no existe.
 *
 * ⚠️ Devuelve DOS cosas distintas que se parecen: `""` es un valor válido
 * ("el diente entero") y `null` es "esto no es una cara". Confundirlas
 * escribiría en el diente completo un hallazgo que la persona marcó en una
 * cara concreta.
 */
export function parseEduSurface(raw: unknown): string | null {
  if (raw === null || raw === undefined) return EDU_TOOTH_WHOLE;
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (v === "") return EDU_TOOTH_WHOLE;
  return (EDU_SURFACES as readonly string[]).includes(v) ? v : null;
}

/**
 * ¿Esa cara existe en ese diente? Un molar tiene oclusal y no incisal; un
 * incisivo, al revés. `classify` (catálogo compartido) ya lo sabe, así que
 * la respuesta no se vuelve a deducir aquí.
 */
export function eduSurfaceFitsTooth(tooth: number, surface: string): boolean {
  if (surface === EDU_TOOTH_WHOLE) return true;
  if (surface === "M" || surface === "D" || surface === "V" || surface === "L") return true;
  const meta = classify(tooth);
  return surface === meta.center;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL HALLAZGO
// ═══════════════════════════════════════════════════════════════════════

/**
 * La key RESERVADA con la que se guarda la NOTA de un diente.
 *
 * Va en la misma tabla que los hallazgos —una fila con `condition` igual a
 * esto, `surface` vacío y el texto en `notes`— porque la alternativa era
 * una segunda tabla con dos columnas. Está en un espacio de nombres que el
 * catálogo no puede alcanzar (los ids del catálogo son `caries`, `crown`,
 * `rct`… nunca con guiones bajos delante), y el saneo de abajo RECHAZA
 * cualquier id que empiece con "__": sin eso, un cliente podría mandar
 * `condition: "__nota__"` como si fuera un hallazgo y borrar la nota de un
 * diente desde el pincel.
 */
export const EDU_ODONTOGRAM_NOTE_KEY = "__nota__";

const RESERVED_PREFIX = "__";

/**
 * El id de hallazgo que llega del cliente, validado CONTRA EL CATÁLOGO.
 *
 * Sin esta comprobación el odontograma acepta texto libre: alguien manda
 * `condition: "lo que sea"`, la fila se guarda, y al pintar no hay glifo
 * que dibujar — un hallazgo invisible que sí ocupa una fila y sí sale en
 * los conteos.
 */
export function parseEduCondition(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > 40) return null;
  if (v.startsWith(RESERVED_PREFIX)) return null;
  return v in COND_BY_ID ? v : null;
}

/** ¿Ese hallazgo se marca en una cara o en el diente entero? */
export function eduConditionTarget(condition: string): "surface" | "tooth" | null {
  const c = COND_BY_ID[condition];
  return c ? c.target : null;
}

/** Nombre en español del hallazgo, para los mensajes de error y el resumen. */
export function eduConditionLabel(condition: string): string {
  if (condition === EDU_ODONTOGRAM_NOTE_KEY) return "Nota del diente";
  return COND_BY_ID[condition]?.es ?? condition;
}

/**
 * La combinación completa (diente + cara + hallazgo), saneada.
 *
 * Se valida JUNTA y no campo por campo porque las tres se condicionan: un
 * sellante solo va en oclusal, una corona va en el diente entero y una
 * cara incisal no existe en un molar. Validarlas por separado deja pasar
 * exactamente esas tres combinaciones imposibles.
 */
export interface EduOdontogramTarget {
  tooth: number;
  surface: string;
  condition: string;
}

/**
 * El resultado del saneo.
 *
 * ⚠️ NO es una unión discriminada (`{ok:true,...} | {ok:false,...}`) a
 * propósito. El `tsconfig.json` de este repo tiene `strict: false`, y sin
 * `strictNullChecks` TypeScript NO estrecha una unión por un discriminante
 * booleano: `if (!parsed.ok)` deja el tipo igual y `parsed.error` no
 * compila. Escribirlo como un objeto con los dos campos —`value` cuando
 * salió bien, `error` cuando no— compila igual en los dos modos y se lee
 * igual de claro.
 */
export interface EduOdontogramParse {
  ok: boolean;
  /** Solo tiene valor cuando `ok` es true. */
  value: EduOdontogramTarget | null;
  /** Solo tiene texto cuando `ok` es false. */
  error: string;
}

function mal(error: string): EduOdontogramParse {
  return { ok: false, value: null, error };
}

function bien(value: EduOdontogramTarget): EduOdontogramParse {
  return { ok: true, value, error: "" };
}

export function parseEduOdontogramTarget(input: {
  tooth?: unknown;
  surface?: unknown;
  condition?: unknown;
}): EduOdontogramParse {
  const tooth = parseEduFdi(input.tooth);
  if (tooth === null) return mal("Ese número de diente no existe en la nomenclatura FDI.");

  const condition = parseEduCondition(input.condition);
  if (condition === null) return mal("Ese hallazgo no está en el catálogo del odontograma.");

  const surface = parseEduSurface(input.surface);
  if (surface === null) return mal("Esa cara no existe. Son O/I (centro), M, D, V y L.");

  const target = eduConditionTarget(condition);
  // Un hallazgo de DIENTE se guarda siempre en el diente entero, aunque la
  // pantalla haya mandado una cara: si se respetara la cara, la misma
  // corona podría entrar cinco veces, una por superficie.
  if (target === "tooth") return bien({ tooth, surface: EDU_TOOTH_WHOLE, condition });

  // Un hallazgo de CARA sin cara no se puede guardar: "caries" en el diente
  // entero no dice dónde, y el odontograma existe justamente para decirlo.
  if (surface === EDU_TOOTH_WHOLE) {
    return mal(
      `"${eduConditionLabel(condition)}" se marca sobre una cara del diente, no sobre el diente entero.`,
    );
  }

  if (!eduSurfaceFitsTooth(tooth, surface)) {
    return mal(
      `El diente ${tooth} no tiene cara ${surface}. Los posteriores tienen oclusal (O) y los anteriores incisal (I).`,
    );
  }

  const cond = COND_BY_ID[condition];
  if (cond.surfacesOnly && !cond.surfacesOnly.includes(surface)) {
    return mal(`"${cond.es}" solo se marca en ${cond.surfacesOnly.join(", ")}.`);
  }

  return bien({ tooth, surface, condition });
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · FILAS ⇄ LA FORMA QUE PINTA EL DIBUJO
//
// El componente del odontograma (importado del dental, ver arriba) consume
// un mapa `Records`: { [fdi]: { surfaces: { cara: [ids] }, tooth: [ids],
// note } }. La base guarda filas planas. La conversión vive AQUÍ y no en el
// componente para que el servidor pueda mandarla ya armada — y para que la
// prueba la verifique sin montar React.
// ═══════════════════════════════════════════════════════════════════════

export interface EduOdontogramEntryRow {
  id: string;
  tooth: number;
  surface: string;
  condition: string;
  notes: string | null;
  recordedById: string;
  recordedByName: string;
  recordedAt: string;
  recordedLabel: string;
}

export function eduEntriesToRecords(entries: EduOdontogramEntryRow[]): Records {
  const records: Records = {};
  for (const e of entries) {
    if (!eduIsValidFdi(e.tooth)) continue;
    if (!records[e.tooth]) records[e.tooth] = { surfaces: {}, tooth: [] };
    const rec: ToothRecord = records[e.tooth];

    if (e.condition === EDU_ODONTOGRAM_NOTE_KEY) {
      rec.note = e.notes ?? "";
      continue;
    }
    if (e.surface !== EDU_TOOTH_WHOLE) {
      if (!rec.surfaces[e.surface]) rec.surfaces[e.surface] = [];
      if (!rec.surfaces[e.surface].includes(e.condition)) rec.surfaces[e.surface].push(e.condition);
    } else if (!rec.tooth.includes(e.condition)) {
      rec.tooth.push(e.condition);
    }
  }
  return records;
}

export interface EduOdontogramSummary {
  teeth: number;
  findings: number;
  notes: number;
}

/** Cuántos dientes y cuántos hallazgos hay marcados, contando FILAS. Lo usa
 *  el servidor y las pruebas.
 *
 *  ⚠️ Las notas por diente NO cuentan como hallazgo, que es lo que a
 *  cualquiera se le olvida al contar filas de la tabla: la nota vive en la
 *  misma tabla con una key reservada. */
export function eduOdontogramSummary(entries: EduOdontogramEntryRow[]): EduOdontogramSummary {
  const teeth = new Set<number>();
  let findings = 0;
  let notes = 0;
  for (const e of entries) {
    teeth.add(e.tooth);
    if (e.condition === EDU_ODONTOGRAM_NOTE_KEY) notes += 1;
    else findings += 1;
  }
  return { teeth: teeth.size, findings, notes };
}

/**
 * El mismo resumen, pero contando sobre el MAPA que pinta el dibujo.
 *
 * Existe porque la pantalla marca de forma OPTIMISTA: el clic se pinta antes
 * de que el servidor conteste y no se recarga la página por cada hallazgo
 * (sería insoportable de usar). Si el contador se calculara con las filas
 * que llegaron del servidor, diría "2 hallazgos" mientras el dibujo enseña
 * tres — y de las dos cifras la que la persona cree es la que ve dibujada.
 *
 * ⚠️ Un diente que quedó SIN nada (se marcó y se desmarcó) sigue existiendo
 * como clave del mapa con listas vacías, y no cuenta como diente marcado.
 */
export function eduRecordsSummary(records: Records): EduOdontogramSummary {
  let teeth = 0;
  let findings = 0;
  let notes = 0;
  for (const rec of Object.values(records ?? {})) {
    if (!rec) continue;
    let delDiente = (rec.tooth ?? []).length;
    for (const ids of Object.values(rec.surfaces ?? {})) delDiente += (ids ?? []).length;
    const tieneNota = Boolean(rec.note && rec.note.trim());
    if (delDiente === 0 && !tieneNota) continue;
    teeth += 1;
    findings += delDiente;
    if (tieneNota) notes += 1;
  }
  return { teeth, findings, notes };
}
