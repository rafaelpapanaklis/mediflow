"use client";
// Aviso de datos incompletos en la carta de consentimiento.
//
// Hoy casi ninguna clínica tiene dirección, logo, cédula o especialidad
// capturados, y dos de cada tres pacientes no tienen CURP: la carta sale con
// rayas para llenar a mano. Este aviso lo dice ANTES de crear el documento y
// lleva el enlace al sitio donde se captura cada dato.
//
// Es un aviso, NO un bloqueo: el botón de crear sigue activo. Una carta
// incompleta es mejor que ninguna; lo que no puede pasar es que el doctor se
// entere de lo que falta cuando el paciente ya la tiene en la mano.

import { AlertTriangle, ExternalLink } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type {
  ConsentFixPlace,
  ConsentMissingItem,
  ConsentMissingKey,
} from "@/lib/consent/document-data";

const LABEL_KEY: Record<ConsentMissingKey, string> = {
  clinicAddress: "patients.consents.missingClinicAddress",
  clinicLogo: "patients.consents.missingClinicLogo",
  doctorLicense: "patients.consents.missingDoctorLicense",
  doctorSpecialty: "patients.consents.missingDoctorSpecialty",
  patientCurp: "patients.consents.missingPatientCurp",
};

const FIX_LABEL_KEY: Record<ConsentFixPlace, string> = {
  settings: "patients.consents.missingFixSettings",
  team: "patients.consents.missingFixTeam",
  patient: "patients.consents.missingFixPatient",
};

function fixHref(place: ConsentFixPlace, patientId: string): string {
  if (place === "settings") return "/dashboard/settings";
  if (place === "team") return "/dashboard/team";
  return `/dashboard/patients/${encodeURIComponent(patientId)}`;
}

export function ConsentMissingNotice({
  missing, patientId,
}: {
  missing: ConsentMissingItem[];
  patientId: string;
}) {
  const t = useT();
  if (missing.length === 0) return null;

  return (
    <div
      role="status"
      className="rounded-lg p-3"
      style={{ border: "1px solid var(--warning)", background: "var(--warning-soft)" }}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={15}
          aria-hidden
          className="mt-0.5 flex-shrink-0"
          style={{ color: "var(--warning)" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
            {t("patients.consents.missingTitle")}
          </p>
          <ul className="mt-1.5 space-y-1">
            {missing.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                style={{ color: "var(--text-2)" }}
              >
                <span>• {t(LABEL_KEY[item.key])}</span>
                {/* Pestaña nueva: el modal guarda un texto que quizá ya se editó. */}
                <a
                  href={fixHref(item.fixIn, patientId)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline"
                  style={{ color: "var(--brand)" }}
                >
                  {t(FIX_LABEL_KEY[item.fixIn])}
                  <ExternalLink size={11} aria-hidden />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--text-4)" }}>
            {t("patients.consents.missingHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
