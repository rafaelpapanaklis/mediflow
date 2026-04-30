"use client";
// Pediatrics — card visual para la lista de Odontopediatría. Spec: §7 (sprint 2)

import Link from "next/link";
import { AlertTriangle, Calendar, MessageCircle } from "lucide-react";
import type { CambraCategory } from "@/lib/pediatrics/cambra";
import type { DentitionType } from "@/lib/pediatrics/dentition";

export interface PediatricPatientCardData {
  id: string;
  fullName: string;
  ageFormatted: string;
  ageDecimal: number;
  dentition: DentitionType;
  cambraCategory: CambraCategory | null;
  latestFranklValue: number | null;
  primaryGuardianName: string | null;
  primaryGuardianPhone: string | null;
  hasPediatricRecord: boolean;
  nextAppointmentLabel: string | null;
}

export interface PediatricPatientCardProps {
  patient: PediatricPatientCardData;
}

export function PediatricPatientCard({ patient }: PediatricPatientCardProps) {
  const initials = patient.fullName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <Link
      href={`/dashboard/specialties/pediatrics/${patient.id}`}
      className="ped-list-card"
      aria-label={`Ver expediente pediátrico de ${patient.fullName}`}
    >
      <div className="ped-list-card__header">
        <div className="ped-list-card__avatar" aria-hidden>{initials || "?"}</div>
        <div className="ped-list-card__title-block">
          <div className="ped-list-card__name">{patient.fullName}</div>
          <div className="ped-list-card__meta">
            <span className="ped-list-card__age">{patient.ageFormatted}</span>
            <span className="ped-list-card__dot" aria-hidden>·</span>
            <span className="ped-list-card__dentition">Dentición {patient.dentition}</span>
          </div>
        </div>
      </div>

      <div className="ped-list-card__chips">
        {patient.cambraCategory ? (
          <span className={`cambra-chip cambra-chip--${patient.cambraCategory}`}>
            <span className="cambra-chip__dot" aria-hidden />
            CAMBRA {patient.cambraCategory}
          </span>
        ) : null}
        {patient.latestFranklValue ? (
          <span className="ped-list-card__frankl-block">
            Frankl
            <span className={`frankl-pill frankl-pill--${patient.latestFranklValue} ped-list-card__frankl-pill`}>
              {patient.latestFranklValue}
            </span>
          </span>
        ) : null}
        {!patient.hasPediatricRecord ? (
          <span className="ped-list-card__missing-record">
            <AlertTriangle size={11} aria-hidden /> Sin expediente pediátrico
          </span>
        ) : null}
      </div>

      <div className="ped-list-card__rows">
        {patient.nextAppointmentLabel ? (
          <div className="ped-list-card__row">
            <Calendar size={12} aria-hidden />
            <span>{patient.nextAppointmentLabel}</span>
          </div>
        ) : null}
        {patient.primaryGuardianName ? (
          <div className="ped-list-card__row">
            <MessageCircle size={12} aria-hidden />
            <span>{patient.primaryGuardianName}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
