"use client";

import {
  ClipboardList,
  History,
  Stethoscope,
  HeartPulse,
  FileImage,
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
  Plus,
  ClipboardCheck,
  FileText,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import type { PatientActivityCounts } from "@/lib/clinical-shared/get-patient-activity-counts";
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

export interface QuickNavPediatricsConfig {
  state: "enabled" | "disabled" | "hidden";
  reason?: string;
}

interface QuickNavProps {
  activeTab: string;
  onSelect: (tabId: string) => void;
  counts: {
    historia?: number;
    odontograma?: number;
    historialConsultas?: number;
    evolucion?: number;
    radiografias?: number;
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
  // Core clínico — siempre arriba. Resumen, Historia, Nueva consulta van
  // primero porque el caso de uso más frecuente no es entrar a un módulo
  // específico sino abrir el expediente.
  const coreClinicalItems: NavItem[] = [
    { id: "resumen",    label: t("patients.quickNav.summary"),          icon: ClipboardList },
    { id: "historia",   label: t("patients.quickNav.clinicalHistory"), icon: History, count: counts.historia },
    { id: "cuestionario", label: t("patients.tabs.cuestionario"), icon: ClipboardCheck },
    { id: "expediente", label: t("patients.quickNav.newConsultation"),   icon: Stethoscope },
    { id: "historial-consultas", label: t("patients.quickNav.consultationHistory"), icon: ClipboardList, count: counts.historialConsultas },
  ];

  // Especialidades — visibles según gating por módulo activo en la clínica.
  // Cuando el paciente no tiene registros en el módulo (`count === 0`) se
  // atenúan pero NO se esconden — el ítem queda clickable para entrar al
  // empty state del tab y crear el primer registro.
  const specialtyItems: NavItem[] = [];
  if (pediatrics && pediatrics.state !== "hidden") {
    const isDisabled = pediatrics.state === "disabled";
    const count = activityCounts?.pediatria ?? counts.pediatria ?? 0;
    specialtyItems.push({
      id:             "pediatria",
      label:          t("patients.quickNav.pediatrics"),
      icon:           Baby,
      count:          count > 0 ? count : undefined,
      badgeTone:      "brand",
      disabled:       isDisabled,
      disabledReason: isDisabled ? pediatrics.reason : undefined,
      dimmed:         !isDisabled && activityCounts !== undefined && activityCounts.pediatria === 0,
    });
  }
  if (showPeriodontics) {
    specialtyItems.push({
      id: "periodoncia",
      label: t("patients.quickNav.periodontics"),
      icon: HeartPulse,
      count: counts.periodoncia,
      badgeTone: "brand",
      disabled: true,
      disabledReason: "Próximamente",
      dimmed: false,
    });
  }
  if (showEndodontics) {
    specialtyItems.push({
      id: "endodoncia",
      label: t("patients.quickNav.endodontics"),
      icon: Zap,
      count: counts.endodoncia,
      badgeTone: "brand",
      disabled: true,
      disabledReason: "Próximamente",
      dimmed: false,
    });
  }
  if (showImplants) {
    specialtyItems.push({
      id: "implantes",
      label: t("patients.quickNav.implants"),
      icon: Anchor,
      count: counts.implantes,
      badgeTone: "brand",
      disabled: true,
      disabledReason: "Próximamente",
      dimmed: false,
    });
  }
  if (showOrthodontics) {
    specialtyItems.push({
      id: "ortodoncia",
      label: t("patients.quickNav.orthodontics"),
      icon: Smile,
      count: counts.ortodoncia,
      badgeTone: "brand",
      disabled: true,
      disabledReason: "Próximamente",
      dimmed: false,
    });
  }

  // Resto del bloque clínico — herramientas transversales que aplican a
  // cualquier módulo (odontograma, notas, radiografías, plan,
  // referencias).
  const otherClinicalItems: NavItem[] = [
    { id: "odontograma",  label: t("patients.quickNav.odontogram"),      icon: Bone,         count: counts.odontograma },
    { id: "radiografias", label: t("patients.quickNav.xrays"),     icon: FileImage,    count: counts.radiografias },
    { id: "modelos-3d",   label: t("patients.tabs.modelos3d"),     icon: Box },
    { id: "tratamiento",  label: t("patients.quickNav.treatmentPlan"), icon: Pill,         count: counts.tratamiento },
    { id: "recetas",      label: t("patients.tabs.recetas"),        icon: FileText },
    { id: "referencias",  label: t("patients.quickNav.referrals"),      icon: ArrowUpRight, count: counts.referencias },
  ];

  const clinicalGroups: NavGroup[] = [{ items: coreClinicalItems }];
  if (specialtyItems.length > 0) {
    clinicalGroups.push({ label: t("patients.quickNav.specialties"), items: specialtyItems });
  }
  clinicalGroups.push({ items: otherClinicalItems });

  const sections: NavSection[] = [
    { label: t("patients.quickNav.clinical"), groups: clinicalGroups },
    {
      label: t("patients.quickNav.administrative"),
      groups: [{
        items: [
          { id: "agenda",      label: t("patients.quickNav.appointments"),       icon: Calendar,    count: counts.agenda },
          { id: "presupuestos", label: t("patients.tabs.presupuestos"), icon: Receipt },
          {
            id: "facturacion",
            label: t("patients.quickNav.billing"),
            icon: CreditCard,
            count: counts.facturacion,
            badgeTone: hasBalance ? "danger" : "neutral",
          },
        ],
      }],
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
                    <Icon size={14} aria-hidden />
                    <span className={styles.navItemLabel}>{item.label}</span>
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
