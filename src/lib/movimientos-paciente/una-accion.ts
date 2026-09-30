import { AsyncLocalStorage } from "node:async_hooks";
import type { FilaBitacora } from "./fila";
import { redactarMovimiento } from "./catalogo";

/**
 * UNA fila en «Movimientos» por cada ACCIÓN del usuario (ws1-t12, revisión final).
 *
 * Abrir un caso de ortodoncia escribe varias filas de bitácora (el diagnóstico, el plan, su detalle); subir una foto,
 * otras tres. Cada una es correcta como rastro (NOM-024) pero, en la pantalla de Movimientos, son tres renglones para
 * un solo gesto. Aquí se juntan SIN perder nada:
 *
 *   await conUnSoloMovimiento({ titulo: "Abrió el caso de ortodoncia" }, async () => { …escrituras… });
 *
 * · Dentro del alcance, cada fila con paciente se RETIENE (no se escribe al momento).
 * · Al terminar (aunque la acción falle a medias): si hubo UNA sola fila, se escribe tal cual. Si hubo varias, se
 *   escriben TODAS —con `_mov.after.soloBitacora: true`, que Movimientos no lista pero la bitácora conserva con su
 *   diff completo— y ADEMÁS una fila-resumen visible con la frase de cada una (`_mov.after.detalle`).
 * · Filas sin paciente no se tocan: se escriben al momento.
 *
 * Para una acción que el navegador reparte en varias llamadas (abrir caso = diagnóstico → plan), la que va ANTES corre
 * en `conMovimientosSoloDeBitacora` (todas sus filas quedan solo en la bitácora) y la última las nombra en
 * `detallesExtra` de su propio resumen.
 */

interface Alcance {
  filas: FilaBitacora[];
}

const almacen = new AsyncLocalStorage<Alcance>();

/** ¿Hay un alcance abierto? Lo pregunta `insertarFilaBitacora`: si sí, la fila se retiene y no se escribe. */
export function retenerSiHayAlcance(fila: FilaBitacora): boolean {
  const alcance = almacen.getStore();
  if (!alcance || !fila.patientId || !fila.userId) return false;
  alcance.filas.push(fila);
  return true;
}

/** La misma fila con la marca «solo bitácora» dentro de `_mov.after`. */
export function conMarcaSoloBitacora(fila: FilaBitacora): FilaBitacora {
  const cambios = fila.changes ?? {};
  const mov = (cambios._mov ?? {}) as { before?: unknown; after?: Record<string, unknown> };
  return {
    ...fila,
    changes: { ...cambios, _mov: { before: mov.before ?? null, after: { ...(mov.after ?? {}), soloBitacora: true } } },
  };
}

/** La frase de cada fila retenida, sin repetir y sin la del propio título. */
export function frasesDeLasFilas(filas: readonly FilaBitacora[]): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const f of filas) {
    const t = redactarMovimiento({ entityType: f.entityType, action: f.action, changes: f.changes }).trim();
    if (!t || vistas.has(t)) continue;
    vistas.add(t);
    out.push(t);
  }
  return out;
}

/** «Título: frase uno · frase dos». Sin título, las frases van tal cual, separadas por « · ». */
export function redactarResumen(titulo: string | undefined, frases: readonly string[]): string {
  const propias = frases.filter((f) => f && f !== titulo);
  if (!titulo) return propias.join(" · ");
  return propias.length === 0 ? titulo : `${titulo}: ${propias.join(" · ")}`;
}

function camposDe(f: FilaBitacora): string[] {
  const mov = (f.changes?._mov ?? {}) as { after?: { campos?: unknown } };
  return Array.isArray(mov.after?.campos) ? (mov.after!.campos as unknown[]).filter((c): c is string => typeof c === "string") : [];
}

/** La fila-resumen que junta a las retenidas (visible en Movimientos). */
export function armarResumen(
  filas: readonly FilaBitacora[],
  opts: { titulo?: string; detallesExtra?: readonly string[]; entidad?: { entityType: string; entityId: string; action: string }; soloLoExtra?: boolean },
): FilaBitacora {
  const primera = filas[0]!;
  const frases = [...(opts.detallesExtra ?? []), ...(opts.soloLoExtra ? [] : frasesDeLasFilas(filas))];
  const texto = redactarResumen(opts.titulo, frases);
  const campos = [...new Set(filas.flatMap(camposDe))];
  const mov0 = ((primera.changes?._mov ?? {}) as { after?: { categoria?: unknown } }).after;
  const categoria = typeof mov0?.categoria === "string" ? mov0.categoria : undefined;
  return {
    clinicId: primera.clinicId,
    userId: primera.userId,
    entityType: opts.entidad?.entityType ?? primera.entityType,
    entityId: opts.entidad?.entityId ?? primera.entityId,
    action: opts.entidad?.action ?? primera.action,
    changes: {
      _mov: {
        before: null,
        after: {
          texto,
          ...(categoria ? { categoria } : {}),
          ...(campos.length > 0 ? { campos } : {}),
          detalle: frases,
          esResumen: true,
        },
      },
    },
    ipAddress: primera.ipAddress ?? null,
    userAgent: primera.userAgent ?? null,
    actorType: primera.actorType ?? null,
    actorAdminId: primera.actorAdminId ?? null,
    patientId: primera.patientId,
  };
}

