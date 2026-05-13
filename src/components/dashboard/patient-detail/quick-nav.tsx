"use client";

import {
  ClipboardList,
  History,
  Stethoscope,
  Activity,
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
  type LucideIcon,
} from "lucide-react";
import type { PatientActivityCounts } from "@/lib/clinical-shared/get-patient-activity-counts";
import styles from "./patient-detail.module.css";

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
  // Core clínico — siempre arriba. Resumen, Historia, Nueva consulta van
  // primero porque el caso de uso más frecuente no es entrar a un módulo
  // específico sino abrir el expediente.
  const coreClinicalItems: NavItem[] = [
    { id: "resumen",    label: "Resumen",          icon: ClipboardList },
    { id: "historia",   label: "Historia clínica", icon: History, count: counts.historia },
    { id: "expediente", label: "Nueva consulta",   icon: Stethoscope },
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
      label:          "Pediatría",
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
      label: "Periodoncia",
      icon: HeartPulse,
      count: counts.periodoncia,
      badgeTone: "brand",
      dimmed: activityCounts !== undefined && activityCounts.periodoncia === 0,
    });
  }
  if (showEndodontics) {
    specialtyItems.push({
      id: "endodoncia",
      label: "Endodoncia",
      icon: Zap,
      count: counts.endodoncia,
      badgeTone: "brand",
      dimmed: activityCounts !== undefined && activityCounts.endodoncia === 0,
    });
  }
  if (showImplants) {
    specialtyItems.push({
      id: "implantes",
      label: "Implantes",
      icon: Anchor,
      count: counts.implantes,
      badgeTone: "brand",
      dimmed: activityCounts !== undefined && activityCounts.implantes === 0,
    });
  }
  if (showOrthodontics) {
    specialtyItems.push({
      id: "ortodoncia",
      label: "Ortodoncia",
      icon: Smile,
      count: counts.ortodoncia,
      badgeTone: "brand",
      dimmed: activityCounts !== undefined && activityCounts.ortodoncia === 0,
    });
  }

  // Resto del bloque clínico — herramientas transversales que aplican a
  // cualquier módulo (odontograma, notas, radiografías, plan,
  // referencias).
  const otherClinicalItems: NavItem[] = [
    { id: "odontograma",  label: "Odontograma",      icon: Bone,         count: counts.odontograma },
    { id: "evolucion",    label: "Notas SOAP",       icon: Activity,     count: counts.evolucion },
    { id: "radiografias", label: "Radiografías",     icon: FileImage,    count: counts.radiografias },
    { id: "tratamiento",  label: "Plan tratamiento", icon: Pill,         count: counts.tratamiento },
    { id: "referencias",  label: "Referencias",      icon: ArrowUpRight, count: counts.referencias },
  ];

  const clinicalGroups: NavGroup[] = [{ items: coreClinicalItems }];
  if (specialtyItems.length > 0) {
    clinicalGroups.push({ label: "ESPECIALIDADES", items: specialtyItems });
  }
  clinicalGroups.push({ items: otherClinicalItems });

  const sections: NavSection[] = [
    { label: "Clínico", groups: clinicalGroups },
    {
      label: "Administrativo",
      groups: [{
        items: [
          { id: "agenda",      label: "Citas",       icon: Calendar,    count: counts.agenda },
          {
            id: "facturacion",
            label: "Facturación",
            icon: CreditCard,
            count: counts.facturacion,
            badgeTone: hasBalance ? "danger" : "neutral",
          },
        ],
      }],
    },
  ];

  return (
    <nav className={styles.quickNav} aria-label="Navegación rápida del paciente">
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
                      isDimmed   ? "Sin registros aún en este módulo" :
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
