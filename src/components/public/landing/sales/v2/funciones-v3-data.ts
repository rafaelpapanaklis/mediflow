import { FUNCIONES, FUNCIONES_HEADER, type Funcion } from "./landing-data";

/**
 * «Funciones» v3 (rediseño 25-sep-2026): bento de 5 tarjetas + rejilla de
 * íconos. Los textos de las tarjetas salen de `FUNCIONES` (landing-data.ts),
 * que ya confirmó Rafael; lo único nuevo es la tarjeta «Tu página web
 * gratuita», con los cuatro hechos que él dio (gratis, 8 plantillas, 100 %
 * personalizable, la cita desde la web cae sola en la agenda del panel).
 *
 * ⚠️ Aquí tampoco vive ningún precio.
 */

export const FUNCIONES_V3_HEADER = {
  eyebrow: FUNCIONES_HEADER.eyebrow,
  title: FUNCIONES_HEADER.title,
  subtitle: "Todo lo que tu clínica necesita, en un solo panel. Y tu página web, gratis.",
};

export const PAGINA_WEB = {
  title: "Tu página web gratuita",
  desc:
    "Con DaleControl tu clínica tiene su página web gratis: elige una de 8 plantillas, personalízala al 100 % y deja que tus pacientes agenden desde ahí. La cita aparece sola en la agenda de tu panel.",
  chips: ["Gratis en cualquier plan", "8 plantillas", "100 % personalizable", "Citas directo a tu agenda"],
  cta: "Ver planes",
  href: "#precios",
};

function porId(id: string): Funcion {
  const f = FUNCIONES.find((x) => x.id === id);
  if (!f) throw new Error(`Funcion «${id}» no existe en landing-data.ts`);
  return f;
}

/** Las cuatro funciones estrella del bento, en el orden en que se pintan. */
export const BENTO: { funcion: Funcion; ilustracion: "whatsapp" | "agenda" | "cbct" | "finanzas" }[] = [
  { funcion: porId("whatsapp-ia"), ilustracion: "whatsapp" },
  { funcion: porId("agenda"), ilustracion: "agenda" },
  { funcion: porId("cbct"), ilustracion: "cbct" },
  { funcion: porId("finanzas"), ilustracion: "finanzas" },
];

export const REJILLA_TITULO = "Y también, dentro del mismo panel";

/**
 * Rejilla de íconos: el resto de funciones. Cada etiqueta ya está en la
 * portada (Funciones, «Y todo lo demás», Módulos o el trío); el ícono es de
 * Material Symbols Rounded, recortado a los nombres del menú del panel
 * (`src/components/dashboard/menu-dos-niveles/iconos.ts`).
 */
export const REJILLA: { icono: string; label: string }[] = [
  { icono: "group", label: "Pacientes y expedientes" },
  { icono: "dentistry", label: "Odontograma interactivo" },
  { icono: "person", label: "Portal del paciente" },
  { icono: "summarize", label: "Facturación CFDI 4.0" },
  { icono: "folder", label: "Importa tu clínica en 1 clic" },
  { icono: "inventory_2", label: "Inventario e insumos" },
  { icono: "add_business", label: "Multi-sucursal" },
  { icono: "monitoring", label: "Reportes e indicadores" },
  { icono: "credit_card", label: "Pagos en línea" },
  { icono: "groups", label: "Equipo con roles y permisos" },
  { icono: "tv", label: "TV para sala de espera" },
  { icono: "lock", label: "2FA y bitácora de auditoría" },
];
