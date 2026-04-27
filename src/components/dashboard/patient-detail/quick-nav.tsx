"use client";

import {
  ClipboardList,
  History,
  Stethoscope,
  Activity,
  FileImage,
  Pill,
  Calendar,
  CreditCard,
  Bone,
  type LucideIcon,
} from "lucide-react";
import styles from "./patient-detail.module.css";

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  count?: number;
  badgeTone?: "neutral" | "danger" | "warning" | "success" | "brand";
}

interface NavSection {
  label: string;
  items: NavItem[];
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
  };
  hasBalance: boolean;
}

export function QuickNav({ activeTab, onSelect, counts, hasBalance }: QuickNavProps) {
  const sections: NavSection[] = [
    {
      label: "Clínico",
      items: [
        { id: "resumen",      label: "Resumen",         icon: ClipboardList },
        { id: "historia",     label: "Historia clínica", icon: History, count: counts.historia },
        { id: "odontograma",  label: "Odontograma",     icon: Bone, count: counts.odontograma },
        { id: "expediente",   label: "Nueva consulta",  icon: Stethoscope },
        { id: "evolucion",    label: "Notas SOAP",      icon: Activity, count: counts.evolucion },
        { id: "radiografias", label: "Radiografías",    icon: FileImage, count: counts.radiografias },
        { id: "tratamiento",  label: "Plan tratamiento", icon: Pill, count: counts.tratamiento },
      ],
    },
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
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.navItem} ${isActive ? styles.active : ""}`}
                onClick={() => onSelect(item.id)}
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
