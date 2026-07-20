import {
  ClipboardList,
  History,
  ClipboardCheck,
  Stethoscope,
  HeartPulse,
  FileImage,
  Camera,
  Upload,
  Pill,
  Calendar,
  CreditCard,
  Bone,
  Baby,
  Zap,
  Anchor,
  Smile,
  ArrowUpRight,
  Box,
  FileText,
  Receipt,
  type LucideIcon,
} from "lucide-react";

/** Sección visual del item. QuickNav (escritorio) las renderiza como grupos
 *  con subhead ("clinico"+"dental"+"imagen-docs" bajo CLÍNICO, "admin" bajo
 *  ADMINISTRATIVO); la tab bar móvil las ignora (lista plana) pero conserva
 *  el mismo orden. */
export type PatientNavSection = "clinico" | "dental" | "imagen-docs" | "admin";

/** Pediatría tiene tres estados — ver `derivePediatricsTabState`. */
export interface PatientNavPediatricsConfig {
  state: "enabled" | "disabled" | "hidden";
  reason?: string;
}

export interface PatientNavItem {
  id: string;
  /** Key i18n `patients.tabs.*` — misma etiqueta en escritorio y móvil. */
  labelKey: string;
  icon: LucideIcon;
  section: PatientNavSection;
  /** Item visible pero no clickable — feedback duro (ej. Pediatría con
   *  paciente adulto por LGDNNA, o especialidades "Próximamente"). */
  disabled?: boolean;
  /** Texto del tooltip (`title` HTML) cuando `disabled=true`. */
  disabledReason?: string;
}

export interface BuildPatientNavOpts {
  pediatrics: PatientNavPediatricsConfig;
  /** Periodoncia hoy solo enabled/hidden — no tiene gate clínico extra. */
  showPeriodontics: boolean;
  showEndodontics: boolean;
  showImplants: boolean;
  showOrthodontics: boolean;
}

/**
 * ÚNICA fuente de verdad del menú de secciones de la ficha del paciente.
 * La consumen QuickNav (escritorio, agrupado por `section`) y la tab bar
 * móvil de patient-detail-client (lista plana, chips disabled al final).
 * Cualquier alta/baja/reorden de items se hace AQUÍ — mantener dos listas
 * a mano fue lo que hizo divergir escritorio y móvil.
 */
export function buildPatientNavItems(opts: BuildPatientNavOpts): PatientNavItem[] {
  // Core clínico — Resumen, Historia y Nueva consulta van primero porque el
  // caso de uso más frecuente no es entrar a un módulo específico sino abrir
  // el expediente.
  const items: PatientNavItem[] = [
    { id: "resumen",             labelKey: "patients.tabs.resumen",            icon: ClipboardList,  section: "clinico" },
    { id: "historia",            labelKey: "patients.tabs.historia",           icon: History,        section: "clinico" },
    { id: "cuestionario",        labelKey: "patients.tabs.cuestionario",       icon: ClipboardCheck, section: "clinico" },
    { id: "expediente",          labelKey: "patients.tabs.expediente",         icon: Stethoscope,    section: "clinico" },
    { id: "historial-consultas", labelKey: "patients.tabs.historialConsultas", icon: ClipboardList,  section: "clinico" },
  ];

  // Especialidades — visibles según gating por módulo activo en la clínica.
  if (opts.pediatrics.state !== "hidden") {
    const isDisabled = opts.pediatrics.state === "disabled";
    items.push({
      id:             "pediatria",
      labelKey:       "patients.tabs.pediatria",
      icon:           Baby,
      section:        "dental",
      disabled:       isDisabled,
      disabledReason: isDisabled ? opts.pediatrics.reason : undefined,
    });
  }
  // Próximamente: deshabilitadas (no clickeables), igual que Pediatría disabled.
  if (opts.showPeriodontics) items.push({ id: "periodoncia", labelKey: "patients.tabs.periodoncia", icon: HeartPulse, section: "dental", disabled: true, disabledReason: "Próximamente" });
  if (opts.showEndodontics)  items.push({ id: "endodoncia",  labelKey: "patients.tabs.endodoncia",  icon: Zap,        section: "dental", disabled: true, disabledReason: "Próximamente" });
  if (opts.showImplants)     items.push({ id: "implantes",   labelKey: "patients.tabs.implantes",   icon: Anchor,     section: "dental", disabled: true, disabledReason: "Próximamente" });
  if (opts.showOrthodontics) items.push({ id: "ortodoncia",  labelKey: "patients.tabs.ortodoncia",  icon: Smile,      section: "dental", disabled: true, disabledReason: "Próximamente" });

  items.push(
    // Herramientas transversales — imagen, documentos y plan.
    { id: "odontograma",  labelKey: "patients.tabs.odontograma",  icon: Bone,         section: "imagen-docs" },
    { id: "radiografias", labelKey: "patients.tabs.radiografias", icon: FileImage,    section: "imagen-docs" },
    // Fotos clínicas (ficha v3) — extraorales/intraorales por etapa,
    // módulo ClinicalPhoto `general`. Junto a Radiografías por afinidad.
    { id: "fotos",        labelKey: "patients.tabs.fotos",        icon: Camera,       section: "imagen-docs" },
    { id: "subidos",      labelKey: "patients.tabs.subidos",      icon: Upload,       section: "imagen-docs" },
    { id: "modelos-3d",   labelKey: "patients.tabs.modelos3d",    icon: Box,          section: "imagen-docs" },
    { id: "tratamiento",  labelKey: "patients.tabs.tratamiento",  icon: Pill,         section: "imagen-docs" },
    { id: "recetas",      labelKey: "patients.tabs.recetas",      icon: FileText,     section: "imagen-docs" },
    { id: "referencias",  labelKey: "patients.tabs.referencias",  icon: ArrowUpRight, section: "imagen-docs" },
    // Administrativo.
    { id: "agenda",       labelKey: "patients.tabs.agenda",       icon: Calendar,     section: "admin" },
    { id: "presupuestos", labelKey: "patients.tabs.presupuestos", icon: Receipt,      section: "admin" },
    { id: "facturacion",  labelKey: "patients.tabs.facturacion",  icon: CreditCard,   section: "admin" },
  );

  return items;
}
