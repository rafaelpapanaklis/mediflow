"use client";

// Tab "Recetas" del portal del paciente — Implementa D7 (WS1-T6).
// Props FIJAS (page.tsx ya las pasa así — NO cambiarlas).
// Referencia visual: FacturaRow de src/app/paciente/(panel)/pagos/page.tsx.
//
// · Self-fetch: usePacienteData<PacienteRecetasResponse>("/api/paciente/recetas").
// · TOLERANTE a backend ausente: si error && !data, examina (error as Error)
//   .message — si matchea /Error (404|501)/ → tratar como lista vacía con
//   <PacienteEmptyState message="Aún no tienes recetas digitales" /> (NO card
//   de error). Cualquier otro error → card de error con botón Reintentar
//   (mutate), como en pagos/page.tsx. Loading → skeleton pulse simple.
// · Filtra por clinicFilter (r.clinicId). Lista ya viene desc por issuedAt.
// · Por fila (grid responsive sin anchos fijos, dividers): "Receta" +
//   formatFecha(issuedAt) (bold) + doctorName ("Dr(a). {doctorName}") +
//   clinicName si clinics.length > 1 + badge de vigencia (span tono ui.tsx):
//   - expired → "Vencida" rojo (#f87171 / rgba(248,113,113,0.12))
//   - expiresAt && !expired → "Vigente hasta {formatFecha(expiresAt)}" verde
//     (#34d399 / rgba(52,211,153,0.12))
//   - sin expiresAt → "Vigente" verde.
// · Botón "Ver detalle" / "Ocultar" (useState id expandido). Detalle:
//   - Medicamentos: lista con nombre (bold) + presentacion muted + línea
//     "Dosis: {dosis}" + "Duración: {duracion}" + "Cantidad: {cantidad}" +
//     notas si vienen (solo los campos no-null).
//   - indications si viene ("Indicaciones: ...", pre-wrap).
//   - diagnosis si viene ("Diagnóstico: ...").
//   - cofeprisFolio si viene ("Folio COFEPRIS: ..." muted, fontSize 12).
//   - folio siempre ("Folio: {folio}" muted fontSize 12).
// · Acciones por receta (fila de botones flexWrap):
//   - <a href={`/api/paciente/recetas/${r.id}/pdf`}> "Descargar PDF" (botón
//     violeta sólido #7c3aed, borderRadius 10, fontSize 13, fontWeight 600,
//     padding "8px 14px", textDecoration none).
//   - <a href={r.verifyUrl} target="_blank" rel="noopener noreferrer">
//     "Verificar receta" (botón outline: borde rgba(255,255,255,0.15), color
//     rgba(245,245,247,0.8)).
// · Español neutro con tú. Responsive SIEMPRE.
import { useState } from "react";
import type { CSSProperties } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type {
  PacienteClinica,
  PacienteReceta,
  PacienteRecetaMed,
  PacienteRecetasResponse,
} from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  clinicName,
  formatFecha,
} from "@/components/paciente/ui";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";
const SOFT = "rgba(245,245,247,0.75)";
const DIVIDER = "1px solid rgba(255,255,255,0.08)";

// Fila responsive: info + acciones se alinean como tabla fluida en desktop y
// se apilan como card en pantallas angostas — sin anchos fijos ni scroll.
const rowGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  gap: 10,
  alignItems: "center",
};

const actionsRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};

