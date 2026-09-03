/**
 * DaleControl INSTITUCIONAL — EL PLANO DE LA CLÍNICA, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only", sin `new Date()`
 * escondido). Aquí viven las tres cosas de esta ola que, escritas dos veces,
 * terminarían discrepando: **cómo se arma el plano automático**, **qué se
 * acepta al guardar** y **qué se le pasa al mundo 3D**.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DECISIÓN 1 · EL FORMATO ES EL DEL DENTAL, Y NO SE TRADUCE
 *
 * El plano se guarda como `LayoutElement[]` + `LayoutMetadata`
 * (src/lib/floor-plan/element-types.ts), byte a byte la misma forma que
 * `ClinicLayout` del dental. No es comodidad: el editor isométrico dibuja
 * con `toScreen` y el catálogo `DENTAL_ELEMENT_TYPES`, y el mundo 3D
 * (`Clinic3DClient`) recibe esos elementos y los convierte en paredes,
 * muebles y anclas de sillón. Guardar "lo nuestro" obligaría a traducir de
 * ida y de vuelta en cada lectura, y una traducción es un sitio donde
 * perder una rotación.
 *
 * Lo ÚNICO que cambia de significado es `LayoutElement.resourceId`: en el
 * dental apunta a un `Resource(kind=CHAIR)` y aquí a un `EduChair.id`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DECISIÓN 2 · SIN FILA GUARDADA, EL PLANO SE ARMA SOLO
 *
 * Una sede que nunca pasó por el editor NO se pinta vacía: `eduPlanoAuto`
 * arma una sala con sus sillones activos en rejilla. La pantalla sirve
 * desde el primer día y la dirección la acomoda después, en vez de
 * enseñarle a una escuela un "diseña tu clínica primero" el día que la
 * abre. El automático NO se guarda: se calcula en cada lectura, así que un
 * sillón nuevo aparece solo mientras nadie haya acomodado nada.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DECISIÓN 2-BIS · Y CON FILA GUARDADA, EL SILLÓN NUEVO TAMBIÉN ENTRA
 *
 * Lo anterior dejaba un agujero que duró hasta que alguien dio de alta un
 * sillón: en cuanto la dirección guardaba SU plano, el automático dejaba de
 * usarse y las unidades creadas después no entraban a ningún sitio. No
 * salían en el editor, no se pintaban en vivo, y la única pista era un
 * aviso de "hay un sillón que no está en el plano" que nadie tiene por qué
 * saber resolver.
 *
 * Ahora la LECTURA reconcilia (`eduPlanoReconciliar`): todo sillón activo
 * sin elemento se agrega solo, A CONTINUACIÓN DEL ÚLTIMO y en la misma
 * rejilla del automático, ligado a su `EduChair` desde el primer momento.
 * Se PERSISTE en la misma fila —si no, el sillón cambiaría de sitio entre
 * dos lecturas según qué celdas estuvieran libres— y se queda marcado como
 * PENDIENTE (`metadata.pendientes`) hasta que la dirección lo ponga donde
 * va de verdad. Un sillón dado de baja no se toca: su elemento se queda
 * colgando, que es lo que ya hacía `eduPlanoRevision`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DECISIÓN 3 · LA LIGA SILLÓN↔EduChair LA CUIDA EL CÓDIGO
 *
 * El vínculo vive DENTRO de un JSON, así que no hay llave foránea que lo
 * cuide (ver sql/edu-clinica-plano.sql). Lo cuidan dos funciones y nadie
 * más:
 *   · `eduPlanoValidar` (ESCRITURA) — rechaza un sillón que no sea de ESTA
 *     sede y rechaza dos elementos ligados al mismo sillón;
 *   · `eduPlanoRevision` (LECTURA) — marca el que se quedó colgando (un
 *     sillón dado de baja después de dibujarlo) y el que nunca se ligó.
 *
 * Por qué importa que la sede se compruebe: el número del sillón es único
 * dentro de la SEDE y no del instituto (Ola 11). Sin la comprobación, el
 * "Sillón 1" del campus norte se puede ligar al "Sillón 1" del sur y el
 * plano del norte pintaría en vivo al paciente que está sentado a
 * trescientos kilómetros.
 */

