"use client";
// Página PÚBLICA de firma del consentimiento informado.
//
// Se abre desde la liga que la clínica le manda al paciente por WhatsApp, o en
// la tableta del consultorio con el paciente delante. Sin sesión: el token de
// la URL es la credencial.
//
// El flujo tiene tres momentos y por eso no es una sola pantalla:
//   1. LEER — el texto íntegro, con el aviso de quién firma si hay un
//      representante legal. El GET marca `viewedAt`: un consentimiento que
//      nadie abrió antes de firmar no es informado.
//   2. FIRMAR — casilla de aceptación + firma. La casilla y el trazo son dos
//      actos distintos a propósito.
//   3. TESTIGOS — sólo después de firmar y sólo si están presentes (flujo de
//      tableta). Es OPCIONAL: quien firma desde su casa no tiene testigos y no
//      se le bloquea nada; el panel muestra "Testigos 0/2".
//
// Estilos en línea con colores fijos claros: esta página se ve en el teléfono
// del paciente, fuera del tema del panel.

import { useState, useEffect, useCallback } from "react";
import { SignaturePad } from "@/components/ui/signature-pad";

interface ConsentPublicData {
  procedure: string;
  content: string;
  expiresAt: string;
  signedAt: string | null;
  signatureUrl: string | null;
  signerName: string | null;
  signerRelation: string | null;
  revokedAt: string | null;
  witness1Name: string | null;
  witness1SignedAt: string | null;
  witness2Name: string | null;
  witness2SignedAt: string | null;
  patient: { firstName: string; lastName: string } | null;
  clinic: { name: string; phone: string | null; logoUrl: string | null } | null;
}

const CARD: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #e2e8f0",
  padding: 20,
  marginBottom: 16,
};

export default function ConsentPage({ params }: { params: { token: string } }) {
  const [form, setForm] = useState<ConsentPublicData | null>(null);
  const [error, setError] = useState("");
  const [signing, setSigning] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/consent/public/${params.token}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "No se pudo cargar el formulario");
        return;
      }
      setForm(data);
    } catch {
      setError("Error al cargar el formulario");
    }
  }, [params.token]);

  useEffect(() => { load(); }, [load]);

  async function sign() {
    if (!signature) { setMsg("Dibuja tu firma en el recuadro."); return; }
    if (!agreed) { setMsg("Marca la casilla de aceptación antes de firmar."); return; }
    setSigning(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/consent/public/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signature }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "No se pudo registrar la firma.");
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSigning(false);
    }
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "system-ui" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>Formulario no disponible</h1>
          <p style={{ color: "#64748b" }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ color: "#94a3b8", fontFamily: "system-ui" }}>Cargando…</div>
      </div>
    );
  }

  const patientName = `${form.patient?.firstName ?? ""} ${form.patient?.lastName ?? ""}`.trim();
  const isRepresented = Boolean(form.signerName);
  const signerLabel = isRepresented ? form.signerName : patientName;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui", paddingBottom: 40 }}>
      <header style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "16px 20px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          {form.clinic?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.clinic.logoUrl} alt="" style={{ height: 36 }} />
          ) : null}
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{form.clinic?.name}</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Carta de consentimiento informado</div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
        {form.revokedAt ? (
          <div style={{ ...CARD, borderColor: "#fecaca", background: "#fef2f2" }}>
            <div style={{ fontWeight: 700, color: "#b91c1c", fontSize: 14 }}>Consentimiento revocado</div>
            <p style={{ fontSize: 13, color: "#7f1d1d", marginTop: 4, lineHeight: 1.6 }}>
              Este consentimiento fue revocado el {fmtDateTime(form.revokedAt)}. Si tienes dudas,
              comunícate con {form.clinic?.name ?? "la clínica"}
              {form.clinic?.phone ? ` al ${form.clinic.phone}` : ""}.
            </p>
          </div>
        ) : null}

        {form.signedAt ? (
          <div style={{ ...CARD, borderColor: "#bbf7d0", background: "#f0fdf4" }}>
            <div style={{ fontWeight: 700, color: "#15803d", fontSize: 15 }}>✅ Consentimiento firmado</div>
            <p style={{ fontSize: 13, color: "#166534", marginTop: 4, lineHeight: 1.6 }}>
              Firmado por <strong>{signerLabel}</strong> el {fmtDateTime(form.signedAt)}.
              {isRepresented ? " (representante legal del paciente)" : ""}
            </p>
          </div>
        ) : null}

        {/* Documento */}
        <div style={CARD}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{form.procedure}</h1>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>
            Paciente: <strong>{patientName}</strong>
          </p>
          {isRepresented ? (
            <p style={{ fontSize: 13, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 12px", margin: "8px 0 14px", lineHeight: 1.6 }}>
              Firma <strong>{form.signerName}</strong> en nombre del paciente, en calidad de
              representante legal{form.signerRelation ? ` (${form.signerRelation})` : ""}.
            </p>
          ) : null}
          <div style={{ fontSize: 13, lineHeight: 1.8, color: "#374151", whiteSpace: "pre-wrap", background: "#f8fafc", borderRadius: 12, padding: 16, marginTop: 12 }}>
            {form.content}
          </div>
        </div>

        {/* Firma del paciente / representante */}
        {!form.signedAt && !form.revokedAt ? (
          <>
            <div style={CARD}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 4 }}>
                {isRepresented ? "Firma del representante legal" : "Firma del paciente"}
              </div>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{signerLabel}</p>
              <SignaturePad
                theme="light"
                width={640}
                height={190}
                onChange={setSignature}
                ariaLabel="Recuadro para firmar"
                hintLabel="Firma con el dedo o el ratón"
              />
            </div>

            <label
              htmlFor="agree"
              style={{ display: "flex", gap: 10, alignItems: "flex-start", ...CARD, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                id="agree"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18, cursor: "pointer", flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
                He leído y entendido esta carta de consentimiento informado, pude preguntar lo que
                quise y se resolvieron mis dudas. Acepto de forma libre y voluntaria el tratamiento
                descrito y confirmo que la información que di sobre el estado de salud es verídica y
                completa.
              </span>
            </label>

            {msg ? (
              <p style={{ fontSize: 13, color: "#b91c1c", marginBottom: 12, textAlign: "center" }}>{msg}</p>
            ) : null}

            <button
              onClick={sign}
              disabled={signing || !agreed || !signature}
              style={{
                width: "100%",
                padding: 16,
                borderRadius: 14,
                border: "none",
                background: agreed && signature ? "#2563eb" : "#e2e8f0",
                color: agreed && signature ? "#fff" : "#94a3b8",
                fontWeight: 700,
                fontSize: 16,
                cursor: agreed && signature ? "pointer" : "default",
              }}
            >
              {signing ? "Firmando…" : "Firmar consentimiento"}
            </button>

            <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 12, lineHeight: 1.6 }}>
              Al firmar se registran la fecha, la hora y el dispositivo desde el que firmas, como
              evidencia de la firma electrónica conforme a los arts. 89 y 89 bis del Código de
              Comercio y 210-A del CFPC.
            </p>
          </>
        ) : null}

        {/* Testigos — sólo tras la firma y sólo si están presentes. */}
        {form.signedAt && !form.revokedAt ? (
          <WitnessSection token={params.token} form={form} onSaved={load} />
        ) : null}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Testigos (opcional, hasta dos)
