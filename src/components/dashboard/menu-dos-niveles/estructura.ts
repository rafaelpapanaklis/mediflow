// Dónde va cada opción en el menú de dos niveles. Solo decide el SITIO: quién
// ve cada opción lo sigue decidiendo `shouldShowItem` de sidebar-nav.ts, el
// mismo filtro del menú de siempre. Este archivo no conoce permisos ni planes.
//
// Sin React ni Next a propósito: lo prueban los tests en node.

import {
  NAV_ITEMS,
  SUSPENDED_NAV_IDS,
  isActivePath,
  shouldShowItem,
  type ClinicCategory,
  type NavItemDef,
  type SidebarUser,
} from "@/components/dashboard/sidebar-nav";

export type GrupoId =
  | "dinero"
  | "clinica"
  | "pacientes"
  | "sistema"
  | "especialidades"
  | "catalogo"
  | "mas";

/** Primer nivel (barra estrecha), en el orden del diseño aprobado. */
export const NIVEL1_IDS: readonly string[] = [
  "home",         // Hoy
  "appointments", // Agenda
  "patients",     // Pacientes
  "inbox",        // Mensajes (antes «Inbox»)
  "billing",      // Caja
  "sabina",       // Sabina
];

/**
 * Segundo nivel («Administración»), por grupos y en orden. Los cuatro primeros
 * son los del diseño. Los demás existen para que NINGUNA opción se quede sin
 * sitio:
 *  - «especialidades» y «catalogo» hoy están apagados por bandera
 *    (HIDE_SPECIALTIES, HIDE_SUPPLY_MODULES); si se encienden, aparecen aquí.
 *  - «mas» guarda las dos opciones que el diseño no enseña (IA asistente y
 *    Marketplace). Quitarlas es decisión de Rafael, no del menú.
 * Before/After, Fórmulas, Ejercicios, Ortesis y Paquetes solo salen en clínicas
 * que no son dentales; van al final de «clinica» / «catalogo».
 */
export const GRUPOS: readonly { id: GrupoId; ids: readonly string[] }[] = [
  { id: "dinero", ids: ["finanzas", "analytics", "reports"] },
  {
    id: "clinica",
    ids: ["team", "resources", "inventory", "procedures", "clinic-layout", "before-after", "formulas", "exercises", "orthotics"],
  },
  { id: "pacientes", ids: ["landing", "resenas", "tv-modes", "messages"] },
  { id: "sistema", ids: ["settings", "auditoria", "soporte"] },
  { id: "especialidades", ids: ["pediatrics", "endodontics", "periodontics", "orthodontics", "implants"] },
  { id: "catalogo", ids: ["packages", "suppliers", "compras", "laboratorios", "ordenes-laboratorio"] },
  { id: "mas", ids: ["ai", "marketplace"] },
];

/** Ícono (nombre de Material Symbols Rounded) de cada opción. */
export const ICONO_DE: Readonly<Record<string, string>> = {
  home: "home",
  appointments: "calendar_month",
  patients: "group",
  inbox: "forum",
  billing: "point_of_sale",
  sabina: "auto_awesome",
  finanzas: "savings",
  analytics: "monitoring",
  reports: "summarize",
  team: "groups",
  resources: "chair",
  inventory: "inventory_2",
  procedures: "dentistry",
  "clinic-layout": "map",
  "before-after": "compare",
  formulas: "science",
  exercises: "fitness_center",
  orthotics: "footprint",
  landing: "language",
  resenas: "reviews",
  "tv-modes": "tv",
  messages: "chat",
  settings: "settings",
  auditoria: "history",
  soporte: "support_agent",
  pediatrics: "child_care",
  endodontics: "bolt",
  periodontics: "monitor_heart",
  orthodontics: "sentiment_satisfied",
  implants: "anchor",
  packages: "redeem",
  suppliers: "local_shipping",
  compras: "shopping_cart",
  laboratorios: "science",
  "ordenes-laboratorio": "assignment",
  ai: "smart_toy",
  marketplace: "storefront",
  facturacion: "credit_card",
};

/** Íconos de la estructura del menú (no de opciones). */
export const ICONOS_CHROME = [
  "add",            // Nueva cita
  "apps",           // Administración
  "arrow_back",     // volver del segundo nivel en el teléfono
  "chevron_right",  // flecha de Administración y migas
  "close",          // cerrar segundo nivel / cajón
  "dark_mode",
  "left_panel_close",
  "left_panel_open",
  "light_mode",
  "lock",           // Caja sin acceso
  "logout",
  "menu",           // tres rayitas (solo teléfono)
  "person",         // Mi perfil
  "search",
  "unfold_more",    // tarjetas de clínica y de usuario
] as const;

