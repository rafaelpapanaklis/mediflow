// Ortodoncia — lo nuevo de la hoja de control (ws1-t9, auditoría BEVADENT, M1-M3). PURO: lo usan el cajón, las
// acciones de guardar/firmar y las pruebas.
//
//   M1 · Arco nuevo por arcada: la hoja tiene dos selectores, «Superior» e «Inferior». Se guardan en las dos columnas
//        de la hoja: `wireToId` (el superior, o el inferior si arriba no cambia) y `wireToLowerId` (el inferior cuando
//        es OTRO arco; sql/ws1-t9-…). Así, quien solo lee `wireToId` sigue viendo un arco nuevo verdadero.
//   M2 · Ligas: tipo, color (no en autoligado), arcada y «se cambiaron hoy». Una fila por arcada o una para las dos.
//   M3 · Mecánicas auxiliares del caso (resorte, cadeneta, botón, gancho, tope, elástico intermaxilar, expansor…):
//        tipo, arcada, diente o zona, fecha de colocación y de retiro. Viven en el CASO; la hoja las da de alta o las
//        retira y la siguiente hoja las ve activas (eso es «copiar del control anterior» para ellas).

import { arcoNuevoReemplaza, cambiosAlFirmarConArco, type CambioDePasoDeArco, type PasoDeArco } from "./secuencia-de-arcos";
import { esTipoSinLigas, limpiarNombre } from "./hoja-catalogos";

export const ARCADAS = ["SUPERIOR", "INFERIOR", "AMBAS"] as const;
export type ArcadaDeHoja = (typeof ARCADAS)[number];

export const ROTULO_DE_ARCADA: Record<ArcadaDeHoja, { es: string; en: string }> = {
  SUPERIOR: { es: "Superior", en: "Upper" },
  INFERIOR: { es: "Inferior", en: "Lower" },
  AMBAS: { es: "Ambas", en: "Both" },
};

export function esArcada(v: unknown): v is ArcadaDeHoja {
  return typeof v === "string" && (ARCADAS as readonly string[]).includes(v);
}

// ─── M1 · arcos por arcada ───────────────────────────────────────────────

type ArcoConArcada = { id: string; archUpper?: boolean | null; archLower?: boolean | null };

/** ¿El arco va en esa arcada? Sin dato de arcada cuenta como las dos (igual que secuencia-de-arcos). */
export function arcoCubre(arco: { archUpper?: boolean | null; archLower?: boolean | null }, arcada: "superior" | "inferior"): boolean {
  const sup = arco.archUpper ?? true;
  const inf = arco.archLower ?? true;
  if (!sup && !inf) return true;
  return arcada === "superior" ? sup : inf;
}

/**
 * Lo elegido en los dos selectores → las dos columnas de la hoja. `wireToId` es el superior o, si arriba no cambia,
 * el inferior; `wireToLowerId` solo se llena cuando el inferior es OTRO arco que el de `wireToId`.
 */
export function columnasDeArcosNuevos(sup: string | null | undefined, inf: string | null | undefined): {
  wireToId: string | null;
  wireToLowerId: string | null;
} {
  const wireToId = sup || inf || null;
  const wireToLowerId = inf && inf !== wireToId ? inf : null;
  return { wireToId, wireToLowerId };
}

/** Lo contrario: las dos columnas guardadas → qué arco nuevo hay en cada arcada. */
export function arcosNuevosDeLaHoja<A extends ArcoConArcada>(
  wireTo: A | null | undefined,
  wireToLower: A | null | undefined,
): { superior: A | null; inferior: A | null } {
  const superior = wireTo && arcoCubre(wireTo, "superior") ? wireTo : wireToLower && arcoCubre(wireToLower, "superior") ? wireToLower : null;
  const inferior = wireToLower && arcoCubre(wireToLower, "inferior") ? wireToLower : wireTo && arcoCubre(wireTo, "inferior") ? wireTo : null;
  return { superior, inferior };
}

/**
 * Los selectores tras elegir `id` en una arcada. Un arco de las dos arcadas se pone en las dos (el otro selector
 * lo sigue si estaba vacío o tenía lo mismo que este). Elegir «Sin cambio» (null) solo vacía esta arcada.
 */
export function elegirArco(
  actual: { sup: string | null; inf: string | null },
  arcada: "superior" | "inferior",
  id: string | null,
  arcoElegido: { archUpper?: boolean | null; archLower?: boolean | null } | null,
): { sup: string | null; inf: string | null } {
  const otraArcada = arcada === "superior" ? "inferior" : "superior";
  const antes = arcada === "superior" ? actual.sup : actual.inf;
  const otro = arcada === "superior" ? actual.inf : actual.sup;
  const cubreLaOtra = Boolean(id && arcoElegido && arcoCubre(arcoElegido, otraArcada));
  const nuevoOtro = cubreLaOtra && (otro === null || otro === antes) ? id : otro;
  return arcada === "superior" ? { sup: id, inf: nuevoOtro } : { sup: nuevoOtro, inf: id };
}

