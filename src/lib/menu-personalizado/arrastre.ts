// Dónde cae lo que se suelta, en «Personalizar».
//
// Vive aparte del componente —y sin React— porque es LA regla del arrastre: si
// se equivoca, la opción aparece donde nadie la puso. Aquí se puede probar
// entera sin navegador.
//
// Cada fila y cada zona del editor tiene una clave:
//   op:<id>                   una opción
//   sm:<idSubmenu>            la fila de un submenú
//   sc:<idSubmenu>:<idSeccion>  el encabezado de una sección
//   cont:raiz                 la zona del menú principal
//   cont:<idSubmenu>:<idSeccion>  la zona de una sección

import type { DisenoMenu } from "./diseno";
import {
  CONTENEDOR_RAIZ,
  moverOpcion,
  moverSubmenu,
  opcionesDe,
  ubicacionDe,
  type Contenedor,
} from "./editar";

export function claveContenedor(c: Contenedor): string {
  return c.submenuId === null ? "cont:raiz" : `cont:${c.submenuId}:${c.seccionId}`;
}

export function contenedorDesdeClave(clave: string): Contenedor | null {
  if (clave === "cont:raiz") return CONTENEDOR_RAIZ;
  const partes = clave.split(":");
  if (partes.length !== 3 || partes[0] !== "cont") return null;
  return { submenuId: partes[1], seccionId: partes[2] };
}

/**
 * Una sola regla para soltar, la use el ratón o el dedo:
 *   · opción sobre otra opción     → al sitio exacto de esa opción
 *   · opción sobre un submenú      → dentro, al final de su primera sección
 *   · opción sobre una sección     → al final de esa sección
 *   · opción sobre una zona vacía  → dentro de esa zona
 *   · submenú sobre cualquier fila → a esa altura del menú principal
 * Cualquier otra combinación deja el diseño como estaba.
 */
export function soltar(diseno: DisenoMenu, activo: string, encima: string): DisenoMenu {
  if (activo.startsWith("sm:")) {
    const submenuId = activo.slice(3);
    const destino = indiceEnRaiz(diseno, encima);
    return destino === null ? diseno : moverSubmenu(diseno, submenuId, destino);
  }
  if (!activo.startsWith("op:")) return diseno;
  const id = activo.slice(3);
  if (!ubicacionDe(diseno, id)) return diseno;

  if (encima.startsWith("op:")) {
    const destino = ubicacionDe(diseno, encima.slice(3));
    return destino ? moverOpcion(diseno, id, destino, destino.indice) : diseno;
  }
  if (encima.startsWith("sm:")) {
    const submenuId = encima.slice(3);
    const sm = diseno.entradas.find((e) => e.tipo === "submenu" && e.id === submenuId);
    if (!sm || sm.tipo !== "submenu" || sm.secciones.length === 0) return diseno;
    const destino: Contenedor = { submenuId, seccionId: sm.secciones[0].id };
    return moverOpcion(diseno, id, destino, opcionesDe(diseno, destino).length);
  }
  if (encima.startsWith("sc:")) {
    const partes = encima.split(":");
    if (partes.length !== 3) return diseno;
    const destino: Contenedor = { submenuId: partes[1], seccionId: partes[2] };
    return moverOpcion(diseno, id, destino, opcionesDe(diseno, destino).length);
  }
  const destino = contenedorDesdeClave(encima);
  if (!destino) return diseno;
  return moverOpcion(diseno, id, destino, opcionesDe(diseno, destino).length);
}

/** A qué altura del menú principal cae una fila (para reordenar submenús). */
export function indiceEnRaiz(diseno: DisenoMenu, clave: string): number | null {
  if (clave === "cont:raiz") return diseno.entradas.length;
  if (clave.startsWith("op:")) {
    const id = clave.slice(3);
    const i = diseno.entradas.findIndex((e) => e.tipo === "opcion" && e.id === id);
    return i === -1 ? null : i;
  }
  if (clave.startsWith("sm:")) {
    const id = clave.slice(3);
    const i = diseno.entradas.findIndex((e) => e.tipo === "submenu" && e.id === id);
    return i === -1 ? null : i;
  }
  // Una sección o una zona de dentro de un submenú: un submenú no se mete
  // dentro de otro, así que no se mueve.
  return null;
}
