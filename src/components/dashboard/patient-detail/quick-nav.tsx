"use client";

import { Plus, type LucideIcon } from "lucide-react";
import type { PatientActivityCounts } from "@/lib/clinical-shared/get-patient-activity-counts";
import {
  buildPatientNavItems,
  type PatientNavItem,
  type PatientNavPediatricsConfig,
  type PatientNavSection,
} from "./patient-nav-items";
import styles from "./patient-detail.module.css";
import { useT } from "@/i18n/i18n-provider";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  badgeTone?: "neutral" | "danger" | "warning" | "success" | "brand";
  /** Item visible pero no clickable — feedback duro (ej. Pediatría con
   *  paciente adulto, LGDNNA). */
  disabled?: boolean;
  /** Texto del tooltip (`title` HTML) cuando `disabled=true`. */
  disabledReason?: string;
  /** Atenuado a opacidad reducida pero clickable — el módulo está activo
   *  para la clínica pero el paciente no tiene registros aún. Al clickar
   *  el usuario entra al tab vacío para crear el primer registro. */
  dimmed?: boolean;
  /** Pill "NUEVO" con degradado de marca (features recién lanzadas). */
  isNew?: boolean;
}

interface NavGroup {
  /** Subhead visual del grupo. Se omite cuando es `undefined`. */
  label?: string;
  items: NavItem[];
}

interface NavSection {
  label: string;
  groups: NavGroup[];
}

export type QuickNavPediatricsConfig = PatientNavPediatricsConfig;

interface QuickNavProps {
  activeTab: string;
  onSelect: (tabId: string) => void;
  counts: {
    historia?: number;
    odontograma?: number;
    historialConsultas?: number;
    evolucion?: number;
    radiografias?: number;
    fotos?: number;
    tratamiento?: number;
    referencias?: number;
    agenda?: number;
    facturacion?: number;
    pediatria?: number;
    periodoncia?: number;
    endodoncia?: number;
    implantes?: number;
    ortodoncia?: number;
  };
  hasBalance: boolean;
  /** Pediatría tiene tres estados — ver `derivePediatricsTabState`. */
  pediatrics?: QuickNavPediatricsConfig;
  showPeriodontics?: boolean;
  /** Endodoncia — visible cuando la clínica tiene el módulo activo. Sin
   *  estado disabled (a diferencia de Pediatría): el componente del tab
   *  maneja el caso del paciente sin tratamientos endo. */
  showEndodontics?: boolean;
  /** Implantes — visible cuando la clínica tiene el módulo activo. */
  showImplants?: boolean;
  /** Ortodoncia — visible cuando la clínica tiene el módulo activo. */
  showOrthodontics?: boolean;
  /** Conteo por módulo del paciente actual. Cuando una key vale 0 el ítem
   *  de especialidad se renderiza atenuado (no escondido) para
   *  des-priorizarlo sin perder la posibilidad de entrar a crear el
   *  primer registro. */
  activityCounts?: PatientActivityCounts;
}

