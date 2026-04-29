"use client";

import { useEffect, useState } from "react";
import { Plus, X, Send, Save, ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Cie10Selector } from "@/components/dashboard/clinical/cie10-selector";

interface ReferralRow {
  id: string;
  type: "OUTGOING" | "INCOMING";
  status: "SENT" | "ACCEPTED" | "REJECTED" | "RESPONDED" | "CANCELLED";
  toClinicName: string;
  toClinicClues: string | null;
  toDoctorName: string | null;
  toSpecialty: string | null;
  reason: string;
  clinicalSummary: string;
  relevantDiagnoses: { code: string; description: string; isPrimary?: boolean }[] | null;
  sentAt: string;
  respondedAt: string | null;
  response: string | null;
  patient?: { firstName: string; lastName: string; patientNumber: string };
  fromDoctor?: { firstName: string; lastName: string; cedulaProfesional: string | null };
}

interface Diagnosis {
  id: string;
  cie10Code: string;
  isPrimary: boolean;
  note: string | null;
  cie10?: { code: string; description: string; chapter: string };
}

interface Props {
  patientId: string;
}

const STATUS_LABEL: Record<ReferralRow["status"], string> = {
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  RESPONDED: "Respondida",
  CANCELLED: "Cancelada",
};
const STATUS_COLOR: Record<ReferralRow["status"], string> = {
  SENT: "#2563eb",
  ACCEPTED: "#059669",
  REJECTED: "#b91c1c",
  RESPONDED: "#7c3aed",
  CANCELLED: "#64748b",
};

