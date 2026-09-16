// El menú que cada persona se armó a mano: qué se GUARDA y qué se CALCULA.
//
// Se guarda SOLO el sitio de cada cosa (una lista de ids y de contenedores).
// Nunca se guarda «qué opciones tiene esta persona»: eso se recalcula en cada
// carga con `opcionesVisibles()` —el mismo filtro de permisos, plan y banderas
// del menú de siempre—, así que:
//
//  · Si al usuario le QUITAN un permiso, su opción desaparece del menú aunque
//    siga guardada en su diseño; el resto no se mueve. Si se lo DEVUELVEN, la
//    opción vuelve al sitio donde la había puesto (el id nunca se borró).
//  · Si mañana se AÑADE una pantalla al panel, aparece sola: como no está en el
//    diseño guardado, se coloca donde la pondría el menú de fábrica
//    (`NIVEL1_IDS` / `GRUPOS` de estructura.ts), y si ese sitio ya no existe
//    porque la persona lo borró, al final del menú principal.
//  · Personalizar NO añade opciones: todo lo que se pinta sale de `visibles`.
//
// Sin React ni Next a propósito: lo comparten el servidor (API) y el navegador,
// y lo prueban los tests en node.

import { NAV_ITEMS, isActivePath, type NavItemDef } from "@/components/dashboard/sidebar-nav";
import { GRUPOS, NIVEL1_IDS, normalizar, type GrupoId } from "@/components/dashboard/menu-dos-niveles/estructura";

/** Versión del formato guardado. Un diseño con otra versión se ignora (menú de fábrica). */
export const VERSION_DISENO = 1;

/** Id del submenú de fábrica («Administración»). */
export const SUBMENU_ADMIN = "admin";

// Topes. Existen para que un payload raro no haga crecer la fila ni la pantalla.
export const MAX_SUBMENUS = 12;
export const MAX_SECCIONES = 20;
export const MAX_LARGO_NOMBRE = 32;

// ═══════════════════════════════════════════════════════════════════
// Lo que se guarda
// ═══════════════════════════════════════════════════════════════════

export interface SeccionGuardada {
  /** Id de grupo de fábrica («dinero») o creado por la persona («g…»). */
  id: string;
  /** null = usa el nombre de fábrica. Texto = se lo puso la persona. */
  nombre: string | null;
  opciones: string[];
}

export type EntradaGuardada =
  | { tipo: "opcion"; id: string }
  | { tipo: "submenu"; id: string; nombre: string | null; secciones: SeccionGuardada[] };

export interface DisenoMenu {
  v: number;
  entradas: EntradaGuardada[];
}

// ═══════════════════════════════════════════════════════════════════
// Lo que se pinta (ya cruzado con lo que esta persona puede ver)
// ═══════════════════════════════════════════════════════════════════

export interface SeccionArmada {
  id: string;
  nombre: string | null;
  items: NavItemDef[];
}

export type EntradaArmada =
  | { tipo: "opcion"; item: NavItemDef }
  | { tipo: "submenu"; id: string; nombre: string | null; secciones: SeccionArmada[] };

export interface MenuArmadoPersonal {
  entradas: EntradaArmada[];
}

// ═══════════════════════════════════════════════════════════════════
// El menú de fábrica, en el mismo formato
// ═══════════════════════════════════════════════════════════════════

/** El diseño de fábrica: los seis del primer nivel y «Administración» con sus grupos. */
export function disenoPorDefecto(): DisenoMenu {
  return {
    v: VERSION_DISENO,
    entradas: [
      ...NIVEL1_IDS.map((id) => ({ tipo: "opcion" as const, id })),
      {
        tipo: "submenu" as const,
        id: SUBMENU_ADMIN,
        nombre: null,
        secciones: GRUPOS.map((g) => ({ id: g.id as string, nombre: null, opciones: [...g.ids] })),
      },
    ],
  };
}

const IDS_CONOCIDOS: ReadonlySet<string> = new Set(NAV_ITEMS.map((it) => it.id));
const GRUPOS_DE_FABRICA: ReadonlySet<string> = new Set(GRUPOS.map((g) => g.id as string));
/** Grupo al que van las opciones que nadie colocó (mismo criterio que `armarMenu`). */
const GRUPO_SOBRANTES: GrupoId = "mas";