// ---------------------------------------------------------------------------

function WitnessSection({
  token, form, onSaved,
}: {
  token: string;
  form: ConsentPublicData;
  onSaved: () => Promise<void> | void;
}) {
  // Cerrado por defecto: el caso común es el paciente firmando desde su casa,
  // donde no hay testigos que capturar y una sección abierta parecería un paso
  // pendiente.
  const [open, setOpen] = useState(false);
  const done1 = Boolean(form.witness1SignedAt);
  const done2 = Boolean(form.witness2SignedAt);
  const bothDone = done1 && done2;

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Testigos (opcional)</div>
          <p style={{ fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.5 }}>
            Si hubo personas presentes cuando firmaste, pueden dejar aquí su nombre y su firma.
          </p>
        </div>
        {!bothDone ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{ fontSize: 13, fontWeight: 700, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}
          >
            {open ? "Ocultar" : "Agregar testigo"}
          </button>
        ) : null}
      </div>

      {done1 ? <WitnessDone n={1} name={form.witness1Name} at={form.witness1SignedAt} /> : null}
      {done2 ? <WitnessDone n={2} name={form.witness2Name} at={form.witness2SignedAt} /> : null}

      {open && !bothDone ? (
        <WitnessForm token={token} slot={done1 ? 2 : 1} onSaved={async () => { setOpen(false); await onSaved(); }} />
      ) : null}
    </div>
  );
}

function WitnessDone({ n, name, at }: { n: number; name: string | null; at: string | null }) {
  return (
    <p style={{ fontSize: 13, color: "#166534", marginTop: 10 }}>
      ✅ Testigo {n}: <strong>{name}</strong> · {fmtDateTime(at)}
    </p>
  );
}

function WitnessForm({
  token, slot, onSaved,
}: {
  token: string;
  slot: 1 | 2;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setMsg("Escribe el nombre del testigo."); return; }
    if (!signature) { setMsg("El testigo debe firmar en el recuadro."); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/consent/public/${token}/witness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ witness: slot, name: name.trim(), signatureDataUrl: signature }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? "No se pudo guardar la firma del testigo.");
      await onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>
        Nombre completo del testigo {slot}
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre y apellidos"
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 10,
          border: "1px solid #cbd5e1", fontSize: 14, marginBottom: 12,
          background: "#fff", color: "#0f172a",
        }}
      />
      <SignaturePad
        theme="light"
        width={640}
        height={170}
        onChange={setSignature}
        ariaLabel={`Recuadro de firma del testigo ${slot}`}
        hintLabel="Firma del testigo"
      />
      {msg ? <p style={{ fontSize: 12, color: "#b91c1c", marginTop: 10 }}>{msg}</p> : null}
      <button
        type="button"
        onClick={save}
        disabled={busy}
        style={{
          marginTop: 12, width: "100%", padding: 12, borderRadius: 12, border: "none",
          background: busy ? "#e2e8f0" : "#0f172a", color: busy ? "#94a3b8" : "#fff",
          fontWeight: 700, fontSize: 14, cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Guardando…" : `Guardar firma del testigo ${slot}`}
      </button>
    </div>
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