const pdfBtn: CSSProperties = {
  display: "inline-block",
  background: "#7c3aed",
  color: "#fff",
  border: "1px solid transparent",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  padding: "8px 14px",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const outlineBtn: CSSProperties = {
  display: "inline-block",
  background: "transparent",
  color: "rgba(245,245,247,0.8)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  padding: "8px 14px",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const toggleBtn: CSSProperties = {
  ...outlineBtn,
  fontFamily: "inherit",
  cursor: "pointer",
};

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

export function TabRecetas({
  clinics,
  clinicFilter,
}: {
  clinics: PacienteClinica[];
  clinicFilter: string | null;
}) {
  const { data, error, isLoading, mutate } =
    usePacienteData<PacienteRecetasResponse>("/api/paciente/recetas");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (error && !data) {
    // Backend de recetas ausente (404/501) → no es un error para el paciente:
    // se trata como lista vacía con el mismo estado vacío elegante.
    const msg = (error as Error)?.message || "";
    if (/Error (404|501)/.test(msg)) {
      return <PacienteEmptyState message="Aún no tienes recetas digitales" />;
    }
    return (
      <PacienteCard>
        <div style={{ textAlign: "center", padding: "24px 8px" }}>
          <p style={{ color: MUTED, margin: "0 0 14px" }}>
            No pudimos cargar tus recetas. Revisa tu conexión e intenta de nuevo.
          </p>
          <button type="button" onClick={() => mutate()} style={retryBtn}>
            Reintentar
          </button>
        </div>
      </PacienteCard>
    );
  }

  if (isLoading || !data) return <RecetasSkeleton />;

  const recetas = data.recetas || [];
  const visibles = clinicFilter
    ? recetas.filter((r) => r.clinicId === clinicFilter)
    : recetas;

  if (visibles.length === 0) {
    return (
      <PacienteEmptyState
        message={
          recetas.length === 0
            ? "Aún no tienes recetas digitales"
            : "No hay recetas de esta clínica"
        }
      />
    );
  }

  const multiClinic = clinics.length > 1;

  return (
    <PacienteCard title="Recetas">
      <div>
        {visibles.map((r, i) => (
          <RecetaRow
            key={r.id}
            receta={r}
            first={i === 0}
            clinicLabel={multiClinic ? clinicName(clinics, r.clinicId) : null}
            expanded={expandedId === r.id}
            onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
          />
        ))}
      </div>
    </PacienteCard>
  );
}

function RecetaRow({
  receta: r,
  first,
  clinicLabel,
  expanded,
  onToggle,
}: {
  receta: PacienteReceta;
  first: boolean;
  clinicLabel: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderTop: first ? "none" : DIVIDER, padding: "12px 2px" }}>
      <div style={rowGrid}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ color: TEXT, fontWeight: 600, fontSize: 15 }}>
              Receta {formatFecha(r.issuedAt)}
            </span>
            <VigenciaBadge receta={r} />
          </div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>
            Dr(a). {r.doctorName}
            {clinicLabel ? ` · ${clinicLabel}` : ""}
          </div>
        </div>

        <div style={actionsRow}>
          <a href={`/api/paciente/recetas/${r.id}/pdf`} style={pdfBtn}>
            Descargar PDF
          </a>
          <a href={r.verifyUrl} target="_blank" rel="noopener noreferrer" style={outlineBtn}>
            Verificar receta
          </a>
          <button type="button" onClick={onToggle} aria-expanded={expanded} style={toggleBtn}>
            {expanded ? "Ocultar" : "Ver detalle"}
          </button>
        </div>
      </div>

      {expanded && <RecetaDetalle receta={r} />}
    </div>
  );
}

function VigenciaBadge({ receta: r }: { receta: PacienteReceta }) {
  const label = r.expired
    ? "Vencida"
    : r.expiresAt
    ? `Vigente hasta ${formatFecha(r.expiresAt)}`
    : "Vigente";

  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        color: r.expired ? "#f87171" : "#34d399",
        background: r.expired ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.12)",
      }}
    >
      {label}
    </span>
  );
}

function RecetaDetalle({ receta: r }: { receta: PacienteReceta }) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: DIVIDER,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {r.medicamentos.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: MUTED,
              marginBottom: 8,
            }}
          >
            Medicamentos
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {r.medicamentos.map((m) => (
              <MedItem key={m.id} med={m} />
            ))}
          </ul>
        </div>
      )}

      {r.indications && (
        <div style={{ color: SOFT, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <span style={{ color: TEXT, fontWeight: 600 }}>Indicaciones: </span>
          {r.indications}
        </div>
      )}

      {r.diagnosis && (
        <div style={{ color: SOFT, fontSize: 13, overflowWrap: "anywhere" }}>
          <span style={{ color: TEXT, fontWeight: 600 }}>Diagnóstico: </span>
          {r.diagnosis}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {r.cofeprisFolio && (
          <div style={{ color: MUTED, fontSize: 12, overflowWrap: "anywhere" }}>
            Folio COFEPRIS: {r.cofeprisFolio}
          </div>
        )}
        <div style={{ color: MUTED, fontSize: 12, overflowWrap: "anywhere" }}>
          Folio: {r.folio}
        </div>
      </div>
    </div>
  );
}

function MedItem({ med: m }: { med: PacienteRecetaMed }) {
  const linea = [
    m.dosis ? `Dosis: ${m.dosis}` : null,
    m.duracion ? `Duración: ${m.duracion}` : null,
    m.cantidad ? `Cantidad: ${m.cantidad}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
        <span style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>
          {m.nombre || "Medicamento"}
        </span>
        {m.presentacion && (
          <span style={{ color: MUTED, fontSize: 12.5 }}>{m.presentacion}</span>
        )}
      </div>
      {linea && <div style={{ color: SOFT, fontSize: 13, marginTop: 2 }}>{linea}</div>}
      {m.notas && (
        <div
          style={{
            color: MUTED,
            fontSize: 12.5,
            marginTop: 2,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {m.notas}
        </div>
      )}
    </li>
  );
}

function RecetasSkeleton() {
  return (
    <>
      <style>{`@keyframes d7RecetasPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <div
        style={{
          height: 220,
          borderRadius: 14,
          background: "rgba(255,255,255,0.06)",
          animation: "d7RecetasPulse 1.4s ease-in-out infinite",
        }}
      />
    </>
  );
}