export interface UbicacionPorDefecto {
  /** null = primer nivel. */
  submenu: string | null;
  seccion: string | null;
}

/** Dónde pondría el menú de fábrica esta opción. Vale para las que aún no existen. */
export function ubicacionPorDefecto(id: string): UbicacionPorDefecto {
  if (NIVEL1_IDS.includes(id)) return { submenu: null, seccion: null };
  const grupo = GRUPOS.find((g) => g.ids.includes(id));
  return { submenu: SUBMENU_ADMIN, seccion: grupo ? (grupo.id as string) : GRUPO_SOBRANTES };
}

/** Orden de fábrica dentro del sitio que le toca (para colocar una opción nueva entre sus vecinas). */
function ordenPorDefecto(ubicacion: UbicacionPorDefecto): readonly string[] {
  if (ubicacion.submenu === null) return NIVEL1_IDS;
  const grupo = GRUPOS.find((g) => (g.id as string) === ubicacion.seccion);
  return grupo ? grupo.ids : [];
}

/** Los nombres de fábrica no se guardan: `nombre: null` los resuelve el i18n. */
export function esSubmenuDeFabrica(id: string): boolean {
  return id === SUBMENU_ADMIN;
}
export function esSeccionDeFabrica(id: string): boolean {
  return GRUPOS_DE_FABRICA.has(id);
}

// ═══════════════════════════════════════════════════════════════════
// Armar el menú: diseño guardado × opciones visibles
// ═══════════════════════════════════════════════════════════════════

/**
 * Cruza el diseño guardado con las opciones que ESTA persona ve ahora mismo.
 *
 * `diseno = null` (nadie personalizó, o lo guardado no se pudo leer) da
 * exactamente el menú de fábrica; hay un test que lo compara con `armarMenu()`.
 *
 * Reglas, por orden:
 *  1. Se recorre lo guardado y se queda solo con las opciones visibles. Una
 *     opción guardada que ya no se ve simplemente no se pinta (el id sigue
 *     guardado y vuelve a su sitio si le devuelven el permiso).
 *  2. Las opciones visibles que NO están en el diseño (nuevas del panel, o que
 *     antes no veía) se colocan donde las pondría el menú de fábrica; si ese
 *     sitio ya no existe, al final del menú principal.
 *  3. Los contenedores que quedan vacíos no se pintan (igual que hoy con un
 *     grupo sin opciones), pero siguen guardados: en «Personalizar» se ven.
 */
export function aplicarDiseno(
  diseno: DisenoMenu | null,
  visibles: NavItemDef[],
  opciones?: {
    /** El editor SÍ enseña los contenedores vacíos (para llenarlos o borrarlos). */
    conservarVacios?: boolean;
  },
): MenuArmadoPersonal {
  const base = diseno && diseno.v === VERSION_DISENO ? diseno : disenoPorDefecto();
  const porId = new Map(visibles.map((it) => [it.id, it] as const));
  const colocados = new Set<string>();

  const tomar = (id: string): NavItemDef | null => {
    if (colocados.has(id)) return null; // un id repetido se pinta una sola vez
    const it = porId.get(id);
    if (!it) return null;
    colocados.add(id);
    return it;
  };

  const entradas: EntradaArmada[] = [];
  const submenusVistos = new Set<string>();
  for (const e of base.entradas) {
    if (e.tipo === "opcion") {
      const item = tomar(e.id);
      if (item) entradas.push({ tipo: "opcion", item });
      continue;
    }
    if (submenusVistos.has(e.id)) continue;
    submenusVistos.add(e.id);
    const seccionesVistas = new Set<string>();
    const secciones: SeccionArmada[] = [];
    for (const s of e.secciones) {
      if (seccionesVistas.has(s.id)) continue;
      seccionesVistas.add(s.id);
      secciones.push({
        id: s.id,
        nombre: s.nombre,
        items: s.opciones.map(tomar).filter((it): it is NavItemDef => it !== null),
      });
    }
    entradas.push({ tipo: "submenu", id: e.id, nombre: e.nombre, secciones });
  }

  // Las que nadie colocó, en el orden en que las devuelve el filtro (el de NAV_ITEMS).
  for (const item of visibles) {
    if (colocados.has(item.id)) continue;
    colocados.add(item.id);
    insertarPorDefecto(entradas, item);
  }

  return { entradas: opciones?.conservarVacios ? entradas : podar(entradas) };
}

