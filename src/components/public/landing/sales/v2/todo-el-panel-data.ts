import { GRID_FEATURES, GRID_TITLE, MODULES_TRIO } from "./landing-data";

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
  /**
   * Los vídeos de la laptop, que se alternan (añadido 2b de Rafael). `ve` es
   * lo que enseñan (aria-label y reporte).
   */
  videos: [
    { src: "/landing/videos/panel-recorrido.mp4", poster: "/landing/videos/panel-recorrido.webp" },
    { src: "/landing/videos/panel-recorrido-2.mp4", poster: "/landing/videos/panel-recorrido-2.webp" },
  ],
  ve: "Recorrido por el panel real: Página web con la plantilla Especialistas, Equipo y sus permisos, Finanzas; Mi Clínica Visual en 3D y el portal del paciente.",
};

export interface TarjetaPanel {
  /** Ícono de Material Symbols Rounded (recorte del menú del panel). */
  icono: string;
  /** Dos o tres palabras. */
  label: string;
  /** Lado en escritorio: 4 a la izquierda y 4 a la derecha de la laptop. */
  lado: "izq" | "der";
}

/** Las 8 tarjetas flotantes: los 8 módulos (los mismos que tenían página en «Conoce cada módulo»). */
export const TARJETAS: TarjetaPanel[] = [
  { icono: "calendar_month", label: "Agenda + WhatsApp", lado: "izq" },
  { icono: "assignment", label: "Expediente y odontograma", lado: "izq" },
  { icono: "person", label: "Portal del paciente", lado: "izq" },
  { icono: "point_of_sale", label: "Caja y cobros", lado: "izq" },
  { icono: "summarize", label: "Facturación CFDI", lado: "der" },
  { icono: "dentistry", label: "Radiografías 3D y CBCT", lado: "der" },
  { icono: "monitoring", label: "Reportes e indicadores", lado: "der" },
  { icono: "add_business", label: "Multi-sede y roles", lado: "der" },
];

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
