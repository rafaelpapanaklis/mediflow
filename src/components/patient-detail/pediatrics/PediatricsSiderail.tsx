"use client";
// Pediatrics — siderail con tutor + alergias + condiciones + consents. Spec: §1.5, §4.A.4

import { useState } from "react";
import { TutorCard } from "./cards/TutorCard";
import { AlertsCard } from "./cards/AlertsCard";
import { ConsentPendingCard } from "./cards/ConsentPendingCard";
import { GuardianDrawer } from "./drawers/GuardianDrawer";
import { ConsentModal } from "./modals/ConsentModal";
import type { GuardianRow, PediatricConsentRow } from "@/types/pediatrics";

export interface PediatricsSiderailProps {
  patientId: string;
  patientName: string;
  primaryGuardian: GuardianRow | null;
  totalGuardians: number;
  allergies: string[];
  conditions: string[];
  pendingConsents: PediatricConsentRow[];
}

export function PediatricsSiderail(props: PediatricsSiderailProps) {
  const [guardianOpen, setGuardianOpen] = useState(false);
  const [consentToSign, setConsentToSign] = useState<PediatricConsentRow | null>(null);

  return (
    <aside className="pedi-siderail" aria-label="Información lateral del paciente pediátrico">
      <TutorCard
        primary={props.primaryGuardian}
        totalGuardians={props.totalGuardians}
        onEdit={() => setGuardianOpen(true)}
      />
      <AlertsCard allergies={props.allergies} conditions={props.conditions} />
      <ConsentPendingCard
        pending={props.pendingConsents}
        onSign={(id) => {
          const c = props.pendingConsents.find((x) => x.id === id);
          if (c) setConsentToSign(c);
        }}
      />

      <GuardianDrawer
        open={guardianOpen}
        onClose={() => setGuardianOpen(false)}
        patientId={props.patientId}
      />
      {consentToSign ? (
        <ConsentModal
          open={Boolean(consentToSign)}
          onClose={() => setConsentToSign(null)}
          consentId={consentToSign.id}
          procedureLabel={labelProcedure(consentToSign.procedureType)}
          patientName={props.patientName}
          guardianName={consentToSign.guardian.fullName}
          minorAssentRequired={consentToSign.minorAssentRequired}
        />
      ) : null}
    </aside>
  );
}

function labelProcedure(p: string): string {
  const map: Record<string, string> = {
    anestesia_local: "Anestesia local",
    sedacion_consciente: "Sedación consciente",
    oxido_nitroso: "Óxido nitroso",
    extraccion: "Extracción",
    pulpotomia: "Pulpotomía",
    pulpectomia: "Pulpectomía",
    fluorizacion: "Fluorización",
    toma_impresiones: "Toma de impresiones",
    rx_intraoral: "Rx intraoral",
    otro: "Otro",
  };
  return map[p] ?? p;
}
