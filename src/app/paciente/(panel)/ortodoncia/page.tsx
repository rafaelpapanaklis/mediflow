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

// La paleta del PORTAL (oscuro, la misma de `components/paciente/ui.tsx` y de
// las demás páginas del paciente), nombrada una sola vez aquí. El portal no
// cuelga de los tokens del panel de la clínica: tiene los suyos.
const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.6)";
const LINEA = "rgba(255,255,255,0.08)";
const BORDE = "rgba(255,255,255,0.14)";
const FONDO_CAMPO = "rgba(255,255,255,0.05)";
const MARCA = "#7c3aed";
const MARCA_CLARA = "#a78bfa";
const BIEN = "#34d399";
const AVISO = "#fbbf24";
const MAL = "#f87171";

// Botones de 44 px de alto: el portal se usa sobre todo desde el teléfono.
const primaryBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  background: MARCA,
  color: "#fff",
  border: "1px solid transparent",
  borderRadius: 10,
  padding: "0 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: CSSProperties = {
  ...primaryBtn,
  background: "rgba(255,255,255,0.06)",
  color: TEXT,
  border: `1px solid ${BORDE}`,
};

// 16 px en los campos: con menos, iOS hace zoom al enfocarlos.
const campo: CSSProperties = {
  minHeight: 44,
  padding: "8px 12px",
  borderRadius: 10,
  border: `1px solid ${BORDE}`,
  background: FONDO_CAMPO,
  color: TEXT,
  fontSize: 16,
  fontFamily: "inherit",
};

const rotulo: CSSProperties = { margin: "0 0 4px", color: MUTED, fontSize: 13 };
const titulo: CSSProperties = { margin: "0 0 8px", color: TEXT, fontSize: 15, fontWeight: 600 };
const cifra: CSSProperties = { fontVariantNumeric: "tabular-nums" };

// El campo de archivo se esconde a la vista pero NO al teclado ni al lector
// de pantalla (con `display: none` no se podía llegar a él con Tab).
const soloLector: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Foco de teclado visible: no se puede declarar con estilos en línea. */
const CSS_FOCO = `
.orto-portal :is(button, a, input, textarea):focus-visible { outline: 2px solid ${MARCA_CLARA}; outline-offset: 2px; }
.orto-portal label:focus-within { outline: 2px solid ${MARCA_CLARA}; outline-offset: 2px; }
.orto-portal button:disabled { opacity: 0.55; cursor: progress; }
.orto-portal-bloque + .orto-portal-bloque { padding-top: 18px; border-top: 1px solid ${LINEA}; }
@keyframes orthoPortalPulse { 0%, 100% { opacity: .45 } 50% { opacity: .9 } }
@media (prefers-reduced-motion: reduce) { .orto-portal * { animation: none !important; } }
`;

