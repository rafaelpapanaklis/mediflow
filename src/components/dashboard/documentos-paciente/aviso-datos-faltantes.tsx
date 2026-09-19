"use client";

// El aviso de los datos que le faltan a un documento del paciente, con el enlace
// al sitio donde se captura cada uno. Común a la nota de evolución y a la carta
// de consentimiento; la lista sale de `@/lib/patient-documents/faltantes`.
//
// Es un aviso, NO un bloqueo: un documento incompleto es mejor que ninguno. Y
// como hoy casi ninguna clínica tiene dirección ni logo, sale casi siempre: se
// pinta como una lista de pendientes con su atajo, no como una alarma.

import { ClipboardList, ExternalLink } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import {
  hrefDeCaptura,
  type DatoFaltante,
  type DatoFaltanteClave,
  type LugarDeCaptura,
} from "@/lib/patient-documents/faltantes";
import { CLASES_DOCUMENTO } from "./documento-hoja";
import s from "./documento.module.css";

const ETIQUETA: Record<DatoFaltanteClave, string> = {
  clinicAddress: "documentosPaciente.faltantes.clinicAddress",
  clinicLogo: "documentosPaciente.faltantes.clinicLogo",
  doctorLicense: "documentosPaciente.faltantes.doctorLicense",
  doctorSpecialty: "documentosPaciente.faltantes.doctorSpecialty",
  patientCurp: "documentosPaciente.faltantes.patientCurp",
};

const ATAJO: Record<LugarDeCaptura, string> = {
  settings: "documentosPaciente.faltantes.fixSettings",
  team: "documentosPaciente.faltantes.fixTeam",
  patient: "documentosPaciente.faltantes.fixPatient",
};

export function AvisoDatosFaltantes({
  faltantes, patientId, documento,
}: {
  faltantes: DatoFaltante[];
  patientId: string;
  /** De qué documento se habla: cambia el título y la pista. */
  documento: "nota" | "carta";
}) {
  const t = useT();
  if (faltantes.length === 0) return null;

  return (
    <div role="status" className={[CLASES_DOCUMENTO, s.aviso].join(" ")}>
      <ClipboardList size={18} aria-hidden className={s.avisoIcono} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className={s.avisoTitulo}>{t(`documentosPaciente.faltantes.title.${documento}`)}</p>
        <ul className={s.avisoLista}>
          {faltantes.map((f) => (
            <li key={f.key} className={s.avisoFila}>
              <span>{t(ETIQUETA[f.key])}</span>
              {/* Pestaña nueva: lo que se está escribiendo vive solo en esta pantalla. */}
              <a href={hrefDeCaptura(f.fixIn, patientId)} target="_blank" rel="noreferrer" className={s.avisoEnlace}>
                {t(ATAJO[f.fixIn])}
                <ExternalLink size={12} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
        <p className={s.avisoPista}>{t(`documentosPaciente.faltantes.hint.${documento}`)}</p>
      </div>
    </div>
  );
}
