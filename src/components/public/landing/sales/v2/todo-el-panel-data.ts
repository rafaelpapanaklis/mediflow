import { GRID_FEATURES, GRID_TITLE, MODULES_TRIO, MODULE_PAGES } from "./landing-data";
import type { ProductoSlug } from "@/lib/producto/types";

/**
 * «Todo el panel» (ajuste 1, 25-sep-2026, ws1-t4): UNA sección que junta el
 * trío oscuro (modules-trio), «Y todo lo demás, incluido» (features-grid) y
 * «Conoce cada módulo a fondo» (module-pages). Una laptop en 3D con el panel
 * grabado, alrededor 8 tarjetitas del panel (ícono + dos o tres palabras, cada
 * una enlaza a su página de módulo: los 8 enlaces de SEO se conservan), el
 * portal del paciente en un teléfono y, debajo, la cinta con el resto.
 *
 * Todo sale de textos que ya estaban en la portada; aquí no se inventa nada.
 */

export const TODO_PANEL_COPY = {
  eyebrow: "Todo el panel",
  title: GRID_TITLE,
  subtitle: "Toca una tarjeta y conoce el módulo a fondo.",
  /** Lo que se ve en el vídeo de la laptop (alt/aria y reporte). */
  video: {
    src: "/landing/videos/panel-recorrido.mp4",
    poster: "/landing/videos/panel-recorrido.webp",
    ve: "Recorrido por Administración del panel real: Página web (las 8 plantillas), Equipo, Inventario y Finanzas.",
  },
};

export interface TarjetaPanel {
  slug: ProductoSlug;
  /** Ícono de Material Symbols Rounded (recorte del menú del panel). */
  icono: string;
  /** Dos o tres palabras. */
  label: string;
  /** Lado en escritorio: 4 a la izquierda y 4 a la derecha de la laptop. */
  lado: "izq" | "der";
}

/**
 * Las 8 tarjetas flotantes = las 8 páginas de producto (MODULE_PAGES). El
 * slug va tipado: si alguien inventa uno, no compila.
 */
export const TARJETAS: TarjetaPanel[] = [
  { slug: "software-agenda-dental", icono: "calendar_month", label: "Agenda + WhatsApp", lado: "izq" },
  { slug: "expediente-clinico-dental", icono: "assignment", label: "Expediente y odontograma", lado: "izq" },
  { slug: "portal-del-paciente-dental", icono: "person", label: "Portal del paciente", lado: "izq" },
  { slug: "caja-y-cobros-clinica-dental", icono: "point_of_sale", label: "Caja y cobros", lado: "izq" },
  { slug: "facturacion-dental-cfdi", icono: "summarize", label: "Facturación CFDI", lado: "der" },
  { slug: "radiografias-3d-cbct-dental", icono: "dentistry", label: "Radiografías 3D y CBCT", lado: "der" },
  { slug: "reportes-clinica-dental", icono: "monitoring", label: "Reportes e indicadores", lado: "der" },
  { slug: "software-multiclinica-dental", icono: "add_business", label: "Multi-sede y roles", lado: "der" },
];

// Comprobación en tiempo de módulo: las 8 páginas de producto siguen enlazadas.
const faltan = MODULE_PAGES.filter((m) => !TARJETAS.some((t) => t.slug === m.slug));
if (faltan.length) throw new Error(`todo-el-panel: faltan enlaces a ${faltan.map((m) => m.slug).join(", ")}`);

/** Ícono del menú del panel para cada función de la rejilla vieja. */
function iconos(): Record<string, string> {
  return {
    "Expediente + odontograma": "dentistry",
    "Portal del paciente": "person",
    "Recetas digitales": "assignment",
    "Consentimientos firmados": "edit",
    "Módulos por especialidad": "dashboard_customize",
    "Directorio + reseñas": "reviews",
    "TV para sala de espera": "tv",
    "Multi-sucursal": "add_business",
    "Importa tus datos": "folder",
    "Seguridad de verdad": "lock",
    "Pagos en línea": "credit_card",
    "Inventario e insumos": "inventory_2",
    "Proveedores y compras": "local_shipping",
    "Laboratorios y órdenes": "science",
    "Rápido de usar": "bolt",
    "Reservas en línea 24/7": "language",
  };
}
const ICONO_GRID = iconos();
const ICONO_TRIO: Record<string, string> = { analytics: "monitoring", equipo: "groups", web: "language" };

/**
 * La cinta: el resto de funciones (las 16 de «Y todo lo demás» + los 3 módulos
 * del trío), solo el título. Se duplica en el componente para el bucle.
 */
export const CINTA: { icono: string; label: string }[] = [
  ...GRID_FEATURES.map((f) => ({ icono: ICONO_GRID[f.title] ?? "check", label: f.title })),
  ...MODULES_TRIO.items.map((m) => ({ icono: ICONO_TRIO[m.id] ?? "check", label: m.title })),
];