/**
 * La secuencia de arcos al firmar con dos arcos nuevos: primero el de `wireToId`, después el inferior sobre lo que
 * quedó. El arco de llegada (`wireFromId`) se cierra solo si alguno de los dos lo reemplaza entero.
 */
export function cambiosAlFirmarConDosArcos(args: {
  pasos: readonly PasoDeArco[];
  wireToId: string | null | undefined;
  wireToLowerId: string | null | undefined;
  arcoAnteriorId?: string | null;
  fecha: Date;
}): CambioDePasoDeArco[] {
  let pasos = args.pasos.map((p) => ({ ...p }));
  const porId = new Map<string, CambioDePasoDeArco>();
  for (const nuevoId of [args.wireToId, args.wireToLowerId]) {
    if (!nuevoId) continue;
    const cambios = cambiosAlFirmarConArco({ pasos, arcoNuevoId: nuevoId, arcoAnteriorId: args.arcoAnteriorId ?? null, fecha: args.fecha });
    for (const c of cambios) porId.set(c.id, c);
    pasos = pasos.map((p) => {
      const c = cambios.find((x) => x.id === p.id);
      return c ? { ...p, status: c.status, appliedDate: c.appliedDate, completedDate: c.completedDate } : p;
    });
  }
  // Entre los dos cubren arcadas que ninguno cubre solo: un arco de las dos arcadas que estaba puesto (o con el que
  // llegó) queda reemplazado si arriba y abajo hay arco nuevo.
  const nuevos = [args.wireToId, args.wireToLowerId]
    .map((id) => (id ? pasos.find((p) => p.id === id) : undefined))
    .filter((p): p is (typeof pasos)[number] => Boolean(p));
  if (nuevos.length === 2) {
    const juntos: PasoDeArco = {
      id: "",
      status: "ACTIVE",
      appliedDate: null,
      completedDate: null,
      archUpper: nuevos.some((p) => arcoCubre(p, "superior")),
      archLower: nuevos.some((p) => arcoCubre(p, "inferior")),
    };
    for (const p of pasos) {
      if (nuevos.some((n) => n.id === p.id) || !arcoNuevoReemplaza(juntos, p)) continue;
      const enUso = p.status === "ACTIVE";
      const eraElAnterior = p.id === args.arcoAnteriorId && p.status === "PLANNED";
      if (!enUso && !eraElAnterior) continue;
      porId.set(p.id, { id: p.id, status: "COMPLETED", appliedDate: p.appliedDate, completedDate: p.completedDate ?? args.fecha });
    }
  }
  // Un arco nuevo de hoy nunca queda cerrado por el otro arco nuevo de hoy.
  for (const nuevoId of [args.wireToId, args.wireToLowerId]) {
    const c = nuevoId ? porId.get(nuevoId) : undefined;
    if (c && c.status !== "ACTIVE") porId.set(c.id, { ...c, status: "ACTIVE", completedDate: null });
  }
  return [...porId.values()];
}

export { arcoNuevoReemplaza };

// ─── M2 · ligas ──────────────────────────────────────────────────────────

export interface LigaDeHoja {
  tipo: string;
  /** null en autoligado (no hay ligas que pintar) o si no se anotó. */
  color: string | null;
  arcada: ArcadaDeHoja;
  /** ¿Se pusieron ligas nuevas en este control? (false = siguen las del control anterior). */
  cambiadasHoy: boolean;
}

export const LIGAS_MAXIMAS_POR_HOJA = 4;

/** Lo que llega del cliente → filas válidas (tipo obligatorio; sin color en autoligado). Nunca lanza. */
export function normalizarLigas(raw: unknown): LigaDeHoja[] {
  if (!Array.isArray(raw)) return [];
  const out: LigaDeHoja[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const tipo = limpiarNombre(o.tipo);
    if (!tipo) continue;
    const color = esTipoSinLigas(tipo) ? null : limpiarNombre(o.color) || null;
    out.push({ tipo, color, arcada: esArcada(o.arcada) ? o.arcada : "AMBAS", cambiadasHoy: o.cambiadasHoy === true });
    if (out.length >= LIGAS_MAXIMAS_POR_HOJA) break;
  }
  return out;
}

/** Las ligas que hereda una hoja nueva: las de la última hoja firmada, sin «se cambiaron hoy». */
export function ligasHeredadas(delAnterior: readonly LigaDeHoja[]): LigaDeHoja[] {
  return normalizarLigas(delAnterior).map((l) => ({ ...l, cambiadasHoy: false }));
}

