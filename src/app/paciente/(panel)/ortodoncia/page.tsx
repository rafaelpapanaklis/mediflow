"use client";

// Portal del paciente — Ortodoncia (/paciente/ortodoncia). Parte 8
// «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H14: marca si
// usaste tus elásticos/alineador hoy. H15: sube una foto de monitoreo con
// guía de encuadre (H7, mismo componente que la clínica).
//
// PATRÓN A SEGUIR: src/app/paciente/(panel)/documentos/page.tsx (self-fetch
// con usePacienteData, PageShell propio, estilos inline dark, sin
// useSearchParams).
//
// ws1-t2 (Paciente y WhatsApp, W4) agregó el bloque «Tu mensualidad» de
// forma aditiva (función MensualidadYControl) — no toca el resto de esta
// página. El botón de pago reutiliza el link de factura de Mercado Pago que
// ya existe en /paciente/pagos (mismo saldo, mismo botón) en vez de
// construir un cobro nuevo: se enlaza ahí en vez de duplicar el flujo.

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import { PacienteCard, PacienteEmptyState, formatMxn, formatFecha } from "@/components/paciente/ui";
import { CameraGuideOverlay } from "@/components/clinical-shared/photos/CameraGuideOverlay";
import { logElasticsComplianceFromPortal } from "@/app/actions/orthodontics/alineadores/logElasticsComplianceFromPortal";
import { submitMonitoringPhoto } from "@/app/actions/orthodontics/alineadores/submitMonitoringPhoto";
import type { PacienteOrtodonciaCase } from "@/app/api/paciente/ortodoncia/route";
import { isFailure } from "@/app/actions/orthodontics/result";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";

