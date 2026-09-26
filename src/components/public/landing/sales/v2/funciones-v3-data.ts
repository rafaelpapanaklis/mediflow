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

/**
 * Ajuste 1 (Rafael: «hay mucho texto»): la sección se entiende mirando. Sin
 * subtítulo, sin párrafos; cada tarjeta lleva título corto + una línea de
 * cinco o seis palabras, y la web gratuita dice sus cuatro hechos como
 * píldoras con ícono. Las dos notas legales de la IA se funden en UNA línea
 * al pie (`NOTA_IA`).
 */
export const FUNCIONES_V3_HEADER = {
  eyebrow: FUNCIONES_HEADER.eyebrow,
  title: FUNCIONES_HEADER.title,
};

export const PAGINA_WEB = {
  title: "Tu página web, gratis",
  linea: "Tus pacientes agendan desde tu web y la cita cae en tu agenda.",
  /** Los cuatro hechos de Rafael, en dos o tres palabras cada uno. */
  hechos: [
    { icono: "dashboard_customize", label: "8 plantillas" },
    { icono: "edit", label: "100 % personalizable" },
    { icono: "language", label: "Agendan desde tu web" },
    { icono: "calendar_month", label: "La cita cae en tu agenda" },
  ],
  cta: "Ver planes",
  href: "#precios",
};

/** Una línea por tarjeta estrella (recorte de la descripción de siempre). */
export const LINEA: Record<string, string> = {
  "whatsapp-ia": "Agenda citas 24/7 y redacta notas",
  agenda: "Recordatorios que sí leen",
  cbct: "DICOM y STL, en tu navegador",
  finanzas: "Del presupuesto a la factura",
};

/** Las dos notas legales de la IA (FUNCIONES cbct + whatsapp-ia), en una línea. */
export const NOTA_IA = "La IA asiste; la lectura, el diagnóstico y el criterio clínico son siempre del doctor.";

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

export const REJILLA_TITULO = "Y también";

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
];
