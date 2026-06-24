"use client";

// Documentos del paciente (/paciente/documentos) — Implementa D5 (WS1-T6).
// PATRÓN A SEGUIR: src/app/paciente/(panel)/pagos/page.tsx (léelo antes:
// estructura, estados de carga/error con Reintentar, PageShell, estilos
// inline dark del portal).
//
// · Datos: usePacienteData<PacienteDocumentosResponse>("/api/paciente/documentos").
// · h1: "Tus documentos".
// · Tabs locales con useState<"consentimientos" | "recetas" | "recibos">
//   (default "consentimientos"). ⚠️ SIN useSearchParams (bailout de Suspense
//   en build). Botones tipo chip/segmented (mismo look de ClinicFilterChips:
//   activo violeta rgba(124,58,237,0.25) borde #8b5cf6, inactivo
//   rgba(255,255,255,0.05)) con aria-pressed. Labels EXACTOS:
//   "Consentimientos", "Recetas", "Recibos de pago". En las tabs con datos ya
//   cargados, muestra conteo entre paréntesis: "Consentimientos (3)",
//   "Recibos de pago (12)" — recetas sin conteo (self-fetch en su tab).
// · ClinicFilterChips COMPARTIDO entre tabs: useState clinicFilter
//   (string | null) aquí, debajo de las tabs.
// · Render del tab activo (los 3 componentes YA existen con estas props
//   FIJAS — no cambiarles las props):
//     consentimientos → <TabConsentimientos consentimientos={...} clinics={...} clinicFilter={...} />
//     recetas         → <TabRecetas clinics={...} clinicFilter={...} />
//     recibos         → <TabRecibos recibos={...} clinics={...} clinicFilter={...} />
// · Loading: skeleton pulse (mismo patrón PagosSkeleton, keyframes con nombre
//   propio d5DocsPulse). Error sin data: PacienteCard con mensaje "No pudimos
//   cargar tus documentos. Revisa tu conexión e intenta de nuevo." + botón
//   Reintentar (mutate), estilo retryBtn de pagos.
// · Responsive: nada de anchos fijos; tabs con flexWrap. Español neutro con tú.
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type { PacienteDocumentosResponse } from "@/lib/patient-portal/types";
import { TabConsentimientos } from "@/components/paciente/documentos/tab-consentimientos";
import { TabRecetas } from "@/components/paciente/documentos/tab-recetas";
import { TabRecibos } from "@/components/paciente/documentos/tab-recibos";
import { TabSubidos } from "@/components/paciente/documentos/tab-subidos";
import { PacienteCard, ClinicFilterChips } from "@/components/paciente/ui";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";

type DocsTab = "consentimientos" | "recetas" | "recibos" | "subidos";

const retryBtn: CSSProperties = {
  background: "#7c3aed",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

/** Chip/segmented de tab — mismo look de ClinicFilterChips. */
function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 999,
    fontSize: 13.5,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    background: active ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.05)",
    border: active ? "1px solid #8b5cf6" : "1px solid rgba(255,255,255,0.1)",
    color: active ? "#e9d5ff" : "rgba(245,245,247,0.7)",
    transition: "all .15s",
  };
}

export default function PacienteDocumentosPage() {
  const { data, error, isLoading, mutate } =
    usePacienteData<PacienteDocumentosResponse>("/api/paciente/documentos");
  const [tab, setTab] = useState<DocsTab>("consentimientos");
  const [clinicFilter, setClinicFilter] = useState<string | null>(null);

  if (error && !data) {
    return (
      <PageShell>
        <PacienteCard>
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <p style={{ color: MUTED, margin: "0 0 14px" }}>
              No pudimos cargar tus documentos. Revisa tu conexión e intenta de nuevo.
            </p>
            <button type="button" onClick={() => mutate()} style={retryBtn}>
              Reintentar
            </button>
          </div>
        </PacienteCard>
      </PageShell>
    );
  }

  if (isLoading || !data) return <DocsSkeleton />;

  const { clinics, consentimientos, recibos } = data;

  const tabs: { id: DocsTab; label: string }[] = [
    { id: "consentimientos", label: `Consentimientos (${consentimientos.length})` },
    { id: "recetas", label: "Recetas" },
    { id: "recibos", label: `Recibos de pago (${recibos.length})` },
    { id: "subidos", label: "Mis archivos" },
  ];

  return (
    <PageShell>
      <div
        aria-label="Tipo de documento"
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            style={tabStyle(tab === t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ClinicFilterChips clinics={clinics} value={clinicFilter} onChange={setClinicFilter} />

      {tab === "consentimientos" && (
        <TabConsentimientos
          consentimientos={consentimientos}
          clinics={clinics}
          clinicFilter={clinicFilter}
        />
      )}
      {tab === "recetas" && <TabRecetas clinics={clinics} clinicFilter={clinicFilter} />}
      {tab === "recibos" && (
        <TabRecibos recibos={recibos} clinics={clinics} clinicFilter={clinicFilter} />
      )}
      {tab === "subidos" && <TabSubidos clinics={clinics} />}
    </PageShell>
  );
}

/** Título + layout vertical común a todos los estados de la página. */
function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT }}>
        Tus documentos
      </h1>
      {children}
    </div>
  );
}

function DocsSkeleton() {
  return (
    <PageShell>
      <style>{`@keyframes d5DocsPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <div style={skeletonPill} />
        <div style={skeletonPill} />
        <div style={skeletonPill} />
      </div>
      <div style={skeletonBlock(280)} />
    </PageShell>
  );
}

const skeletonPill: CSSProperties = {
  height: 34,
  borderRadius: 999,
  flex: "0 1 150px",
  background: "rgba(255,255,255,0.06)",
  animation: "d5DocsPulse 1.4s ease-in-out infinite",
};

function skeletonBlock(height: number): CSSProperties {
  return {
    height,
    borderRadius: 14,
    background: "rgba(255,255,255,0.06)",
    animation: "d5DocsPulse 1.4s ease-in-out infinite",
  };
}
