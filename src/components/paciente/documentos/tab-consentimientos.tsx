"use client";

// Tab "Consentimientos" del portal del paciente — Implementa D6 (WS1-T6).
// Props FIJAS (page.tsx ya las pasa así — NO cambiarlas).
// Referencia visual: FacturaRow de src/app/paciente/(panel)/pagos/page.tsx.
//
// · Filtra por clinicFilter (c.clinicId). Vacíos:
//   - sin consentimientos: <PacienteEmptyState message="Aún no tienes
//     consentimientos firmados" />
//   - el filtro oculta todo: "No hay consentimientos de esta clínica".
// · Lista dentro de <PacienteCard title="Consentimientos firmados">. Por fila
//   (grid responsive sin anchos fijos, divider rgba(255,255,255,0.08) entre
//   filas): procedure (bold 15px) + badge "Firmado" (span inline tono verde:
//   color #34d399, fondo rgba(52,211,153,0.12), borderRadius 999, fontSize 11,
//   fontWeight 600, padding "3px 10px") + formatFecha(signedAt) en muted +
//   etiqueta de clínica si clinics.length > 1 (clinicName(clinics, clinicId)).
// · Botón por fila "Ver documento" / "Ocultar" (useState<string | null> con el
//   id expandido; botón estilo outline violeta pequeño). Al expandir:
//   - content del consentimiento en un bloque con whiteSpace: "pre-wrap",
//     fontSize 13, lineHeight 1.6, color rgba(255,255,255,0.75), fondo
//     rgba(255,255,255,0.03), borderRadius 10, padding 14, maxHeight 320 y
//     overflowY auto (textos largos).
//   - Si hasFirma: cargar la firma ON-DEMAND (la signed URL expira en 300s,
//     NO precargar): fetch(`/api/paciente/documentos/descargar?tipo=consentimiento&id=${id}`,
//     { credentials: "same-origin" }) → res.ok → { url } → <img src={url}
//     alt="Firma del paciente" style={{ maxWidth: 240, width: "100%",
//     background: "#fff", borderRadius: 8, padding: 8 }} />. Estados: cargando
//     ("Cargando firma…" muted) y error ("No se pudo cargar la firma." muted).
//     Guarda las URLs en useState<Record<string, string>> para no re-pedir al
//     re-expandir dentro de la misma vista.
// · Español neutro con tú. Responsive SIEMPRE.
import { useState } from "react";
import type { CSSProperties } from "react";
import type { PacienteClinica, PacienteConsentimiento } from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  clinicName,
  formatFecha,
} from "@/components/paciente/ui";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";
const DIVIDER = "1px solid rgba(255,255,255,0.08)";

// Misma idea que FacturaRow (pagos): tabla fluida en desktop y celdas apiladas
// como card en pantallas angostas — sin anchos fijos ni scroll horizontal.
const rowGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
  gap: 10,
  alignItems: "center",
  padding: "12px 2px",
};

const badgeFirmado: CSSProperties = {
  display: "inline-block",
  color: "#34d399",
  background: "rgba(52,211,153,0.12)",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 10px",
  whiteSpace: "nowrap",
};

const toggleBtn: CSSProperties = {
  background: "transparent",
  color: "#a78bfa",
  border: "1px solid rgba(139,92,246,0.5)",
  borderRadius: 10,
  padding: "6px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const contentBox: CSSProperties = {
  whiteSpace: "pre-wrap",
  fontSize: 13,
  lineHeight: 1.6,
  color: "rgba(255,255,255,0.75)",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 10,
  padding: 14,
  maxHeight: 320,
  overflowY: "auto",
};

const firmaImg: CSSProperties = {
  maxWidth: 240,
  width: "100%",
  background: "#fff",
  borderRadius: 8,
  padding: 8,
};

const firmaMsg: CSSProperties = { color: MUTED, fontSize: 13, margin: 0 };

export function TabConsentimientos({
  consentimientos,
  clinics,
  clinicFilter,
}: {
  consentimientos: PacienteConsentimiento[];
  clinics: PacienteClinica[];
  clinicFilter: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Cache local de signed URLs de firmas para no re-pedirlas al re-expandir.
  const [firmaUrls, setFirmaUrls] = useState<Record<string, string>>({});
  const [firmaErrors, setFirmaErrors] = useState<Record<string, boolean>>({});

  const multiClinic = clinics.length > 1;
  const visibles = clinicFilter
    ? consentimientos.filter((c) => c.clinicId === clinicFilter)
    : consentimientos;

  async function cargarFirma(id: string) {
    setFirmaErrors((prev) => ({ ...prev, [id]: false }));
    try {
      const res = await fetch(
        `/api/paciente/documentos/descargar?tipo=consentimiento&id=${encodeURIComponent(id)}`,
        { credentials: "same-origin" }
      );
      if (!res.ok) throw new Error("descarga");
      const data = await res.json();
      if (!data || !data.url) throw new Error("sin url");
      setFirmaUrls((prev) => ({ ...prev, [id]: data.url }));
    } catch {
      setFirmaErrors((prev) => ({ ...prev, [id]: true }));
    }
  }

  function toggle(c: PacienteConsentimiento) {
    const next = expandedId === c.id ? null : c.id;
    setExpandedId(next);
    // La signed URL expira en 300s: se pide SOLO al expandir (nunca precarga).
    if (next !== null && c.hasFirma && !firmaUrls[c.id]) cargarFirma(c.id);
  }

  if (visibles.length === 0) {
    return (
      <PacienteEmptyState
        message={
          consentimientos.length === 0
            ? "Aún no tienes consentimientos firmados"
            : "No hay consentimientos de esta clínica"
        }
      />
    );
  }

  return (
    <PacienteCard title="Consentimientos firmados">
      <div>
        {visibles.map((c, i) => {
          const expanded = expandedId === c.id;
          return (
            <div key={c.id} style={{ borderTop: i === 0 ? "none" : DIVIDER }}>
              <div style={rowGrid}>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}
                  >
                    <span style={{ color: TEXT, fontWeight: 600, fontSize: 15 }}>
                      {c.procedure}
                    </span>
                    <span style={badgeFirmado}>Firmado</span>
                  </div>
                  <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>
                    {formatFecha(c.signedAt)}
                    {multiClinic ? ` · ${clinicName(clinics, c.clinicId)}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => toggle(c)}
                    aria-expanded={expanded}
                    style={toggleBtn}
                  >
                    {expanded ? "Ocultar" : "Ver documento"}
                  </button>
                </div>
              </div>
              {expanded && (
                <div
                  style={{
                    padding: "0 2px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={contentBox}>{c.content}</div>
                  {c.hasFirma &&
                    (firmaUrls[c.id] ? (
                      <img src={firmaUrls[c.id]} alt="Firma del paciente" style={firmaImg} />
                    ) : firmaErrors[c.id] ? (
                      <p style={firmaMsg}>No se pudo cargar la firma.</p>
                    ) : (
                      <p style={firmaMsg}>Cargando firma…</p>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PacienteCard>
  );
}