export interface GrupoArmado {
  id: GrupoId;
  items: NavItemDef[];
}

export interface MenuArmado {
  nivel1: NavItemDef[];
  grupos: GrupoArmado[];
}

/** Las opciones que ve esta persona: el MISMO filtro y orden que el menú de siempre. */
export function opcionesVisibles(
  user: SidebarUser,
  category: ClinicCategory,
  clinicModuleKeys: string[],
): NavItemDef[] {
  return NAV_ITEMS.filter((item) => shouldShowItem(item, user, category, clinicModuleKeys));
}

/**
 * Reparte las opciones visibles entre los dos niveles. Un grupo sin opciones
 * no aparece. Si llegara una opción sin sitio asignado (una nueva que alguien
 * añada a NAV_ITEMS sin pasar por aquí), va a «mas» en vez de perderse; el test
 * `estructura.test.ts` exige además que no pase.
 */
export function armarMenu(visibles: NavItemDef[]): MenuArmado {
  const porId = new Map(visibles.map((it) => [it.id, it] as const));
  const colocados = new Set<string>();
  const tomar = (id: string): NavItemDef | null => {
    const it = porId.get(id);
    if (!it) return null;
    colocados.add(id);
    return it;
  };

  const nivel1 = NIVEL1_IDS.map(tomar).filter((it): it is NavItemDef => it !== null);
  const grupos: GrupoArmado[] = GRUPOS.map((g) => ({
    id: g.id,
    items: g.ids.map(tomar).filter((it): it is NavItemDef => it !== null),
  }));

  const sinSitio = visibles.filter((it) => !colocados.has(it.id));
  if (sinSitio.length > 0) {
    const mas = grupos.find((g) => g.id === "mas");
    if (mas) mas.items.push(...sinSitio);
  }

  return { nivel1, grupos: grupos.filter((g) => g.items.length > 0) };
}

/** Menú reducido de clínica suspendida (Facturación + Soporte), igual que hoy. */
export function opcionesSuspendida(): NavItemDef[] {
  return SUSPENDED_NAV_IDS
    .map((id) => NAV_ITEMS.find((it) => it.id === id))
    .filter((it): it is NavItemDef => Boolean(it));
}

/** Minúsculas y sin acentos: «analitica» encuentra «Analítica». */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Buscador del segundo nivel: filtra por nombre visible y esconde los grupos vacíos. */
export function filtrarGrupos(
  grupos: GrupoArmado[],
  consulta: string,
  etiqueta: (id: string) => string,
): GrupoArmado[] {
  const q = normalizar(consulta);
  if (!q) return grupos;
  return grupos
    .map((g) => ({ id: g.id, items: g.items.filter((it) => normalizar(etiqueta(it.id)).includes(q)) }))
    .filter((g) => g.items.length > 0);
}

/** ¿La pantalla actual es una opción del segundo nivel? (pinta «Administración» como activa) */
export function segundoNivelActivo(pathname: string | null, grupos: GrupoArmado[]): boolean {
  return grupos.some((g) => g.items.some((it) => !it.comingSoon && isActivePath(pathname, it.href, it.matchExact)));
}

export type EtiquetaRuta = { tipo: "opcion"; id: string } | { tipo: "clave"; clave: string } | null;

/**
 * Qué nombre lleva la miga de la barra superior. Primero, la opción del menú
 * cuya ruta coincide más largo (así /dashboard/sabina dice «Sabina» y no «Hoy»).
 * Si la pantalla no es una opción del menú (Radiografías, la agenda antigua…),
 * el mapa de la barra de siempre. Si tampoco está ahí, sin segunda miga.
 */
export function etiquetaDeRuta(pathname: string | null, mapaBarraVieja: Record<string, string>): EtiquetaRuta {
  if (!pathname) return { tipo: "opcion", id: "home" };
  const candidatas = NAV_ITEMS.filter(
    (it) => !it.comingSoon && isActivePath(pathname, it.href, it.matchExact),
  ).sort((a, b) => b.href.length - a.href.length);
  if (candidatas.length > 0) return { tipo: "opcion", id: candidatas[0].id };

  if (mapaBarraVieja[pathname]) return { tipo: "clave", clave: mapaBarraVieja[pathname] };
  const prefijo = Object.keys(mapaBarraVieja)
    .filter((k) => k !== "/dashboard" && pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (prefijo) return { tipo: "clave", clave: mapaBarraVieja[prefijo] };
  return null;
}