import type { LayoutElement, LayoutMetadata, Rotation } from "@/lib/floor-plan/element-types";
import { sanitizeElements } from "@/lib/floor-plan/sanitize";
import { isChairType } from "@/components/clinic-3d/world-types";
import type { Chair3DState } from "@/components/clinic-3d/world-types";
import { eduProgramColor } from "@/lib/edu/agenda-rejilla";
import type { EduVivaCard } from "@/lib/edu/clinica-viva-core";

// ═══════════════════════════════════════════════════════════════════════
// 1 · LOS TOPES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cuántos elementos caben en un plano. Con 200 sillones (el tope de la
 * agenda) y su mobiliario alrededor, 1 200 es holgado; el tope existe para
 * que un POST fabricado no meta un JSON de veinte megas en una columna que
 * se lee en cada carga de la pantalla.
 */
export const EDU_PLANO_MAX_ELEMENTOS = 1_200;

/**
 * El tamaño máximo de la rejilla. Es el MISMO tope que aplica el parser del
 * mundo 3D (`parseLayoutToWorld` recorta a 200×200): pedir más no dibuja
 * más, solo deja elementos fuera del mundo sin decirlo.
 */
export const EDU_PLANO_GRID_MAX = 200;

/** La rejilla de un plano recién nacido, si la sede no tiene sillones. */
export const EDU_PLANO_GRID_MIN = 12;

/** Cuántos sillones pone por fila el plano automático. */
export const EDU_PLANO_AUTO_POR_FILA = 6;

/** Separación entre sillones en el automático (el sillón mide 2×3). */
export const EDU_PLANO_AUTO_PASO_COL = 4;
export const EDU_PLANO_AUTO_PASO_ROW = 5;

/** Margen entre la pared y el primer sillón. */
export const EDU_PLANO_AUTO_MARGEN = 3;

/** El tipo del catálogo que ES un sillón (el resto es mobiliario). */
export const EDU_PLANO_TIPO_SILLON = "sillon";

/**
 * Lo que MIDE un sillón en la rejilla (`sillon` del catálogo del dental:
 * w:2, h:3). Está copiado a mano y no importado a propósito: el catálogo
 * son mil renglones de cadenas SVG y este módulo lo lee también el
 * SERVIDOR en cada carga de la pantalla. Si alguna vez cambia allá, lo
 * único que pasa aquí es que la celda que se busca libre sobra o falta una
 * fila — nunca que un sillón se pierda.
 */
export const EDU_PLANO_SILLON_W = 2;
export const EDU_PLANO_SILLON_H = 3;

/**
 * Cuánto espera el editor, sin que pase nada más, antes de guardar solo.
 *
 * Novecientos milisegundos: lo bastante para que arrastrar tres sillones
 * seguidos sea UN guardado y no tres, y lo bastante poco para que soltar un
 * sillón y cambiar de pestaña llegue a tiempo. El botón "Guardar" sigue
 * ahí para forzarlo sin esperar.
 */
export const EDU_PLANO_AUTOSAVE_MS = 900;

/**
 * La llave donde el plano recuerda qué sillones nadie ha acomodado.
 *
 * Vive dentro de `metadata` —el JSON que ya se guarda— y NO en una columna
 * nueva: es una marca de trabajo pendiente, no un dato del piso. El saneo
 * del dental (`sanitizeMetadata`) no la conoce y la tiraría, así que se
 * lee y se vuelve a poner aquí (`eduPlanoPendientes` / `eduPlanoMetadata`).
 */
export const EDU_PLANO_META_PENDIENTES = "pendientes";

// ═══════════════════════════════════════════════════════════════════════
// 2 · LO QUE ENTRA Y LO QUE SALE
// ═══════════════════════════════════════════════════════════════════════

/** Un sillón de la sede, tal como lo necesita el plano. */
export interface EduPlanoChair {
  id: string;
  name: string;
  number: number;
}

/**
 * La metadata del plano, con lo del dental y la marca de esta ola.
 *
 * `LayoutMetadata` es del dental y no se toca; `pendientes` es nuestro y
 * viaja en el MISMO objeto porque es lo que ya se guarda y lo que ya se
 * manda al guardar. Un plano viejo simplemente no lo trae.
 */
