// Pediatrics — Card del tutor principal con WhatsApp + INE. Spec: §1.5.1, §4.A.8

import { MessageCircle, Phone, Mail, Pencil, ShieldCheck, AlertTriangle } from "lucide-react";
import type { GuardianRow } from "@/types/pediatrics";

export interface TutorCardProps {
  primary: GuardianRow | null;
  totalGuardians: number;
  onEdit?: () => void;
}

export function TutorCard(props: TutorCardProps) {
  const { primary, totalGuardians, onEdit } = props;

  if (!primary) {
    return (
      <div className="pedi-card">
        <h3 className="pedi-card__title">Tutor principal</h3>
        <p className="pedi-card__empty">Aún no hay tutor registrado para este menor.</p>
      </div>
    );
  }

  const initials = primary.fullName.split(" ").slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase();
  const ineOk = Boolean(primary.ineUrl);
  const wa = `https://wa.me/${cleanPhone(primary.phone)}`;

  return (
    <div className="pedi-card pedi-tutor-card">
      <div className="pedi-card__title-row">
        <h3 className="pedi-card__title">Tutor principal</h3>
        {totalGuardians > 1 ? (
          <span className="pedi-tutor-card__badge">+{totalGuardians - 1}</span>
        ) : null}
      </div>
      <div className="pedi-tutor-card__main">
        <div className="pedi-tutor-card__avatar" aria-hidden>{initials}</div>
        <div className="pedi-tutor-card__name-block">
          <div className="pedi-tutor-card__name">{primary.fullName}</div>
          <div className="pedi-tutor-card__role">
            {labelParentesco(primary.parentesco)}
            {ineOk ? (
              <span className="pedi-tutor-card__ine pedi-tutor-card__ine--ok"><ShieldCheck size={12} aria-hidden /> INE</span>
            ) : (
              <span className="pedi-tutor-card__ine pedi-tutor-card__ine--pending"><AlertTriangle size={12} aria-hidden /> INE pendiente</span>
            )}
          </div>
        </div>
      </div>
      <div className="pedi-tutor-card__contact">
        <a href={`tel:${cleanPhone(primary.phone)}`} aria-label="Llamar al tutor"><Phone size={12} aria-hidden /> {primary.phone}</a>
        {primary.email ? (
          <a href={`mailto:${primary.email}`}><Mail size={12} aria-hidden /> {primary.email}</a>
        ) : null}
      </div>
      <div className="pedi-tutor-card__actions">
        <a className="pedi-btn pedi-btn--brand" href={wa} target="_blank" rel="noopener noreferrer">
          <MessageCircle size={14} aria-hidden /> WhatsApp
        </a>
        {onEdit ? (
          <button type="button" className="pedi-btn" onClick={onEdit}>
            <Pencil size={14} aria-hidden /> Editar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function labelParentesco(p: string): string {
  const map: Record<string, string> = {
    madre: "Madre", padre: "Padre", tutor_legal: "Tutor legal",
    abuelo: "Abuelo", abuela: "Abuela", tio: "Tío", tia: "Tía",
    hermano: "Hermano", hermana: "Hermana", otro: "Otro",
  };
  return map[p] ?? p;
}
