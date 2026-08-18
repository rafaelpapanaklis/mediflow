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
  FileSignature,
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
  /**
   * Key i18n `patients.tabsShort.*` — etiqueta abreviada EXCLUSIVA de la barra
   * horizontal (`patient-nav-bar`), donde el ancho es el recurso escaso y
   * "Historial de consultas" se comía el espacio de dos items. El resto de
   * superficies (tab bar móvil, quick-nav vertical) siguen usando `labelKey`,
   * y la barra la expone completa en el `title`/tooltip: acortar es una
   * decisión de PRESENTACIÓN, no un renombre del módulo.
   * `undefined` = el label completo ya es corto y se usa tal cual.
   */
  shortLabelKey?: string;
  icon: LucideIcon;
  section: PatientNavSection;
  /** Item visible pero no clickable — feedback duro (ej. Pediatría con
   *  paciente adulto por LGDNNA, o especialidades "Próximamente"). */
  disabled?: boolean;
  /** Texto del tooltip (`title` HTML) cuando `disabled=true`. */
  disabledReason?: string;
  /** Pill "NUEVO" con degradado de marca (features recién lanzadas). */
  isNew?: boolean;
}

export interface BuildPatientNavOpts {
  pediatrics: PatientNavPediatricsConfig;
  /** Periodoncia hoy solo enabled/hidden — no tiene gate clínico extra. */
  showPeriodontics: boolean;
  showEndodontics: boolean;
  showImplants: boolean;
  showOrthodontics: boolean;
  /**
   * Facturación — requiere el permiso UI "billing.view" (el mismo que gatea
   * Caja). `false` la saca del menú por completo; `undefined` la deja visible
   * para no cambiar el comportamiento de callers que no la gatean.
   * Lo resuelve el server (page.tsx con hasPermission) y baja como prop: el
   * cliente NO lo deduce del rol, porque el permiso es configurable persona a
   * persona desde el modal de equipo.
   */
  showBilling?: boolean;
  /**
   * Consentimientos informados — requiere el permiso UI "consents.view".
   * Mismo mecanismo que `showBilling`: `false` la saca del menú por completo;
   * `undefined` la deja visible para no cambiar el comportamiento de callers
   * que no la gatean. Lo resuelve el server (page.tsx con hasPermission) y baja
   * como prop — el cliente NO lo deduce del rol.
   */
  showConsents?: boolean;
  /**
   * Radiografías — requiere "xrays.view" (EQ-07). Mismo mecanismo que
   * `showBilling`: `false` saca la pestaña; GET /api/xrays revalida con 403.
   */
  showXrays?: boolean;
  /**
   * Recetas — requiere "prescription.view" (ISO-03). Antes la pestaña salía
   * para todos y recepción/solo-lectura la abrían para recibir un 403.
   */
  showPrescriptions?: boolean;
}

/**
 * Especialidades OCULTAS del menú de la ficha. Rafael las quiere fuera por
 * completo mientras los módulos no estén listos (antes salían como chips
 * `disabled: "Próximamente"`). Se filtran al final de `buildPatientNavItems`,
 * así que desaparecen a la vez del QuickNav (escritorio) y de la tab bar móvil
 * —ambos consumen esta única función— sin dejar subhead "ESPECIALIDADES" vacío
 * (QuickNav ya lo condiciona a que haya items). Para REACTIVAR una, quítala de
 * este set: no hay que tocar nada más.
 */
const HIDDEN_SPECIALTY_IDS = new Set<string>([
  "pediatria",
  "periodoncia",
  "endodoncia",
  "ortodoncia",
]);

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
    { id: "cuestionario",        labelKey: "patients.tabs.cuestionario",       shortLabelKey: "patients.tabsShort.cuestionario",       icon: ClipboardCheck, section: "clinico" },
    { id: "expediente",          labelKey: "patients.tabs.expediente",         icon: Stethoscope,    section: "clinico" },
    { id: "historial-consultas", labelKey: "patients.tabs.historialConsultas", shortLabelKey: "patients.tabsShort.historialConsultas", icon: ClipboardList,  section: "clinico" },
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
    { id: "fotos",        labelKey: "patients.tabs.fotos",        icon: Camera,       section: "imagen-docs", isNew: true },
    { id: "subidos",      labelKey: "patients.tabs.subidos",      shortLabelKey: "patients.tabsShort.subidos",     icon: Upload,       section: "imagen-docs" },
    { id: "modelos-3d",   labelKey: "patients.tabs.modelos3d",    icon: Box,          section: "imagen-docs" },
    { id: "tratamiento",  labelKey: "patients.tabs.tratamiento",  shortLabelKey: "patients.tabsShort.tratamiento", icon: Pill,         section: "imagen-docs" },
    { id: "recetas",      labelKey: "patients.tabs.recetas",      icon: FileText,     section: "imagen-docs" },
    { id: "consentimientos", labelKey: "patients.tabs.consentimientos", shortLabelKey: "patients.tabsShort.consentimientos", icon: FileSignature, section: "imagen-docs", isNew: true },
    { id: "referencias",  labelKey: "patients.tabs.referencias",  icon: ArrowUpRight, section: "imagen-docs" },
    // Administrativo.
    { id: "agenda",       labelKey: "patients.tabs.agenda",       icon: Calendar,     section: "admin" },
    { id: "presupuestos", labelKey: "patients.tabs.presupuestos", icon: Receipt,      section: "admin" },
    { id: "facturacion",  labelKey: "patients.tabs.facturacion",  icon: CreditCard,   section: "admin" },
  );

  // Filtro final — especialidades ocultas (ver HIDDEN_SPECIALTY_IDS) y
  // Facturación sin permiso "billing.view". Al hacerlo aquí, escritorio y móvil
  // quedan sincronizados y no se cuela ningún count ni subhead colgando.
  const hideBilling = opts.showBilling === false;
  const hideConsents = opts.showConsents === false;
  const hideXrays = opts.showXrays === false;
  const hidePrescriptions = opts.showPrescriptions === false;
  return items.filter(
    (i) =>
      !HIDDEN_SPECIALTY_IDS.has(i.id) &&
      !(hideBilling && i.id === "facturacion") &&
      !(hideConsents && i.id === "consentimientos") &&
      !(hideXrays && i.id === "radiografias") &&
      !(hidePrescriptions && i.id === "recetas"),
  );
}