async function correrEnAlcance<T>(fn: () => Promise<T>): Promise<{ filas: FilaBitacora[]; valor?: T; error?: unknown; fallo: boolean }> {
  const alcance: Alcance = { filas: [] };
  try {
    const valor = await almacen.run(alcance, fn);
    return { filas: alcance.filas, valor, fallo: false };
  } catch (error) {
    return { filas: alcance.filas, error, fallo: true };
  }
}

type Escritor = (fila: FilaBitacora) => Promise<void>;

/** El escritor real; se resuelve tarde para no crear un ciclo de imports con fila.ts. */
async function escritorReal(): Promise<Escritor> {
  const { insertarFilaBitacora } = await import("./fila");
  return insertarFilaBitacora;
}

/** Escribe sin que nada falle hacia la acción principal: una fila que no se pudo escribir se anota y se sigue. */
async function escribir(escritor: Escritor, fila: FilaBitacora): Promise<void> {
  try {
    await escritor(fila);
  } catch (e) {
    console.error("[movimientos] no se pudo escribir la fila de la acción:", e);
  }
}

export interface OpcionesDeUnaAccion {
  /** «Abrió el caso de ortodoncia». Sin él, las frases de cada fila van juntas. */
  titulo?: string;
  /** Cosas que ya pasaron en OTRAS llamadas de la misma acción (p. ej. «Registró el diagnóstico de ortodoncia»). */
  detallesExtra?: readonly string[];
  /** Entidad de la fila-resumen; por defecto la de la primera fila retenida. */
  entidad?: { entityType: string; entityId: string; action: string };
  /**
   * Si la acción no dejó NINGUNA fila propia pero un paso anterior escondió las suyas (`detallesExtra`), de dónde sale
   * la fila-resumen para que el movimiento no se pierda. Se llama al terminar; `null` = no hay de dónde.
   */
  filaBase?: () => Pick<FilaBitacora, "clinicId" | "userId" | "patientId" | "entityType" | "entityId" | "action"> | null;
  /** Solo para pruebas: dónde se escribe. */
  escritor?: Escritor;
}

/** Corre `fn`; sus filas con paciente salen en Movimientos como UNA. Devuelve lo que devuelva `fn` (o relanza su error). */
export async function conUnSoloMovimiento<T>(opts: OpcionesDeUnaAccion, fn: () => Promise<T>): Promise<T> {
  const r = await correrEnAlcance(fn);
  const escritor = opts.escritor ?? (await escritorReal());
  if (r.filas.length === 0 && opts.detallesExtra?.length) {
    const base = opts.filaBase?.();
    if (base) await escribir(escritor, armarResumen([{ ...base, changes: null }], { ...opts, soloLoExtra: true }));
  } else if (r.filas.length === 1 && !opts.detallesExtra?.length) {
    await escribir(escritor, r.filas[0]!);
  } else if (r.filas.length > 0) {
    for (const f of r.filas) await escribir(escritor, conMarcaSoloBitacora(f));
    await escribir(escritor, armarResumen(r.filas, opts));
  }
  if (r.fallo) throw r.error;
  return r.valor as T;
}

/**
 * Como `conUnSoloMovimiento`, pero SIN fila-resumen: todas las filas quedan solo en la bitácora. Para el paso de una
 * acción cuyo resumen escribe otra llamada (abrir caso: el diagnóstico va antes que el plan).
 */
export async function conMovimientosSoloDeBitacora<T>(fn: () => Promise<T>, escritorDePrueba?: Escritor): Promise<T> {
  const r = await correrEnAlcance(fn);
  const escritor = escritorDePrueba ?? (await escritorReal());
  for (const f of r.filas) await escribir(escritor, conMarcaSoloBitacora(f));
  if (r.fallo) throw r.error;
  return r.valor as T;
}

/** ¿La llamada dice que es un paso de una acción más grande (cuyo resumen escribe otra llamada)? Solo `true` cuenta. */
export function esPasoDeOtraAccion(input: unknown): boolean {
  return Boolean(input && typeof input === "object" && (input as { parteDeUnaAccion?: unknown }).parteDeUnaAccion === true);
}