/** «Elástica gris · Ambas · se cambiaron» (sin «se cambiaron» si siguen las de antes). */
export function textoDeLiga(l: LigaDeHoja, idioma: "es" | "en" = "es"): string {
  const partes = [l.color ? `${l.tipo} ${idioma === "es" ? l.color.toLowerCase() : l.color}` : l.tipo, ROTULO_DE_ARCADA[l.arcada][idioma]];
  if (l.cambiadasHoy) partes.push(idioma === "es" ? "se cambiaron" : "changed");
  return partes.join(" · ");
}

export interface LigasDeUnControl {
  cardId: string;
  cardNumber: number;
  visitDate: string;
  firmada: boolean;
  ligas: LigaDeHoja[];
}

/** El historial del caso: los controles con ligas anotadas, del más reciente al más viejo. */
export function historialDeLigas(controles: readonly LigasDeUnControl[]): LigasDeUnControl[] {
  return controles
    .filter((c) => c.ligas.length > 0)
    .slice()
    .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime() || b.cardNumber - a.cardNumber);
}

// ─── M3 · mecánicas auxiliares ───────────────────────────────────────────

export interface MecanicaDelCaso {
  id: string;
  tipo: string;
  arcada: ArcadaDeHoja | null;
  /** Diente o zona, texto libre corto: «13», «13-16», «sector posterior derecho». */
  ubicacion: string | null;
  nota: string | null;
  colocadaEl: string;
  retiradaEl: string | null;
  /** La hoja de control en la que se colocó / se retiró (si fue desde una). */
  cardIdAlta: string | null;
  cardIdRetiro: string | null;
}

export const UBICACION_MAXIMA = 60;
export const NOTA_MAXIMA = 300;

export function mecanicaActiva(m: Pick<MecanicaDelCaso, "retiradaEl">): boolean {
  return !m.retiradaEl;
}

export type AltaDeMecanica = { tipo: string; arcada: ArcadaDeHoja | null; ubicacion: string | null; nota: string | null; colocadaEl: Date };

/** Valida el alta. `hoy` limita la fecha (no se coloca en el futuro). Con `strict: false`, las dos formas llevan los dos campos. */
export function validarAltaDeMecanica(
  raw: unknown,
  hoy: Date,
): { ok: true; alta: AltaDeMecanica; error?: undefined } | { ok: false; error: string; alta?: undefined } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tipo = limpiarNombre(o.tipo);
  if (!tipo) return { ok: false, error: "Elige qué mecánica se colocó." };
  const arcada = o.arcada === null || o.arcada === undefined || o.arcada === "" ? null : esArcada(o.arcada) ? o.arcada : undefined;
  if (arcada === undefined) return { ok: false, error: "Arcada no válida." };
  const ubicacion = typeof o.ubicacion === "string" ? o.ubicacion.replace(/\s+/g, " ").trim().slice(0, UBICACION_MAXIMA) || null : null;
  const nota = typeof o.nota === "string" ? o.nota.trim().slice(0, NOTA_MAXIMA) || null : null;
  const fecha = typeof o.colocadaEl === "string" && o.colocadaEl ? new Date(o.colocadaEl) : hoy;
  if (Number.isNaN(fecha.getTime())) return { ok: false, error: "Fecha de colocación no válida." };
  // Un día de margen por zonas horarias: «hoy» en la clínica puede ser «mañana» en UTC.
  if (fecha.getTime() > hoy.getTime() + 36 * 3600 * 1000) return { ok: false, error: "La fecha de colocación no puede ser futura." };
  return { ok: true, alta: { tipo, arcada, ubicacion, nota, colocadaEl: fecha } };
}

/** «Resorte abierto · Superior · 13-14». */
export function textoDeMecanica(m: Pick<MecanicaDelCaso, "tipo" | "arcada" | "ubicacion">, idioma: "es" | "en" = "es"): string {
  return [m.tipo, m.arcada ? ROTULO_DE_ARCADA[m.arcada][idioma] : null, m.ubicacion].filter(Boolean).join(" · ");
}

/** Activas primero (las más recientes arriba), luego las retiradas. */
export function ordenarMecanicas<M extends Pick<MecanicaDelCaso, "colocadaEl" | "retiradaEl">>(lista: readonly M[]): M[] {
  return lista.slice().sort((a, b) => {
    const act = Number(mecanicaActiva(b)) - Number(mecanicaActiva(a));
    if (act !== 0) return act;
    return new Date(b.colocadaEl).getTime() - new Date(a.colocadaEl).getTime();
  });
}
