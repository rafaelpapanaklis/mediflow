// Las operaciones de «Personalizar», sin React: mover, subir, bajar, crear un
// submenú o una sección, renombrarlos y borrarlos si están vacíos.
//
// Todas son PURAS: reciben un diseño y devuelven otro, sin tocar el que les
// llega. Eso es lo que permite que el arrastre, las flechas y el «Mover a…»
// sean la MISMA operación (y que se prueben sin navegador).
//
// Regla de oro: NINGUNA de estas funciones añade ni quita opciones. Solo las
// cambia de sitio. Lo que cada persona ve lo decide el filtro de permisos en
// cada carga, nunca este archivo.

import {
  MAX_LARGO_NOMBRE,
  MAX_SECCIONES,
  MAX_SUBMENUS,
  VERSION_DISENO,
  nuevoIdSeccion,
  nuevoIdSubmenu,
  type DisenoMenu,
  type EntradaGuardada,
  type SeccionGuardada,
} from "./diseno";

/** Dónde vive (o dónde va a vivir) una opción. `submenuId: null` = menú principal. */
export interface Contenedor {
  submenuId: string | null;
  seccionId: string | null;
}

export interface Ubicacion extends Contenedor {
  indice: number;
}

export const CONTENEDOR_RAIZ: Contenedor = { submenuId: null, seccionId: null };

export function mismoContenedor(a: Contenedor, b: Contenedor): boolean {
  return a.submenuId === b.submenuId && a.seccionId === b.seccionId;
}

/** Copia profunda: todas las operaciones trabajan sobre ella y devuelven eso. */
function copia(diseno: DisenoMenu): DisenoMenu {
  return {
    v: diseno.v,
    entradas: diseno.entradas.map((e) =>
      e.tipo === "opcion"
        ? { ...e }
        : { ...e, secciones: e.secciones.map((s) => ({ ...s, opciones: [...s.opciones] })) },
    ),
  };
}

function submenuDe(diseno: DisenoMenu, id: string) {
  return diseno.entradas.find(
    (e): e is Extract<EntradaGuardada, { tipo: "submenu" }> => e.tipo === "submenu" && e.id === id,
  );
}

function seccionDe(diseno: DisenoMenu, c: Contenedor): SeccionGuardada | null {
  if (c.submenuId === null) return null;
  const sm = submenuDe(diseno, c.submenuId);
  if (!sm) return null;
  return sm.secciones.find((s) => s.id === c.seccionId) ?? null;
}

/** Las opciones de un contenedor, en orden. */
export function opcionesDe(diseno: DisenoMenu, c: Contenedor): string[] {
  if (c.submenuId === null) {
    return diseno.entradas.filter((e) => e.tipo === "opcion").map((e) => (e as { id: string }).id);
  }
  return seccionDe(diseno, c)?.opciones ?? [];
}

/** Dónde está hoy una opción, o null si el diseño no la menciona. */
export function ubicacionDe(diseno: DisenoMenu, id: string): Ubicacion | null {
  let i = 0;
  for (const e of diseno.entradas) {
    if (e.tipo !== "opcion") continue;
    if (e.id === id) return { ...CONTENEDOR_RAIZ, indice: i };
    i += 1;
  }
  for (const e of diseno.entradas) {
    if (e.tipo !== "submenu") continue;
    for (const s of e.secciones) {
      const idx = s.opciones.indexOf(id);
      if (idx !== -1) return { submenuId: e.id, seccionId: s.id, indice: idx };
    }
  }
  return null;
}

/** Todos los contenedores que pueden recibir opciones, en el orden en que se ven. */
export function contenedores(diseno: DisenoMenu): Contenedor[] {
  const lista: Contenedor[] = [CONTENEDOR_RAIZ];
  for (const e of diseno.entradas) {
    if (e.tipo !== "submenu") continue;
    for (const s of e.secciones) lista.push({ submenuId: e.id, seccionId: s.id });
  }
  return lista;
}

/** Quita la opción de donde esté. Devuelve el diseño ya sin ella. */
function quitar(diseno: DisenoMenu, id: string): DisenoMenu {
  const salida = copia(diseno);
  salida.entradas = salida.entradas.filter((e) => !(e.tipo === "opcion" && e.id === id));
  for (const e of salida.entradas) {
    if (e.tipo !== "submenu") continue;
    for (const s of e.secciones) {
      const i = s.opciones.indexOf(id);
      if (i !== -1) s.opciones.splice(i, 1);
    }
  }
  return salida;
}