export interface EduPlanoMetadata extends LayoutMetadata {
  /** Ids de `EduChair` que el código puso solo y nadie ha acomodado. */
  pendientes?: string[];
}

/** El plano de una sede, ya resuelto (guardado o automático). */
export interface EduPlanoLayout {
  elements: LayoutElement[];
  metadata: EduPlanoMetadata;
  /**
   * true = nadie lo ha acomodado todavía y esto es la rejilla automática.
   * La pantalla lo DICE: un plano que parece dibujado a mano y no lo está
   * hace que la dirección crea que ya lo acomodó alguien.
   */
  auto: boolean;
  /** Cuándo se guardó (ISO), o null si es el automático. */
  savedAtISO: string | null;
  /** Quién lo guardó, o null. */
  savedBy: string | null;
  /**
   * Los sillones que el código puso solo y que la dirección todavía no ha
   * acomodado. El editor los marca en el lienzo y la vista en vivo lo dice:
   * están dibujados y se pintan, pero NO donde están de verdad.
   */
  pendientes: string[];
}

/** Lo que el plano dice de la liga sillón↔unidad. */
export interface EduPlanoRevision {
  /** Elementos de tipo sillón SIN ligar a ninguna unidad. */
  sinLigar: number[];
  /** Elementos ligados a un sillón que ya no existe (o se dio de baja). */
  colgantes: { elementId: number; resourceId: string }[];
  /** Sillones activos de la sede que NO están dibujados en el plano. */
  sinDibujar: EduPlanoChair[];
  /** Cuántos elementos de sillón están bien ligados. */
  ligados: number;
}

/**
 * El veredicto de una escritura.
 *
 * ⚠️ Es UN objeto con tres campos y no una unión discriminada
 * (`{ok:true,…} | {ok:false,…}`), que sería lo natural: el tsconfig del
 * repo va con `strict: false` y ahí el estrechamiento por discriminante NO
 * funciona — `if (!v.ok) v.error` se pone rojo porque TypeScript sigue
 * viendo también la rama buena. Ver la nota del repo sobre strict:false y
 * el narrowing.
 */
