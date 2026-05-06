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
  type LucideIcon,
} from "lucide-react";
import styles from "./patient-detail.module.css";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  badgeTone?: "neutral" | "danger" | "warning" | "success" | "brand";
  /** Item visible pero no clickable. Sirve de feedback cuando el módulo
   *  del marketplace está activo pero el paciente no califica. */
  disabled?: boolean;
  /** Texto del tooltip (`title` HTML) cuando `disabled=true`. */
  disabledReason?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
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
    agenda?: number;
    facturacion?: number;
    pediatria?: number;
    periodoncia?: number;
  };
  hasBalance: boolean;
  /** Pediatría tiene tres estados — ver `derivePediatricsTabState`. */
  pediatrics?: QuickNavPediatricsConfig;
  showPeriodontics?: boolean;
}

export function QuickNav({
  activeTab,
  onSelect,
  counts,
  hasBalance,
  pediatrics,
  showPeriodontics,
}: QuickNavProps) {
  const clinicItems: NavItem[] = [
    { id: "resumen",      label: "Resumen",         icon: ClipboardList },
    { id: "historia",     label: "Historia clínica", icon: History, count: counts.historia },
  ];
  if (pediatrics && pediatrics.state !== "hidden") {
    clinicItems.push({
      id:             "pediatria",
      label:          "Pediatría",
      icon:           Baby,
      count:          counts.pediatria,
      badgeTone:      "brand",
      disabled:       pediatrics.state === "disabled",
      disabledReason: pediatrics.state === "disabled" ? pediatrics.reason : undefined,
    });
  }
  if (showPeriodontics) {
    clinicItems.push({
      id: "periodoncia",
      label: "Periodoncia",
      icon: HeartPulse,
      count: counts.periodoncia,
      badgeTone: "brand",
    });
  }
  clinicItems.push(
    { id: "odontograma",  label: "Odontograma",     icon: Bone, count: counts.odontograma },
    { id: "expediente",   label: "Nueva consulta",  icon: Stethoscope },
    { id: "evolucion",    label: "Notas SOAP",      icon: Activity, count: counts.evolucion },
    { id: "radiografias", label: "Radiografías",    icon: FileImage, count: counts.radiografias },
    { id: "tratamiento",  label: "Plan tratamiento", icon: Pill, count: counts.tratamiento },
  );

  const sections: NavSection[] = [
    { label: "Clínico", items: clinicItems },
    {
      label: "Administrativo",
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
    },
  ];

  return (
    <nav className={styles.quickNav} aria-label="Navegación rápida del paciente">
      {sections.map((section) => (
        <div key={section.label} className={styles.navSection}>
          <div className={styles.navSectionLabel}>{section.label}</div>
          {section.items.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isDisabled = item.disabled === true;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.navItem} ${isActive ? styles.active : ""} ${isDisabled ? styles.navItemDisabled : ""}`}
                onClick={() => { if (!isDisabled) onSelect(item.id); }}
                disabled={isDisabled}
                aria-disabled={isDisabled || undefined}
                title={isDisabled ? item.disabledReason : undefined}
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
    </nav>
  );
}