/**
 * Mueve una opción a un contenedor y una posición. `indice` se recorta a lo que
 * quepa, así que soltar «al final» siempre funciona. Si el destino no existe
 * (una sección que se borró en medio), el diseño vuelve igual.
 */
export function moverOpcion(diseno: DisenoMenu, id: string, destino: Contenedor, indice: number): DisenoMenu {
  if (!ubicacionDe(diseno, id)) return diseno;
  if (destino.submenuId !== null && !seccionDe(diseno, destino)) return diseno;

  const salida = quitar(diseno, id);
  if (destino.submenuId === null) {
    // El menú principal mezcla opciones y submenús: `indice` cuenta SOLO
    // opciones, así que se traduce a la posición real de la lista.
    const posiciones = salida.entradas.map((e, i) => (e.tipo === "opcion" ? i : -1)).filter((i) => i !== -1);
    const n = Math.max(0, Math.min(indice, posiciones.length));
    // «Al final» es al final de las OPCIONES, no de la lista entera: si no,
    // mandar una opción al final del menú principal la dejaba colgando por
    // debajo de «Administración», que es justo lo contrario de lo que se pidió.
    const posicion =
      n < posiciones.length
        ? posiciones[n]
        : posiciones.length > 0
          ? posiciones[posiciones.length - 1] + 1
          : 0;
    salida.entradas.splice(posicion, 0, { tipo: "opcion", id });
    return salida;
  }
  const seccion = seccionDe(salida, destino);
  if (!seccion) return diseno;
  seccion.opciones.splice(Math.max(0, Math.min(indice, seccion.opciones.length)), 0, id);
  return salida;
}

/**
 * Una opción, un puesto arriba o abajo DENTRO de su contenedor.
 *
 * En el menú principal se INTERCAMBIA con su vecina en la lista de verdad, en
 * vez de quitarla y volver a meterla: así los submenús que haya en medio no se
 * mueven de sitio y bajar una opción y volver a subirla deja el menú EXACTAMENTE
 * como estaba.
 */
export function desplazarOpcion(diseno: DisenoMenu, id: string, delta: -1 | 1): DisenoMenu {
  const u = ubicacionDe(diseno, id);
  if (!u) return diseno;
  const destino = u.indice + delta;
  if (destino < 0 || destino >= opcionesDe(diseno, u).length) return diseno;

  if (u.submenuId === null) {
    const posiciones = diseno.entradas.map((e, i) => (e.tipo === "opcion" ? i : -1)).filter((i) => i !== -1);
    const salida = copia(diseno);
    const a = posiciones[u.indice];
    const b = posiciones[destino];
    [salida.entradas[a], salida.entradas[b]] = [salida.entradas[b], salida.entradas[a]];
    return salida;
  }
  return moverOpcion(diseno, id, u, destino);
}

/** ¿Se puede mover ya? (para apagar la flecha en vez de que no haga nada) */
export function puedeDesplazarOpcion(diseno: DisenoMenu, id: string, delta: -1 | 1): boolean {
  const u = ubicacionDe(diseno, id);
  if (!u) return false;
  const destino = u.indice + delta;
  return destino >= 0 && destino < opcionesDe(diseno, u).length;
}

// ── Submenús ─────────────────────────────────────────────────────────

export function limpiarNombreEditado(nombre: string): string {
  return nombre.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LARGO_NOMBRE);
}

/** Crea un submenú vacío al final del menú principal. Devuelve el diseño y su id. */
export function crearSubmenu(
  diseno: DisenoMenu,
  nombre: string,
  ids: { submenu?: string; seccion?: string } = {},
): { diseno: DisenoMenu; id: string } | null {
  const cuantos = diseno.entradas.filter((e) => e.tipo === "submenu").length;
  if (cuantos >= MAX_SUBMENUS) return null;
  const id = ids.submenu ?? nuevoIdSubmenu();
  const salida = copia(diseno);
  salida.entradas.push({
    tipo: "submenu",
    id,
    nombre: limpiarNombreEditado(nombre) || null,
    // Un submenú necesita una sección donde meter cosas. Sin nombre: mientras
    // sea la única, el editor y el menú no pintan ningún encabezado.
    secciones: [{ id: ids.seccion ?? nuevoIdSeccion(), nombre: null, opciones: [] }],
  });
  return { diseno: salida, id };
}