export interface EduPlanoValidacion {
  ok: boolean;
  /** Los elementos ya saneados. Vacío cuando `ok` es false. */
  elements: LayoutElement[];
  /** El motivo, escrito para una persona. `null` cuando `ok` es true. */
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL PLANO AUTOMÁTICO
// ═══════════════════════════════════════════════════════════════════════

/** Redondea hacia arriba sin caer en 0 (una fila de cero sillones no existe). */
function filasPara(n: number, porFila: number): number {
  return Math.max(1, Math.ceil(n / Math.max(1, porFila)));
}

/**
 * Una sala con los sillones de la sede en rejilla.
 *
 * No pretende parecerse al edificio real —no lo sabemos— sino ser un punto
 * de partida honesto: paredes que encierran el piso (el mundo 3D necesita
 * un contorno para tener suelo, techo y límites por donde caminar), una
 * puerta por donde se entra, el mostrador de recepción al lado y las
 * unidades numeradas como están numeradas en la pared.
 *
 * ⚠️ El orden de `chairs` MANDA: es el que la escuela le dio a sus unidades
 * (orderIndex y luego número), así que el "Sillón 1" queda arriba a la
 * izquierda y el último abajo a la derecha. Reordenarlos aquí rompería la
 * correspondencia con la lista de la agenda.
 */
export function eduPlanoAuto(chairs: EduPlanoChair[]): EduPlanoLayout {
  const lista = Array.isArray(chairs) ? chairs : [];
  const porFila = Math.min(EDU_PLANO_AUTO_POR_FILA, Math.max(1, lista.length));
  const filas = filasPara(lista.length, porFila);

  // La sala: margen + rejilla + margen. El +2 de las columnas deja sitio al
  // ancho del sillón (2) sin pegarlo a la pared derecha.
  const cols = Math.min(
    EDU_PLANO_GRID_MAX,
    Math.max(EDU_PLANO_GRID_MIN, EDU_PLANO_AUTO_MARGEN * 2 + porFila * EDU_PLANO_AUTO_PASO_COL + 2),
  );
  const rows = Math.min(
    EDU_PLANO_GRID_MAX,
    Math.max(EDU_PLANO_GRID_MIN, EDU_PLANO_AUTO_MARGEN * 2 + filas * EDU_PLANO_AUTO_PASO_ROW + 2),
  );

  const elements: LayoutElement[] = [];
  let id = 1;
  const push = (
    type: string,
    col: number,
    row: number,
    extra?: { rotation?: Rotation; resourceId?: string | null; name?: string | null },
  ) => {
    elements.push({
      id: id++,
      type,
      col,
      row,
      rotation: extra?.rotation ?? 0,
      resourceId: extra?.resourceId ?? null,
      name: extra?.name ?? null,
    });
  };

  // ── Las paredes ────────────────────────────────────────────────────
  // "wall_h" mide 4×1 y "wall_v" 1×4, así que los tramos van de cuatro en
  // cuatro. La PUERTA sustituye un tramo de la pared de arriba, cerca del
  // centro: el mundo 3D aparece en la puerta si la encuentra, y sin ella
  // el jugador nace en la primera celda libre, que suele ser una esquina.
  const puertaCol = Math.max(4, Math.floor(cols / 2 / 4) * 4);
  for (let c = 0; c < cols; c += 4) {
    if (c === puertaCol) {
      push("puerta", c, 0);
      continue;
    }
    push("wall_h", c, 0);
  }
  for (let c = 0; c < cols; c += 4) push("wall_h", c, rows - 1);
  for (let r = 0; r < rows; r += 4) {
    push("wall_v", 0, r);
    push("wall_v", cols - 1, r);
  }

  // ── La recepción, al lado de la puerta ─────────────────────────────
  push("mostrador", Math.max(1, puertaCol - 5), 1);
  push("planta", Math.min(cols - 2, puertaCol + 3), 1);

  // ── Los sillones ───────────────────────────────────────────────────
  lista.forEach((chair, i) => {
    const fila = Math.floor(i / porFila);
    const columna = i % porFila;
    const col = EDU_PLANO_AUTO_MARGEN + columna * EDU_PLANO_AUTO_PASO_COL;
    const row = EDU_PLANO_AUTO_MARGEN + fila * EDU_PLANO_AUTO_PASO_ROW;
    push(EDU_PLANO_TIPO_SILLON, col, row, { resourceId: chair.id, name: chair.name });
    // El taburete del operador al costado: da escala al sillón en el mundo
    // 3D y es lo que hace que una rejilla de cajas parezca una clínica.
    push("taburete", col + 2, row + 1);
  });

  return {
    elements,
    metadata: { gridSize: { cols, rows } },
    auto: true,
    savedAtISO: null,
    savedBy: null,
    // El automático dibuja TODOS los sillones de la sede, así que nunca
    // deja ninguno pendiente: lo que hay que acomodar es el plano entero, y
    // eso ya lo dice `auto`.
    pendientes: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA REVISIÓN DE LAS LIGAS (lectura)
// ═══════════════════════════════════════════════════════════════════════

/** ¿Este elemento es un sillón? Lo contesta el catálogo REAL, no una lista. */
export function eduPlanoEsSillon(type: string): boolean {
  return isChairType(type);
}

/**
 * Qué le pasa a las ligas de este plano.
 *
 * Se usa en los dos sitios y por la misma razón: el editor pinta en rojo lo
 * que hay que arreglar, y la vista en vivo avisa de que un sillón activo no
 * está en el plano —porque ése NO se va a pintar en el mundo 3D, y un
 * sillón que falta se lee como "está libre" cuando puede estar ocupado.
 */
export function eduPlanoRevision(
  elements: LayoutElement[],
  chairs: EduPlanoChair[],
): EduPlanoRevision {
  const porId = new Map<string, EduPlanoChair>();
  for (const c of chairs) porId.set(c.id, c);

  const sinLigar: number[] = [];
  const colgantes: { elementId: number; resourceId: string }[] = [];
  const dibujados = new Set<string>();
  let ligados = 0;

  for (const el of elements) {
    if (!eduPlanoEsSillon(el.type)) continue;
    const rid = el.resourceId ?? null;
    if (!rid) {
      sinLigar.push(el.id);
      continue;
    }
    if (!porId.has(rid)) {
      colgantes.push({ elementId: el.id, resourceId: rid });
      continue;
    }
    dibujados.add(rid);
    ligados += 1;
  }

  return {
    sinLigar,
    colgantes,
    sinDibujar: chairs.filter((c) => !dibujados.has(c.id)),
    ligados,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4-BIS · LA RECONCILIACIÓN (el sillón nuevo entra al plano guardado)
// ═══════════════════════════════════════════════════════════════════════

/** Lo que sale de reconciliar un plano guardado con los sillones de hoy. */
export interface EduPlanoReconciliacion {
  /** El plano ya con los sillones que faltaban. */
  elements: LayoutElement[];
  /** La rejilla, que puede haber crecido para que quepan. */
  grid: { cols: number; rows: number };
  /** Los `EduChair.id` que se acaban de agregar EN ESTA lectura. */
  agregados: string[];
  /** Todos los que están dibujados y sin acomodar (los de antes y los nuevos). */
  pendientes: string[];
  /** true = hay algo que persistir; false = la lectura no cambió nada. */
  cambio: boolean;
}

/**
 * EL SILLÓN NUEVO ENTRA AL PLANO GUARDADO, y entra donde se espera.
 *
 * Se llama en cada LECTURA del plano de una sede. Recorre los sillones
 * ACTIVOS en el orden de la escuela (`orderIndex`, luego `number` — el
 * mismo orden con el que llegan de Sillones y el mismo que usa el plano
 * automático) y por cada uno que no tenga elemento pone uno:
 *
 *  · A CONTINUACIÓN DEL ÚLTIMO. El ancla es el elemento del ÚLTIMO sillón
 *    dibujado en ese orden — no el que quede más abajo en el dibujo. Si la
 *    dirección movió el "Sillón 12" a la esquina de arriba, el "Sillón 13"
 *    aparece a su lado, que es donde alguien lo va a buscar.
 *  · EN LA MISMA REJILLA DEL AUTOMÁTICO: se avanza de
 *    `EDU_PLANO_AUTO_PASO_COL` en columna hasta completar
 *    `EDU_PLANO_AUTO_POR_FILA` y se baja `EDU_PLANO_AUTO_PASO_ROW`.
 *  · EN UNA CELDA LIBRE: se salta cualquier candidata donde ya haya algo
 *    (contando lo que MIDE el sillón, 2×3, y no solo su esquina), para no
 *    dejar dos muebles uno encima del otro.
 *  · LIGADO desde el primer momento a su `EduChair`: un sillón dibujado sin
 *    ligar no se pinta en vivo, y esto existe justamente para que se pinte.
 *
 * ⚠️ Es una función PURA: no sabe guardar. Quien la llama (plano.ts)
 * persiste el resultado cuando `cambio` es true — sin eso, el sillón nuevo
 * cambiaría de celda entre dos lecturas en cuanto alguien moviera un mueble.
 *
 * ⚠️ Un sillón DADO DE BAJA no se toca: su elemento se queda colgante y lo
 * marca `eduPlanoRevision`. Borrarlo aquí tiraría el trabajo de la
 * dirección por reactivar un sillón dos días después.
 */
export function eduPlanoReconciliar(input: {
  elements: LayoutElement[];
  /** Los sillones ACTIVOS de la sede, en el orden de la escuela. */
  chairs: EduPlanoChair[];
  grid: { cols: number; rows: number };
  /** Los que ya venían marcados como sin acomodar. */
  pendientes?: string[];
}): EduPlanoReconciliacion {
  const original = Array.isArray(input.elements) ? input.elements : [];
  const chairs = Array.isArray(input.chairs) ? input.chairs : [];
  const antes = Array.isArray(input.pendientes) ? input.pendientes : [];

  let cols = acotarRejilla(input.grid?.cols);
  let rows = acotarRejilla(input.grid?.rows);

  // Qué sillones YA tienen elemento, y cuál es el de cada uno.
  const porSillon = new Map<string, LayoutElement>();
  for (const el of original) {
    if (!eduPlanoEsSillon(el.type)) continue;
    const rid = el.resourceId ?? null;
    if (rid && !porSillon.has(rid)) porSillon.set(rid, el);
  }

  const faltan = chairs.filter((c) => !porSillon.has(c.id));

  // Los pendientes de antes que SIGUEN teniendo sentido: el sillón sigue
  // activo y sigue dibujado. Uno que se dio de baja deja de ser un pendiente
  // (su elemento pasa a colgante) y uno que alguien borró del plano tampoco.
  const activos = new Set(chairs.map((c) => c.id));
  const pendientes = antes.filter(
    (id) => typeof id === "string" && activos.has(id) && porSillon.has(id),
  );

  if (faltan.length === 0) {
    return {
      elements: original,
      grid: { cols, rows },
      agregados: [],
      pendientes,
      // Si la lista de pendientes se encogió (un sillón dado de baja, uno
      // borrado del plano) hay que persistirlo: si no, la pantalla seguiría
      // marcando en rojo algo que ya no existe en cada lectura.
      cambio: pendientes.length !== antes.length,
    };
  }

  // ── Las celdas ocupadas ────────────────────────────────────────────
  // Solo la ESQUINA de cada elemento: es lo único que se guarda de él y lo
  // mismo que mira el botón "Ponerlo" del editor. Del que se va a poner sí
  // se conoce el tamaño (2×3), así que se comprueban sus seis celdas.
  const ocupadas = new Set<string>();
  for (const el of original) ocupadas.add(`${el.col}:${el.row}`);

  const cabe = (col: number, row: number): boolean => {
    if (col < 0 || row < 0) return false;
    if (col + EDU_PLANO_SILLON_W > cols || row + EDU_PLANO_SILLON_H > rows) return false;
    for (let c = col; c < col + EDU_PLANO_SILLON_W; c++) {
      for (let r = row; r < row + EDU_PLANO_SILLON_H; r++) {
        if (ocupadas.has(`${c}:${r}`)) return false;
      }
    }
    return true;
  };

  // ── El ancla: el último sillón dibujado, en el orden de la escuela ──
  let cursorCol = EDU_PLANO_AUTO_MARGEN - EDU_PLANO_AUTO_PASO_COL;
  let cursorRow = EDU_PLANO_AUTO_MARGEN;
  for (let i = chairs.length - 1; i >= 0; i--) {
    const el = porSillon.get(chairs[i].id);
    if (el) {
      cursorCol = el.col;
      cursorRow = el.row;
      break;
    }
  }

  /** La siguiente celda de la rejilla del automático después de (col,row). */
  const siguiente = (col: number, row: number): { col: number; row: number } => {
    const indice = Math.floor((col - EDU_PLANO_AUTO_MARGEN) / EDU_PLANO_AUTO_PASO_COL);
    const sig = col + EDU_PLANO_AUTO_PASO_COL;
    const cabeEnLaFila =
      indice + 1 < EDU_PLANO_AUTO_POR_FILA && sig + EDU_PLANO_SILLON_W <= cols;
    if (cabeEnLaFila) return { col: sig, row };
    return { col: EDU_PLANO_AUTO_MARGEN, row: row + EDU_PLANO_AUTO_PASO_ROW };
  };

  const elements = original.slice();
  let proximoId = elements.reduce((max, el) => Math.max(max, el.id), 0) + 1;
  const agregados: string[] = [];

  for (const chair of faltan) {
    let col = cursorCol;
    let row = cursorRow;
    let puesto = false;

    // Se avanza por la rejilla; si se acaba el piso, CRECE hacia abajo (el
    // tope lo pone el parser del mundo 3D). Un plano que ya no puede crecer
    // pone el sillón igual, encima de lo que haya: dibujado y torcido se
    // arregla en un arrastre; invisible no se arregla nunca, que es
    // exactamente el fallo que esta función viene a cerrar.
    for (let intento = 0; intento < EDU_PLANO_MAX_ELEMENTOS; intento++) {
      const celda = siguiente(col, row);
      col = celda.col;
      row = celda.row;
      if (row + EDU_PLANO_SILLON_H > rows) {
        const crecida = Math.min(EDU_PLANO_GRID_MAX, row + EDU_PLANO_SILLON_H + 1);
        if (crecida > rows) rows = crecida;
        else break; // ya no cabe más piso: se pone donde toque
      }
      if (cabe(col, row)) {
        puesto = true;
        break;
      }
    }
    if (!puesto) {
      col = Math.min(col, Math.max(0, cols - EDU_PLANO_SILLON_W));
      row = Math.min(row, Math.max(0, rows - EDU_PLANO_SILLON_H));
    }

    elements.push({
      id: proximoId++,
      type: EDU_PLANO_TIPO_SILLON,
      col,
      row,
      rotation: 0,
      // 🔴 LIGADO YA. Es la diferencia entre "aparece en el plano" y
      // "aparece y además se pinta en vivo".
      resourceId: chair.id,
      name: chair.name,
    });
    for (let c = col; c < col + EDU_PLANO_SILLON_W; c++) {
      for (let r = row; r < row + EDU_PLANO_SILLON_H; r++) ocupadas.add(`${c}:${r}`);
    }
    agregados.push(chair.id);
    if (!pendientes.includes(chair.id)) pendientes.push(chair.id);
    cursorCol = col;
    cursorRow = row;
  }

  return { elements, grid: { cols, rows }, agregados, pendientes, cambio: true };
}

/** Acota un lado de la rejilla al rango que sabe dibujar el mundo 3D. */
function acotarRejilla(valor: unknown): number {
  const n = typeof valor === "number" && Number.isFinite(valor) ? Math.round(valor) : 0;
  if (!n) return EDU_PLANO_GRID_MIN;
  return Math.min(EDU_PLANO_GRID_MAX, Math.max(EDU_PLANO_GRID_MIN, n));
}

/**
 * Los pendientes que trae una metadata guardada, saneados.
 *
 * Se lee del JSON CRUDO y no de `sanitizeMetadata`: el saneo es del dental,
 * no conoce esta llave y la tira. Cualquier cosa que no sea una lista de
 * cadenas se lee como "ninguno" — nunca revienta una pantalla por esto.
 */
export function eduPlanoPendientes(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const lista = (raw as Record<string, unknown>)[EDU_PLANO_META_PENDIENTES];
  if (!Array.isArray(lista)) return [];
  const out: string[] = [];
  for (const v of lista) {
    if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
  }
  return out.slice(0, EDU_PLANO_MAX_ELEMENTOS);
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LO QUE SE ACEPTA AL GUARDAR (escritura)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sanea y valida lo que llega del editor.
 *
 * El saneo es el del dental (`sanitizeElements`): descarta entradas
 * malformadas en vez de reventar, que es lo que hace que un plano guardado
 * hace meses siga abriendo. Encima van las TRES reglas que el dental no
 * puede comprobar porque no conoce las sedes:
 *
 *   1. un sillón ligado tiene que ser de ESTA sede (`chairIds`);
 *   2. dos elementos NO pueden ligarse al mismo sillón — el mundo 3D crea
 *      un ancla por `resourceId` y la segunda pisaría a la primera, así que
 *      una de las dos unidades quedaría muda para siempre;
 *   3. el plano no puede pasar de EDU_PLANO_MAX_ELEMENTOS.
 *
 * ⚠️ Un sillón SIN ligar se ACEPTA. Es un mueble a medio colocar, no un
 * error: la dirección dibuja primero la sala y liga después, y rechazarlo
 * obligaría a ligar cada unidad antes de poder guardar nada.
 */
export function eduPlanoValidar(input: {
  elements: unknown;
  chairIds: string[];
}): EduPlanoValidacion {
  const elements = sanitizeElements(input.elements);

  if (elements.length > EDU_PLANO_MAX_ELEMENTOS) {
    return {
      ok: false,
      elements: [],
      error: `El plano trae ${elements.length} elementos y el máximo son ${EDU_PLANO_MAX_ELEMENTOS}. Borra lo que no uses y vuelve a guardar.`,
    };
  }

  const validos = new Set(input.chairIds);
  const usados = new Map<string, number>();

  for (const el of elements) {
    if (!eduPlanoEsSillon(el.type)) continue;
    const rid = el.resourceId ?? null;
    if (!rid) continue; // sin ligar: se acepta y se marca en pantalla

    if (!validos.has(rid)) {
      return {
        ok: false,
        elements: [],
        error:
          "Uno de los sillones del plano está ligado a una unidad que no es de esta sede. Cada plano solo puede usar los sillones de su propia sede — el número está pintado en la pared de ese edificio y se repite en los demás.",
      };
    }

    const antes = usados.get(rid);
    if (antes !== undefined) {
      return {
        ok: false,
        elements: [],
        error:
          "Hay dos sillones del plano ligados a la MISMA unidad. Solo uno de los dos se pintaría en vivo; liga el otro a su unidad o quítale la liga.",
      };
    }
    usados.set(rid, el.id);
  }

  return { ok: true, elements, error: null };
}

/**
 * Normaliza la metadata que llega del editor.
 *
 * `sanitizeMetadata` del dental ya limpia zoom/pan/gridSize; lo único que
 * se añade aquí es el TOPE de la rejilla, porque una rejilla de 5 000
 * columnas no la dibuja nadie y el parser del mundo 3D la recorta en
 * silencio (y entonces la mitad del plano deja de existir sin avisar).
 */
export function eduPlanoMetadata(
  raw: LayoutMetadata | null | undefined,
  /**
   * Los sillones sin acomodar que hay que dejar escritos. Se pasa aparte y
   * no dentro de `raw` porque `raw` viene del saneo del dental, que ya se
   * la comió: quien la conoce es el llamador (ver `eduPlanoPendientes`).
   */
  pendientes?: string[],
): EduPlanoMetadata {
  const out: EduPlanoMetadata = { ...(raw ?? {}) };
  const g = out.gridSize;
  if (g) {
    out.gridSize = {
      cols: Math.min(EDU_PLANO_GRID_MAX, Math.max(EDU_PLANO_GRID_MIN, Math.round(g.cols) || EDU_PLANO_GRID_MIN)),
      rows: Math.min(EDU_PLANO_GRID_MAX, Math.max(EDU_PLANO_GRID_MIN, Math.round(g.rows) || EDU_PLANO_GRID_MIN)),
    };
  }
  if (pendientes && pendientes.length > 0) out.pendientes = pendientes.slice();
  else delete out.pendientes;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LO QUE SE LE PASA AL MUNDO 3D
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las tarjetas del tablero → el estado por sillón que entiende el visor.
 *
 * 🔴 `patientId` NO SE MANDA, y no es un olvido. El mundo 3D es un JSON que
 * viaja al navegador cada veinte segundos; el id del paciente solo hace
 * falta cuando alguien clica una figura, y para eso está la tarjeta que
 * pinta la pantalla con el MISMO payload. Mandarlo dentro del estado del
 * mundo lo repartiría por adelantado para los treinta sillones.
 *
 * El COLOR es el de la ESPECIALIDAD, la misma regla (y la misma función)
 * que la agenda en rejilla: una escuela tiene ciento veinte estudiantes y
 * ciento veinte colores son ruido; especialidades hay entre tres y diez.
 * Un sillón callado —fuera de la supervisión de quien mira— no trae
 * especialidad, así que se queda con el tono neutro del visor.
 */
export function eduPlanoEstado3D(cards: EduVivaCard[]): Chair3DState[] {
  return cards.map((c) => ({
    // `elementId` va SIEMPRE null y no es un descuido: ninguna pieza del
    // visor lo lee (se busca en clinic-3d/ y solo aparece donde se
    // ESCRIBE). Rellenarlo obligaría a leer el plano en cada sondeo —cada
    // veinte segundos, para nada—; el plano lo carga la página UNA vez.
    elementId: null,
    resourceId: c.chairId,
    name: c.chairName,
    color: c.specialtyId ? eduProgramColor(c.specialtyId, c.specialty ?? "").color : null,
    status: c.state,
    // El nombre del paciente y el del estudiante son los que flotan sobre
    // el sillón. Van YA enmascarados por el tablero: aquí no se decide nada
    // de visibilidad, solo se cambia de forma.
    patientName: c.state === "ocupado" ? c.patient : null,
    doctorName: c.state === "ocupado" ? c.student : null,
    appointmentStartsAt: c.state === "ocupado" ? c.startISO : null,
    // 🔴 El INSTANTE de fin, no la etiqueta: la placa flotante escribe
    // "termina 11:30" con el reloj de quien mira, y `endLabel` ya viene
    // escrito en la hora de pared de SU sede. Pasarle la etiqueta le daría
    // una fecha inválida y el visor omitiría la línea.
    appointmentEndsAt: c.state === "ocupado" ? c.endISO : null,
  }));
}