/** El diseño (solo ids) que corresponde a un menú ya armado. Lo usa el editor. */
export function disenoDesdeArmado(armado: MenuArmadoPersonal): DisenoMenu {
  return {
    v: VERSION_DISENO,
    entradas: armado.entradas.map((e) =>
      e.tipo === "opcion"
        ? { tipo: "opcion", id: e.item.id }
        : {
            tipo: "submenu",
            id: e.id,
            nombre: e.nombre,
            secciones: e.secciones.map((s) => ({ id: s.id, nombre: s.nombre, opciones: s.items.map((it) => it.id) })),
          },
    ),
  };
}

/** Mete una opción nueva en el sitio que le daría el menú de fábrica. */
function insertarPorDefecto(entradas: EntradaArmada[], item: NavItemDef): void {
  const ubicacion = ubicacionPorDefecto(item.id);
  const orden = ordenPorDefecto(ubicacion);
  const miIndice = orden.indexOf(item.id);
  // Una opción que el menú de fábrica tampoco conoce va al final del sitio.
  const posicionDe = (id: string) => {
    const i = orden.indexOf(id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };

  if (ubicacion.submenu !== null) {
    const submenu = entradas.find(
      (e): e is Extract<EntradaArmada, { tipo: "submenu" }> => e.tipo === "submenu" && e.id === ubicacion.submenu,
    );
    if (submenu && submenu.secciones.length > 0) {
      const seccion =
        submenu.secciones.find((s) => s.id === ubicacion.seccion) ??
        submenu.secciones[submenu.secciones.length - 1];
      let pos = 0;
      seccion.items.forEach((it, i) => {
        if (miIndice === -1 || posicionDe(it.id) < miIndice) pos = i + 1;
      });
      seccion.items.splice(pos, 0, item);
      return;
    }
    // El sitio de fábrica ya no existe (la persona borró el submenú o sus
    // secciones): al final del menú principal, donde se ve.
    entradas.push({ tipo: "opcion", item });
    return;
  }

  let pos = 0;
  entradas.forEach((e, i) => {
    if (e.tipo !== "opcion") return;
    if (miIndice === -1 || posicionDe(e.item.id) < miIndice) pos = i + 1;
  });
  entradas.splice(pos, 0, { tipo: "opcion", item });
}

/** Quita del MENÚ (no del diseño guardado) las secciones y submenús vacíos. */
function podar(entradas: EntradaArmada[]): EntradaArmada[] {
  const out: EntradaArmada[] = [];
  for (const e of entradas) {
    if (e.tipo === "opcion") {
      out.push(e);
      continue;
    }
    const secciones = e.secciones.filter((s) => s.items.length > 0);
    if (secciones.length > 0) out.push({ ...e, secciones });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Guardar: sanear lo que llega y no perder lo que no se ve
// ═══════════════════════════════════════════════════════════════════

const RE_ID_SUBMENU = /^s[a-z0-9]{4,24}$/;
const RE_ID_SECCION = /^g[a-z0-9]{4,24}$/;

/** Ids que puede inventar el navegador (los de fábrica van aparte). */
export function idSubmenuValido(id: string): boolean {
  return id === SUBMENU_ADMIN || RE_ID_SUBMENU.test(id);
}
export function idSeccionValido(id: string): boolean {
  return GRUPOS_DE_FABRICA.has(id) || RE_ID_SECCION.test(id);
}

/** Id nuevo para un submenú / una sección que crea la persona. */
export function nuevoIdSubmenu(aleatorio: () => string = aleatorioPorDefecto): string {
  return `s${aleatorio()}`;
}
export function nuevoIdSeccion(aleatorio: () => string = aleatorioPorDefecto): string {
  return `g${aleatorio()}`;
}
function aleatorioPorDefecto(): string {
  return Math.random().toString(36).slice(2, 12).padEnd(8, "0");
}

function limpiarNombre(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  // Sin saltos de línea ni caracteres de control: es una etiqueta de una fila.
  const limpio = valor.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  return limpio.slice(0, MAX_LARGO_NOMBRE);
}

/**
 * Sanea un diseño que llega de fuera (del navegador o de la base). Nunca lanza.
 * Devuelve `null` si no hay nada aprovechable — quien lo llama pinta el menú de
 * fábrica. Lo que sí aprovecha lo devuelve en forma canónica: ids conocidos,
 * sin repetidos, con los topes aplicados.
 */
export function normalizarDiseno(dato: unknown): DisenoMenu | null {
  if (!dato || typeof dato !== "object" || Array.isArray(dato)) return null;
  const crudo = dato as { v?: unknown; entradas?: unknown };
  if (crudo.v !== VERSION_DISENO) return null;
  if (!Array.isArray(crudo.entradas)) return null;

  const vistas = new Set<string>();
  const submenus = new Set<string>();
  const entradas: EntradaGuardada[] = [];

  for (const e of crudo.entradas) {
    if (!e || typeof e !== "object") continue;
    const entrada = e as { tipo?: unknown; id?: unknown; nombre?: unknown; secciones?: unknown };
    if (typeof entrada.id !== "string") continue;

    if (entrada.tipo === "opcion") {
      if (!IDS_CONOCIDOS.has(entrada.id) || vistas.has(entrada.id)) continue;
      vistas.add(entrada.id);
      entradas.push({ tipo: "opcion", id: entrada.id });
      continue;
    }

    if (entrada.tipo !== "submenu") continue;
    if (!idSubmenuValido(entrada.id) || submenus.has(entrada.id)) continue;
    if (submenus.size >= MAX_SUBMENUS) continue;
    submenus.add(entrada.id);

    const secciones: SeccionGuardada[] = [];
    const seccionesVistas = new Set<string>();
    const crudas = Array.isArray(entrada.secciones) ? entrada.secciones : [];
    for (const s of crudas) {
      if (!s || typeof s !== "object") continue;
      const seccion = s as { id?: unknown; nombre?: unknown; opciones?: unknown };
      if (typeof seccion.id !== "string" || !idSeccionValido(seccion.id)) continue;
      if (seccionesVistas.has(seccion.id) || seccionesVistas.size >= MAX_SECCIONES) continue;
      seccionesVistas.add(seccion.id);
      const opciones: string[] = [];
      const crudasOpciones = Array.isArray(seccion.opciones) ? seccion.opciones : [];
      for (const id of crudasOpciones) {
        if (typeof id !== "string" || !IDS_CONOCIDOS.has(id) || vistas.has(id)) continue;
        vistas.add(id);
        opciones.push(id);
      }
      secciones.push({ id: seccion.id, nombre: limpiarNombre(seccion.nombre), opciones });
    }
    entradas.push({ tipo: "submenu", id: entrada.id, nombre: limpiarNombre(entrada.nombre), secciones });
  }

  if (entradas.length === 0) return null;
  return { v: VERSION_DISENO, entradas };
}

/** Todos los ids de opción que menciona un diseño. */
export function idsDelDiseno(diseno: DisenoMenu): string[] {
  const ids: string[] = [];
  for (const e of diseno.entradas) {
    if (e.tipo === "opcion") ids.push(e.id);
    else for (const s of e.secciones) ids.push(...s.opciones);
  }
  return ids;
}

const RAIZ = " raiz";
const clave = (submenu: string | null, seccion: string | null) =>
  submenu === null ? RAIZ : `${submenu} ${seccion ?? ""}`;

/**
 * Devuelve el diseño que hay que GUARDAR a partir del que se editó en pantalla.
 *
 * El editor solo enseña —y por tanto solo puede colocar— las opciones que esta
 * persona ve. Las que tiene guardadas pero hoy no ve (le quitaron el permiso,
 * su plan cambió) no pueden perderse por el hecho de guardar: se vuelven a
 * meter en el mismo contenedor y detrás de la misma vecina que tenían.
 *
 * Si el contenedor donde vivían ya no existe (lo borró en el editor, que para
 * ella estaba vacío), el id se cae del diseño: cuando vuelva a verse, se
 * colocará en el sitio de fábrica.
 */
export function fusionarOcultas(
  guardadoPrevio: DisenoMenu | null,
  borrador: DisenoMenu,
  /**
   * Lo que el editor SÍ podía colocar. El servidor no lo necesita —lo que no
   * viene en el borrador es justo lo que no se veía—, así que por defecto va
   * vacío; los tests lo usan para escribir el caso tal como se lee.
   */
  visibles: ReadonlySet<string> = new Set<string>(),
): DisenoMenu {
  if (!guardadoPrevio) return borrador;

  const enBorrador = new Set(idsDelDiseno(borrador));
  // Contenedor y vecina anterior de cada id oculto, según lo que había guardado.
  const pendientes: { id: string; contenedor: string; ancla: string | null }[] = [];
  const recorrer = (contenedor: string, ids: string[]) => {
    let ancla: string | null = null;
    for (const id of ids) {
      if (!visibles.has(id) && !enBorrador.has(id)) pendientes.push({ id, contenedor, ancla });
      // También las ocultas sirven de ancla: dos seguidas conservan su orden
      // (la segunda se mete detrás de la primera, ya reinsertada).
      ancla = id;
    }
  };
  recorrer(
    RAIZ,
    guardadoPrevio.entradas.filter((e): e is { tipo: "opcion"; id: string } => e.tipo === "opcion").map((e) => e.id),
  );
  for (const e of guardadoPrevio.entradas) {
    if (e.tipo !== "submenu") continue;
    for (const s of e.secciones) recorrer(clave(e.id, s.id), s.opciones);
  }
  if (pendientes.length === 0) return borrador;

  const salida: DisenoMenu = {
    v: borrador.v,
    entradas: borrador.entradas.map((e) =>
      e.tipo === "opcion" ? { ...e } : { ...e, secciones: e.secciones.map((s) => ({ ...s, opciones: [...s.opciones] })) },
    ),
  };

  const meter = (contenedor: string, id: string, ancla: string | null): boolean => {
    if (contenedor === RAIZ) {
      const i = ancla === null ? -1 : salida.entradas.findIndex((e) => e.tipo === "opcion" && e.id === ancla);
      if (ancla !== null && i === -1) return false;
      salida.entradas.splice(i + 1, 0, { tipo: "opcion", id });
      return true;
    }
    const [submenuId, seccionId] = contenedor.split(" ");
    const submenu = salida.entradas.find((e) => e.tipo === "submenu" && e.id === submenuId);
    if (!submenu || submenu.tipo !== "submenu") return false;
    const seccion = submenu.secciones.find((s) => s.id === seccionId);
    if (!seccion) return false;
    const i = ancla === null ? -1 : seccion.opciones.indexOf(ancla);
    if (ancla !== null && i === -1) return false;
    seccion.opciones.splice(i + 1, 0, id);
    return true;
  };

  for (const p of pendientes) {
    // Con el ancla si sigue ahí; si la vecina también desapareció, al principio
    // del contenedor. Si el contenedor entero ya no existe, se deja caer.
    if (!meter(p.contenedor, p.id, p.ancla)) meter(p.contenedor, p.id, null);
  }
  return salida;
}

// ═══════════════════════════════════════════════════════════════════
// Ayudas del segundo nivel (buscador y fila activa)
// ═══════════════════════════════════════════════════════════════════

/** Buscador del segundo nivel: filtra por nombre visible y esconde las secciones vacías. */
export function filtrarSecciones(
  secciones: SeccionArmada[],
  consulta: string,
  etiqueta: (id: string) => string,
): SeccionArmada[] {
  const q = normalizar(consulta);
  if (!q) return secciones;
  return secciones
    .map((s) => ({ ...s, items: s.items.filter((it) => normalizar(etiqueta(it.id)).includes(q)) }))
    .filter((s) => s.items.length > 0);
}

/** ¿La pantalla de ahora vive dentro de este submenú? (para pintarlo en morado) */
export function submenuActivo(pathname: string | null, secciones: SeccionArmada[]): boolean {
  return secciones.some((s) =>
    s.items.some((it) => !it.comingSoon && isActivePath(pathname, it.href, it.matchExact)),
  );
}