/** ¿Está vacío? Solo entonces se puede borrar: nadie se lleva doce pantallas por delante. */
export function submenuVacio(diseno: DisenoMenu, submenuId: string): boolean {
  const sm = submenuDe(diseno, submenuId);
  if (!sm) return false;
  return sm.secciones.every((s) => s.opciones.length === 0);
}

export function borrarSubmenu(diseno: DisenoMenu, submenuId: string): DisenoMenu {
  if (!submenuVacio(diseno, submenuId)) return diseno;
  const salida = copia(diseno);
  salida.entradas = salida.entradas.filter((e) => !(e.tipo === "submenu" && e.id === submenuId));
  return salida;
}

export function renombrarSubmenu(diseno: DisenoMenu, submenuId: string, nombre: string): DisenoMenu {
  const salida = copia(diseno);
  const sm = submenuDe(salida, submenuId);
  if (!sm) return diseno;
  // Vacío = vuelve al nombre de fábrica (los de la persona no pueden quedar sin nombre).
  sm.nombre = limpiarNombreEditado(nombre) || null;
  return salida;
}

/** Mueve un submenú a la posición `destino` de las entradas del menú principal. */
export function moverSubmenu(diseno: DisenoMenu, submenuId: string, destino: number): DisenoMenu {
  const indice = diseno.entradas.findIndex((e) => e.tipo === "submenu" && e.id === submenuId);
  if (indice === -1) return diseno;
  const salida = copia(diseno);
  const [movida] = salida.entradas.splice(indice, 1);
  salida.entradas.splice(Math.max(0, Math.min(destino, salida.entradas.length)), 0, movida);
  return salida;
}

// ── Secciones ────────────────────────────────────────────────────────

export function crearSeccion(
  diseno: DisenoMenu,
  submenuId: string,
  nombre: string,
  id = nuevoIdSeccion(),
): { diseno: DisenoMenu; id: string } | null {
  const salida = copia(diseno);
  const sm = submenuDe(salida, submenuId);
  if (!sm || sm.secciones.length >= MAX_SECCIONES) return null;
  sm.secciones.push({ id, nombre: limpiarNombreEditado(nombre) || null, opciones: [] });
  return { diseno: salida, id };
}

export function seccionVacia(diseno: DisenoMenu, submenuId: string, seccionId: string): boolean {
  const s = seccionDe(diseno, { submenuId, seccionId });
  return !!s && s.opciones.length === 0;
}

export function borrarSeccion(diseno: DisenoMenu, submenuId: string, seccionId: string): DisenoMenu {
  if (!seccionVacia(diseno, submenuId, seccionId)) return diseno;
  const salida = copia(diseno);
  const sm = submenuDe(salida, submenuId);
  if (!sm) return diseno;
  // La última sección no se borra: dejaría el submenú sin sitio donde soltar.
  // Para deshacerse de él entero está el botón de borrar el submenú.
  if (sm.secciones.length <= 1) return diseno;
  sm.secciones = sm.secciones.filter((s) => s.id !== seccionId);
  return salida;
}

export function renombrarSeccion(
  diseno: DisenoMenu,
  submenuId: string,
  seccionId: string,
  nombre: string,
): DisenoMenu {
  const salida = copia(diseno);
  const s = seccionDe(salida, { submenuId, seccionId });
  if (!s) return diseno;
  s.nombre = limpiarNombreEditado(nombre) || null;
  return salida;
}

export function desplazarSeccion(diseno: DisenoMenu, submenuId: string, seccionId: string, delta: -1 | 1): DisenoMenu {
  const salida = copia(diseno);
  const sm = submenuDe(salida, submenuId);
  if (!sm) return diseno;
  const i = sm.secciones.findIndex((s) => s.id === seccionId);
  const destino = i + delta;
  if (i === -1 || destino < 0 || destino >= sm.secciones.length) return diseno;
  const [movida] = sm.secciones.splice(i, 1);
  sm.secciones.splice(destino, 0, movida);
  return salida;
}

/** Diseño vacío de arranque (por si algún día hiciera falta empezar de cero). */
export function disenoVacio(): DisenoMenu {
  return { v: VERSION_DISENO, entradas: [] };
}