export function ReferralsTab({ patientId }: Props) {
  const [list, setList] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/referrals?patientId=${patientId}`);
      if (res.ok) {
        const data = await res.json();
        setList(data.referrals ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">Referencias y contrarreferencias</h3>
          <p className="text-xs text-muted-foreground">
            Documentos NOM-024 para envío a otra clínica/especialista o respuesta de regreso.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
        >
          <Plus size={13} /> Nueva referencia
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground p-4">Cargando…</div>
      ) : list.length === 0 ? (
        <div className="text-xs text-muted-foreground p-4 bg-card border border-border rounded-xl">
          Sin referencias registradas para este paciente.
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((r) => <ReferralCard key={r.id} ref={r} onChanged={load} />)}
        </div>
      )}

      {showForm && (
        <NewReferralModal
          patientId={patientId}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); load(); }}
        />
      )}
    </div>
  );
}

function ReferralCard({ ref: r, onChanged }: { ref: ReferralRow; onChanged: () => void }) {
  const [responding, setResponding] = useState(false);
  const [response, setResponse] = useState("");
  const isOutgoing = r.type === "OUTGOING";
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isOutgoing ? <ArrowUpRight size={14} className="text-blue-600" /> : <ArrowDownLeft size={14} className="text-violet-600" />}
          <span className="text-xs font-bold">
            {isOutgoing ? "Referencia →" : "Contrarreferencia ←"} {r.toClinicName}
          </span>
        </div>
        <span style={{ padding: "2px 8px", fontSize: 10, fontWeight: 700, borderRadius: 99, color: "#fff", background: STATUS_COLOR[r.status] }}>
          {STATUS_LABEL[r.status]}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mb-2">
        {new Date(r.sentAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
        {r.toClinicClues && <> · CLUES <code className="font-mono">{r.toClinicClues}</code></>}
        {r.toSpecialty && <> · {r.toSpecialty}</>}
        {r.toDoctorName && <> · {r.toDoctorName}</>}
      </div>
      <div className="text-xs space-y-1.5 mb-2">
        <div><strong>Motivo:</strong> {r.reason}</div>
        <div><strong>Resumen clínico:</strong> {r.clinicalSummary}</div>
        {r.relevantDiagnoses && r.relevantDiagnoses.length > 0 && (
          <div>
            <strong>Diagnósticos:</strong>{" "}
            {r.relevantDiagnoses.map((d) => (
              <span key={d.code} className="inline-block px-1.5 py-0.5 mr-1 mt-0.5 bg-muted text-xs rounded font-mono">{d.code}</span>
            ))}
          </div>
        )}
        {r.response && (
          <div className="pt-2 border-t border-border mt-2">
            <strong>Respuesta:</strong> {r.response}
            {r.respondedAt && <span className="text-muted-foreground"> · {new Date(r.respondedAt).toLocaleDateString("es-MX")}</span>}
          </div>
        )}
      </div>
      {r.status === "SENT" && (
        <div className="flex gap-2 pt-2 border-t border-border">
          {!responding ? (
            <button type="button" onClick={() => setResponding(true)} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">
              Marcar respondida
            </button>
          ) : (
            <div className="flex-1 flex flex-col gap-2">
              <textarea
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                rows={2}
                placeholder="Notas de la respuesta…"
                className="w-full px-2 py-1.5 text-xs border border-border rounded resize-y"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch(`/api/referrals/${r.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "RESPONDED", response }),
                    });
                    if (res.ok) { toast.success("Marcada respondida"); setResponding(false); setResponse(""); onChanged(); }
                    else toast.error("Error");
                  }}
                  className="px-3 py-1 text-xs rounded bg-brand-600 text-white"
                >Guardar</button>
                <button type="button" onClick={() => setResponding(false)} className="px-3 py-1 text-xs rounded border border-border">Cancelar</button>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={async () => {
              if (!confirm("¿Cancelar esta referencia?")) return;
              const res = await fetch(`/api/referrals/${r.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "CANCELLED" }),
              });
              if (res.ok) { toast.success("Cancelada"); onChanged(); }
              else toast.error("Error");
            }}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-rose-50 text-rose-600 ml-auto"
          >Cancelar</button>
        </div>
      )}
    </div>
  );
}

function NewReferralModal({ patientId, onClose, onCreated }: { patientId: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    type: "OUTGOING" as "OUTGOING" | "INCOMING",
    toClinicName: "",
    toClinicClues: "",
    toDoctorName: "",
    toSpecialty: "",
    reason: "",
    clinicalSummary: "",
  });
  const [dxs, setDxs] = useState<Diagnosis[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function addDx(input: { cie10Code: string; isPrimary: boolean; note?: string }) {
    // Local-only state — la referral persiste el array al submit.
    // Hacemos un GET al catálogo para hidratar el cie10 description.
    try {
      const res = await fetch(`/api/catalogs/cie10?q=${encodeURIComponent(input.cie10Code)}&limit=1`);
      const data = await res.json();
      const code = data.codes?.[0];
      if (!code) {
        toast.error("Código CIE-10 no encontrado");
        return;
      }
      setDxs((prev) => {
        const filtered = input.isPrimary ? prev.map((d) => ({ ...d, isPrimary: false })) : prev;
        return [...filtered, {
          id: `local-${Date.now()}`,
          cie10Code: input.cie10Code,
          isPrimary: input.isPrimary,
          note: input.note ?? null,
          cie10: code,
        }];
      });
    } catch {
      toast.error("Error al agregar diagnóstico");
    }
  }

  async function removeDx(dxId: string) {
    setDxs((prev) => prev.filter((d) => d.id !== dxId));
  }

  async function submit() {
    if (!form.toClinicName.trim() || !form.reason.trim() || !form.clinicalSummary.trim()) {
      toast.error("Clínica destino, motivo y resumen son obligatorios");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          type: form.type,
          toClinicName: form.toClinicName.trim(),
          toClinicClues: form.toClinicClues.trim() || undefined,
          toDoctorName: form.toDoctorName.trim() || undefined,
          toSpecialty: form.toSpecialty.trim() || undefined,
          reason: form.reason.trim(),
          clinicalSummary: form.clinicalSummary.trim(),
          relevantDiagnoses: dxs.length > 0
            ? dxs.map((d) => ({ code: d.cie10Code, description: d.cie10?.description ?? "", isPrimary: d.isPrimary }))
            : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Error al crear");
      }
      toast.success("Referencia creada");
      onCreated();
    } catch (err) {
      toast.error(`Error: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15, 10, 30, 0.55)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border-strong)", borderRadius: 14, width: "100%", maxWidth: 640, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Nueva referencia / contrarreferencia</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
            <X size={14} />
          </button>
        </header>
        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Tipo">
            <div style={{ display: "flex", gap: 6 }}>
              {(["OUTGOING", "INCOMING"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, type: t })}
                  style={{
                    flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: 600,
                    borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                    background: form.type === t ? "var(--brand)" : "var(--bg-elev-2)",
                    color: form.type === t ? "#fff" : "var(--text-2)",
                    border: `1px solid ${form.type === t ? "var(--brand)" : "var(--border-soft)"}`,
                  }}
                >
                  {t === "OUTGOING" ? "Referencia (envío)" : "Contrarreferencia (recibo)"}
                </button>
              ))}
            </div>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <Field label="Clínica destino *">
              <input className="input-new" value={form.toClinicName} onChange={(e) => setForm({ ...form, toClinicName: e.target.value })} placeholder="Hospital General de México" />
            </Field>
            <Field label="CLUES (opcional)">
              <input className="input-new" maxLength={11} value={form.toClinicClues} onChange={(e) => setForm({ ...form, toClinicClues: e.target.value.toUpperCase().trim() })} placeholder="11 chars" />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Médico receptor">
              <input className="input-new" value={form.toDoctorName} onChange={(e) => setForm({ ...form, toDoctorName: e.target.value })} placeholder="Dr/a. nombre" />
            </Field>
            <Field label="Especialidad solicitada">
              <input className="input-new" value={form.toSpecialty} onChange={(e) => setForm({ ...form, toSpecialty: e.target.value })} placeholder="Cardiología, Oncología…" />
            </Field>
          </div>
          <Field label="Motivo de la referencia *">
            <textarea className="input-new" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ej: requiere evaluación cardiológica" style={{ resize: "vertical" }} />
          </Field>
          <Field label="Resumen clínico *">
            <textarea className="input-new" rows={5} value={form.clinicalSummary} onChange={(e) => setForm({ ...form, clinicalSummary: e.target.value })} placeholder="Antecedentes, evolución, estudios realizados, hallazgos relevantes…" style={{ resize: "vertical" }} />
          </Field>
          <Field label="Diagnósticos relevantes (CIE-10)">
            <Cie10Selector diagnoses={dxs} onAdd={addDx} onRemove={removeDx} />
          </Field>
        </div>
        <footer style={{ padding: "14px 20px", borderTop: "1px solid var(--border-soft)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} disabled={submitting} style={btnGhost}>Cancelar</button>
          <button type="button" onClick={submit} disabled={submitting} style={btnPrimary}>
            {submitting ? <><Loader2 size={13} className="animate-spin" /> Enviando…</> : <><Send size={13} /> Crear referencia</>}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      {children}
    </label>
  );
}

const btnGhost: React.CSSProperties = {
  padding: "8px 14px", fontSize: 13, fontWeight: 600,
  background: "transparent", color: "var(--text-2)",
  border: "1px solid var(--border-strong)", borderRadius: 8,
  cursor: "pointer", fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 700,
  background: "var(--brand, #2563eb)", color: "#fff",
  border: "1px solid var(--brand, #2563eb)", borderRadius: 8,
  cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 6,
};