export default function PacienteOrtodonciaPage() {
  const { data, error, isLoading, mutate } = usePacienteData<{ cases: PacienteOrtodonciaCase[] }>(
    "/api/paciente/ortodoncia",
  );

  if (error && !data) {
    return (
      <PageShell>
        <PacienteCard>
          <div style={{ textAlign: "center", padding: "24px 8px" }} role="alert">
            <p style={{ color: MUTED, margin: "0 0 14px", fontSize: 14 }}>
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
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <MensualidadYControl cobranza={caseData.cobranza} proximoControl={caseData.proximoControl} />

        {/* Lo que el paciente hace a diario va primero: marcar el día. */}
        <div className="orto-portal-bloque">
          <ElasticsCheckin treatmentPlanId={caseData.treatmentPlanId} todayLogged={caseData.todayLogged} onSaved={onSaved} />
        </div>

        {caseData.aligner || caseData.compliance.compliancePct !== null ? (
          <div
            className="orto-portal-bloque"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}
          >
            {caseData.aligner ? (
              <div>
                <p style={rotulo}>Tu alineador</p>
                <p style={{ margin: 0, color: TEXT, fontSize: 22, fontWeight: 700, ...cifra }}>
                  {caseData.aligner.currentTray}{" "}
                  <span style={{ fontSize: 14, color: MUTED, fontWeight: 400 }}>de {caseData.aligner.totalTrays}</span>
                </p>
              </div>
            ) : null}
            {caseData.compliance.compliancePct !== null ? (
              <div>
                <p style={rotulo}>Cumplimiento, últimos {caseData.compliance.windowDays} días</p>
                <p style={{ margin: 0, color: caseData.compliance.isLow ? AVISO : BIEN, fontSize: 22, fontWeight: 700, ...cifra }}>
                  {caseData.compliance.compliancePct}%
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="orto-portal-bloque">
          <MonitoringUpload treatmentPlanId={caseData.treatmentPlanId} />
        </div>
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
        gap: 12,
        padding: 14,
        borderRadius: 12,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${LINEA}`,
      }}
    >
      {cobranza && (
        <div>
          <p style={{ ...titulo, margin: "0 0 6px" }}>Tu mensualidad</p>
          {cobranza.vencidoMxn > 0 ? (
            <p style={{ margin: "0 0 4px", color: MAL, fontSize: 15, fontWeight: 700, ...cifra }}>
              Tienes {formatMxn(cobranza.vencidoMxn)} vencido
            </p>
          ) : cobranza.cuotaDeHoyMxn !== null ? (
            <p style={{ margin: "0 0 4px", color: TEXT, fontSize: 15, ...cifra }}>
              Próxima mensualidad: <strong>{formatMxn(cobranza.cuotaDeHoyMxn)}</strong>
              {cobranza.proximoVencimiento ? ` · vence ${formatFecha(cobranza.proximoVencimiento)}` : ""}
            </p>
          ) : (
            <p style={{ margin: "0 0 4px", color: BIEN, fontSize: 15 }}>Tu tratamiento está al día.</p>
          )}
          <p style={{ margin: "0 0 10px", color: MUTED, fontSize: 13, ...cifra }}>
            Saldo total del tratamiento: {formatMxn(cobranza.saldoTotalMxn)}
          </p>
          {(cobranza.vencidoMxn > 0 || (cobranza.cuotaDeHoyMxn ?? 0) > 0) && (
            <a href="/paciente/pagos" style={{ ...secondaryBtn, textDecoration: "none" }}>
              Ver y pagar en Tus pagos
            </a>
          )}
        </div>
      )}
      {proximoControl && (
        <div>
          <p style={{ margin: 0, color: MUTED, fontSize: 14 }}>
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
      <div role="status">
        <p style={{ margin: 0, color: BIEN, fontSize: 15, fontWeight: 600 }}>✓ Ya marcaste hoy. ¡Gracias!</p>
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
      <p style={titulo}>¿Usaste tus elásticos o tu alineador hoy?</p>
      {error ? (
        <p role="alert" style={{ color: MAL, fontSize: 14, margin: "0 0 8px" }}>
          {error}
        </p>
      ) : null}
      {/* Los dos botones primero y a todo el ancho en el teléfono: es un toque. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={saving} style={{ ...primaryBtn, flex: "1 1 130px" }} onClick={() => submit(true)}>
          Sí, hoy sí
        </button>
        <button type="button" disabled={saving} style={{ ...secondaryBtn, flex: "1 1 130px" }} onClick={() => submit(false)}>
          Hoy no
        </button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10, color: MUTED, fontSize: 13 }}>
        ¿Cuántas horas? (opcional)
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={24}
          placeholder="Horas"
          value={hours}
          onChange={(e) => setHours(e.target.value === "" ? "" : Number(e.target.value))}
          style={{ ...campo, width: 110 }}
        />
      </label>
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
      <p style={titulo}>Envía una foto de seguimiento</p>
      {status === "sent" ? (
        <p role="status" style={{ color: BIEN, fontSize: 14, margin: "0 0 8px" }}>
          ✓ Enviada. Tu clínica la revisará.
        </p>
      ) : null}
      {error ? (
        <p role="alert" style={{ color: MAL, fontSize: 14, margin: "0 0 8px" }}>
          {error}
        </p>
      ) : null}

      <div role="group" aria-label="Ángulo de la foto" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {(["FRONTAL", "LATERAL", "SMILE", "INTRAORAL"] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAngle(a)}
            aria-pressed={angle === a}
            style={{
              minHeight: 38,
              padding: "0 14px",
              borderRadius: 999,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
              background: angle === a ? "rgba(124,58,237,0.25)" : FONDO_CAMPO,
              border: angle === a ? `1px solid ${MARCA_CLARA}` : `1px solid ${BORDE}`,
              color: angle === a ? "#fff" : "rgba(245,245,247,0.75)",
            }}
          >
            {ANGLE_LABEL[a]}
          </button>
        ))}
      </div>

      {preview ? (
        <div style={{ marginBottom: 10, maxWidth: 280 }}>
          <CameraGuideOverlay shot={ANGLE_TO_GUIDE[angle]} className="aspect-[3/4]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Vista previa" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </CameraGuideOverlay>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ ...secondaryBtn, position: "relative" }}>
          {file ? "Cambiar foto" : "Elegir foto"}
          <input
            type="file"
            accept="image/*"
            capture="user"
            style={soloLector}
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
        aria-label="Mensaje para tu doctor (opcional)"
        placeholder="¿Algo que quieras contarle a tu doctor? (opcional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        style={{ ...campo, marginTop: 10, width: "100%", boxSizing: "border-box", resize: "vertical" }}
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
    <div className="orto-portal" style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <style>{CSS_FOCO}</style>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: TEXT, letterSpacing: "-0.01em" }}>Tu ortodoncia</h1>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <PageShell>
      <div
        role="status"
        aria-label="Cargando tu ortodoncia"
        style={{
          // Alto parecido al de la tarjeta real: al cargar no hay salto.
          height: 420,
          borderRadius: 14,
          background: "rgba(255,255,255,0.06)",
          animation: "orthoPortalPulse 1.4s ease-in-out infinite",
        }}
      />
    </PageShell>
  );
}