const primaryBtn: CSSProperties = {
  background: "#7c3aed",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: CSSProperties = {
  ...primaryBtn,
  background: "rgba(255,255,255,0.06)",
  color: TEXT,
  border: "1px solid rgba(255,255,255,0.12)",
};

export default function PacienteOrtodonciaPage() {
  const { data, error, isLoading, mutate } = usePacienteData<{ cases: PacienteOrtodonciaCase[] }>(
    "/api/paciente/ortodoncia",
  );

  if (error && !data) {
    return (
      <PageShell>
        <PacienteCard>
          <div style={{ textAlign: "center", padding: "24px 8px" }}>
            <p style={{ color: MUTED, margin: "0 0 14px" }}>
              No pudimos cargar tu ortodoncia. Revisa tu conexión e intenta de nuevo.
            </p>
            <button type="button" onClick={() => mutate()} style={primaryBtn}>
              Reintentar
            </button>
          </div>
        </PacienteCard>
      </PageShell>
    );
  }

  if (isLoading || !data) return <Skeleton />;

  if (data.cases.length === 0) {
    return (
      <PageShell>
        <PacienteCard>
          <PacienteEmptyState message="No tienes un caso de ortodoncia activo todavía." />
        </PacienteCard>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {data.cases.map((c) => (
        <CaseSection key={c.treatmentPlanId} caseData={c} onSaved={mutate} />
      ))}
    </PageShell>
  );
}

function CaseSection({ caseData, onSaved }: { caseData: PacienteOrtodonciaCase; onSaved: () => void }) {
  return (
    <PacienteCard title={caseData.clinicName}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <MensualidadYControl cobranza={caseData.cobranza} proximoControl={caseData.proximoControl} />

        {caseData.aligner ? (
          <div>
            <p style={{ margin: "0 0 4px", color: MUTED, fontSize: 13 }}>Tu alineador</p>
            <p style={{ margin: 0, color: TEXT, fontSize: 20, fontWeight: 700 }}>
              {caseData.aligner.currentTray} <span style={{ fontSize: 14, color: MUTED, fontWeight: 400 }}>de {caseData.aligner.totalTrays}</span>
            </p>
          </div>
        ) : null}

        <ElasticsCheckin treatmentPlanId={caseData.treatmentPlanId} todayLogged={caseData.todayLogged} onSaved={onSaved} />

        {caseData.compliance.compliancePct !== null ? (
          <div>
            <p style={{ margin: "0 0 4px", color: MUTED, fontSize: 13 }}>
              Cumplimiento últimos {caseData.compliance.windowDays} días
            </p>
            <p style={{ margin: 0, color: caseData.compliance.isLow ? "#fbbf24" : "#34d399", fontSize: 18, fontWeight: 700 }}>
              {caseData.compliance.compliancePct}%
            </p>
          </div>
        ) : null}

        <MonitoringUpload treatmentPlanId={caseData.treatmentPlanId} />
      </div>
    </PacienteCard>
  );
}

/**
 * ws1-t2 (W4) — resumen de mensualidades (de la factura real del
 * tratamiento) y próximo control (Agenda). `cobranza === null` = todavía sin
 * factura de tratamiento abierta: no hay nada que cobrar, se omite el
 * bloque entero en vez de enseñar ceros que confundirían al paciente.
 */
function MensualidadYControl({
  cobranza,
  proximoControl,
}: {
  cobranza: PacienteOrtodonciaCase["cobranza"];
  proximoControl: string | null;
}) {
  if (!cobranza && !proximoControl) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {cobranza && (
        <div>
          <p style={{ margin: "0 0 6px", color: TEXT, fontSize: 14, fontWeight: 600 }}>Tu mensualidad</p>
          {cobranza.vencidoMxn > 0 ? (
            <p style={{ margin: "0 0 4px", color: "#f87171", fontSize: 14, fontWeight: 700 }}>
              Tienes {formatMxn(cobranza.vencidoMxn)} vencido
            </p>
          ) : cobranza.cuotaDeHoyMxn !== null ? (
            <p style={{ margin: "0 0 4px", color: TEXT, fontSize: 14 }}>
              Próxima mensualidad: <strong>{formatMxn(cobranza.cuotaDeHoyMxn)}</strong>
              {cobranza.proximoVencimiento ? ` · vence ${formatFecha(cobranza.proximoVencimiento)}` : ""}
            </p>
          ) : (
            <p style={{ margin: "0 0 4px", color: "#34d399", fontSize: 14 }}>Tu tratamiento está al día.</p>
          )}
          <p style={{ margin: "0 0 8px", color: MUTED, fontSize: 12 }}>
            Saldo total del tratamiento: {formatMxn(cobranza.saldoTotalMxn)}
          </p>
          {(cobranza.vencidoMxn > 0 || (cobranza.cuotaDeHoyMxn ?? 0) > 0) && (
            <a href="/paciente/pagos" style={{ ...secondaryBtn, display: "inline-block", textDecoration: "none" }}>
              Ver y pagar en Tus pagos
            </a>
          )}
        </div>
      )}
      {proximoControl && (
        <div>
          <p style={{ margin: 0, color: MUTED, fontSize: 13 }}>
            Tu próximo control es el <strong style={{ color: TEXT }}>{formatFecha(proximoControl)}</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

function ElasticsCheckin({
  treatmentPlanId,
  todayLogged,
  onSaved,
}: {
  treatmentPlanId: string;
  todayLogged: boolean;
  onSaved: () => void;
}) {
  const [hours, setHours] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(todayLogged);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div>
        <p style={{ margin: 0, color: "#34d399", fontSize: 14 }}>✓ Ya marcaste hoy. ¡Gracias!</p>
      </div>
    );
  }

  async function submit(usedElastics: boolean) {
    setSaving(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const res = await logElasticsComplianceFromPortal({
      treatmentPlanId,
      logDate: today,
      wornHours: hours === "" ? null : hours,
      usedElastics,
    });
    setSaving(false);
    if (isFailure(res)) {
      setError(res.error);
      return;
    }
    setDone(true);
    onSaved();
  }

  return (
    <div>
      <p style={{ margin: "0 0 8px", color: TEXT, fontSize: 14, fontWeight: 600 }}>
        ¿Usaste tus elásticos/alineador hoy?
      </p>
      {error ? <p style={{ color: "#f87171", fontSize: 13, margin: "0 0 8px" }}>{error}</p> : null}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="number"
          min={0}
          max={24}
          placeholder="Horas (opcional)"
          value={hours}
          onChange={(e) => setHours(e.target.value === "" ? "" : Number(e.target.value))}
          style={{
            width: 130,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            color: TEXT,
            fontSize: 13,
          }}
        />
        <button type="button" disabled={saving} style={primaryBtn} onClick={() => submit(true)}>
          Sí, hoy sí
        </button>
        <button type="button" disabled={saving} style={secondaryBtn} onClick={() => submit(false)}>
          Hoy no
        </button>
      </div>
    </div>
  );
}

function MonitoringUpload({ treatmentPlanId }: { treatmentPlanId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [angle, setAngle] = useState<"FRONTAL" | "LATERAL" | "SMILE" | "INTRAORAL">("FRONTAL");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function pick(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStatus("idle");
  }

  async function send() {
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("treatmentPlanId", treatmentPlanId);
      form.append("angle", angle);
      if (note) form.append("patientNote", note);
      const res = await fetch("/api/paciente/ortodoncia/monitoreo", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo subir la foto");
        setStatus("error");
        return;
      }
      const created = await submitMonitoringPhoto({
        treatmentPlanId,
        storageKey: json.storageKey,
        fileName: json.fileName,
        mimeType: json.mimeType,
        sizeBytes: json.sizeBytes,
        angle: json.angle,
        patientNote: json.patientNote,
      });
      if (isFailure(created)) {
        setError(created.error);
        setStatus("error");
        return;
      }
      setStatus("sent");
      setFile(null);
      setPreview(null);
      setNote("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <p style={{ margin: "0 0 8px", color: TEXT, fontSize: 14, fontWeight: 600 }}>
        Envía una foto de seguimiento
      </p>
      {status === "sent" ? (
        <p style={{ color: "#34d399", fontSize: 13, margin: "0 0 8px" }}>✓ Enviada. Tu clínica la revisará.</p>
      ) : null}
      {error ? <p style={{ color: "#f87171", fontSize: 13, margin: "0 0 8px" }}>{error}</p> : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {(["FRONTAL", "LATERAL", "SMILE", "INTRAORAL"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAngle(a)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              background: angle === a ? "rgba(124,58,237,0.25)" : "rgba(255,255,255,0.05)",
              border: angle === a ? "1px solid #8b5cf6" : "1px solid rgba(255,255,255,0.1)",
              color: angle === a ? "#e9d5ff" : "rgba(245,245,247,0.7)",
            }}
          >
            {ANGLE_LABEL[a]}
          </button>
        ))}
      </div>

      {preview ? (
        <div style={{ marginBottom: 8, maxWidth: 280 }}>
          <CameraGuideOverlay shot={ANGLE_TO_GUIDE[angle]} className="aspect-[3/4]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Vista previa" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </CameraGuideOverlay>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ ...secondaryBtn, display: "inline-block" }}>
          {file ? "Cambiar foto" : "Elegir foto"}
          <input
            type="file"
            accept="image/*"
            capture="user"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
              e.target.value = "";
            }}
          />
        </label>
        {file ? (
          <button type="button" disabled={sending} style={primaryBtn} onClick={send}>
            {sending ? "Enviando…" : "Enviar"}
          </button>
        ) : null}
      </div>

      <textarea
        placeholder="¿Algo que quieras contarle a tu doctor? (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        style={{
          marginTop: 8,
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.05)",
          color: TEXT,
          fontSize: 13,
          resize: "vertical",
        }}
      />
    </div>
  );
}

const ANGLE_LABEL: Record<"FRONTAL" | "LATERAL" | "SMILE" | "INTRAORAL", string> = {
  FRONTAL: "Frente",
  LATERAL: "Perfil",
  SMILE: "Sonrisa",
  INTRAORAL: "Intraoral",
};

const ANGLE_TO_GUIDE = {
  FRONTAL: "FRONTAL_REPOSO",
  LATERAL: "PERFIL",
  SMILE: "FRONTAL_SONRISA",
  INTRAORAL: "INTRAORAL_FRONTAL",
} as const;

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT }}>Tu ortodoncia</h1>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <PageShell>
      <style>{`@keyframes orthoPortalPulse{0%,100%{opacity:.45}50%{opacity:.9}}`}</style>
      <div
        style={{
          height: 220,
          borderRadius: 14,
          background: "rgba(255,255,255,0.06)",
          animation: "orthoPortalPulse 1.4s ease-in-out infinite",
        }}
      />
    </PageShell>
  );
}