export function QuickNav({
  activeTab,
  onSelect,
  counts,
  hasBalance,
  pediatrics,
  showPeriodontics,
  showEndodontics,
  showImplants,
  showOrthodontics,
  activityCounts,
}: QuickNavProps) {
  const t = useT();

  // Lista canónica compartida con la tab bar móvil — ver patient-nav-items.ts.
  // Aquí solo se enriquece con presentación propia del QuickNav (labels
  // traducidos, counts, tono del badge, atenuado "dimmed").
  const navItems = buildPatientNavItems({
    pediatrics:       pediatrics ?? { state: "hidden" },
    showPeriodontics: Boolean(showPeriodontics),
    showEndodontics:  Boolean(showEndodontics),
    showImplants:     Boolean(showImplants),
    showOrthodontics: Boolean(showOrthodontics),
  });

  const countFor: Record<string, number | undefined> = {
    historia:              counts.historia,
    "historial-consultas": counts.historialConsultas,
    odontograma:           counts.odontograma,
    radiografias:          counts.radiografias,
    fotos:                 counts.fotos,
    tratamiento:           counts.tratamiento,
    referencias:           counts.referencias,
    agenda:                counts.agenda,
    facturacion:           counts.facturacion,
    periodoncia:           counts.periodoncia,
    endodoncia:            counts.endodoncia,
    implantes:             counts.implantes,
    ortodoncia:            counts.ortodoncia,
  };

  const toNavItem = (item: PatientNavItem): NavItem => {
    const navItem: NavItem = {
      id:             item.id,
      label:          t(item.labelKey),
      icon:           item.icon,
      count:          countFor[item.id],
      disabled:       item.disabled,
      disabledReason: item.disabledReason,
      isNew:          item.isNew,
    };
    if (item.section === "dental") {
      navItem.badgeTone = "brand";
      navItem.dimmed = false;
    }
    if (item.id === "pediatria") {
      // Cuando el paciente no tiene registros en el módulo (`count === 0`) se
      // atenúa pero NO se esconde — el ítem queda clickable para entrar al
      // empty state del tab y crear el primer registro.
      const count = activityCounts?.pediatria ?? counts.pediatria ?? 0;
      navItem.count = count > 0 ? count : undefined;
      navItem.dimmed =
        !item.disabled && activityCounts !== undefined && activityCounts.pediatria === 0;
    }
    if (item.id === "facturacion") {
      navItem.badgeTone = hasBalance ? "danger" : "neutral";
    }
    return navItem;
  };

  const itemsFor = (section: PatientNavSection): NavItem[] =>
    navItems.filter((i) => i.section === section).map(toNavItem);

  const specialtyItems = itemsFor("dental");
  const clinicalGroups: NavGroup[] = [{ items: itemsFor("clinico") }];
  if (specialtyItems.length > 0) {
    clinicalGroups.push({ label: t("patients.quickNav.specialties"), items: specialtyItems });
  }
  clinicalGroups.push({ items: itemsFor("imagen-docs") });

  const sections: NavSection[] = [
    { label: t("patients.quickNav.clinical"), groups: clinicalGroups },
    {
      label: t("patients.quickNav.administrative"),
      groups: [{ items: itemsFor("admin") }],
    },
  ];

  return (
    <nav className={styles.quickNav} aria-label={t("patients.quickNav.ariaLabel")}>
      {sections.map((section) => (
        <div key={section.label} className={styles.navSection}>
          <div className={styles.navSectionLabel}>{section.label}</div>
          {section.groups.map((group, groupIdx) => (
            <div key={group.label ?? `g-${groupIdx}`}>
              {group.label && (
                <div className={`${styles.navSectionLabel} ${styles.navSubhead}`}>
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const isDisabled = item.disabled === true;
                const isDimmed = item.dimmed === true && !isDisabled && !isActive;
                const classes = [
                  styles.navItem,
                  isActive   ? styles.active           : "",
                  isDisabled ? styles.navItemDisabled  : "",
                  isDimmed   ? styles.navItemDimmed    : "",
                ].filter(Boolean).join(" ");
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={classes}
                    onClick={() => { if (!isDisabled) onSelect(item.id); }}
                    disabled={isDisabled}
                    aria-disabled={isDisabled || undefined}
                    title={
                      isDisabled ? item.disabledReason :
                      isDimmed   ? t("patients.quickNav.noRecordsYet") :
                      undefined
                    }
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                    <span className={styles.navItemLabel}>{item.label}</span>
                    {item.isNew && (
                      <span className={styles.navNewBadge}>{t("patients.quickNav.newBadge")}</span>
                    )}
                    {item.count !== undefined && item.count > 0 && (
                      <span
                        className={`${styles.navItemCount} ${styles[`tone-${item.badgeTone ?? "neutral"}`] ?? ""}`}
                      >
                        {item.count}
                      </span>
                    )}
                    {isDimmed && !item.count && (
                      <Plus
                        size={14}
                        className={styles.navItemPlusIcon}
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </nav>
  );
}
