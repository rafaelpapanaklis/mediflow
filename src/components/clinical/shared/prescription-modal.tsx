"use client";

import { useEffect, useState } from "react";
import { X, ShieldCheck, Save, Loader2, CheckCircle2, Sparkles, AlertTriangle, ShieldAlert, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { CumsSelector, type PrescriptionItemDraft } from "@/components/dashboard/clinical/cums-selector";
import { INDICATION_TEMPLATES } from "@/lib/clinical/indication-templates";
import { useT } from "@/i18n/i18n-provider";

const COFEPRIS_ETA_KEY: Record<string, string> = {
  I:   "clinical.prescriptionModal.eta24h",
  II:  "clinical.prescriptionModal.eta30d",
  III: "clinical.prescriptionModal.eta90d",
  IV:  "clinical.prescriptionModal.eta180d",
  V:   "clinical.prescriptionModal.eta180d",
  VI:  "clinical.prescriptionModal.eta180d",
};

interface CertInfo {
  id: string;
  cerSerial: string;
  validUntil: string;
}

type Verdict = "OK" | "PRECAUCION" | "CONTRAINDICADO";
interface AiPerMed {
  name: string;
  verdict: Verdict;
  reason: string;
  saferAlternative?: string | null;
}
interface AiInteraction {
  pair: string;
  severity: "leve" | "moderada" | "grave";
  reason: string;
}
interface AiCheckResult {
  perMedication: AiPerMed[];
  interactions: AiInteraction[];
  summary: string;
  checkedAt: string;
  modelUsed: string;
  /** Firma de la lista de medicamentos al momento de revisar (solo cliente). */
  __sig?: string;
}

interface Props {
  open: boolean;
  patientId: string;
  /**
   * Si la receta corresponde a una consulta guardada (flujo "Iniciar consulta"),
   * pásalo. Si no, se emite standalone (caso "Crear receta" desde formularios
   * clínicos) — el backend acepta `medicalRecordId` null.
   */
  medicalRecordId?: string | null;
  onClose: () => void;
  onCreated?: (rx: { id: string; verifyUrl: string }) => void;
}

/**
 * Modal de creación de receta NOM-024 con FK a CUMS.
 *
 * Al abrir:
 *  - GET /api/signature/cert para saber si el doctor tiene cert activo.
 *
 * Al guardar:
 *  - POST /api/prescriptions con items (cumsKey + dosage*).
 *  - Si checkbox "Firmar electrónicamente" está activo y hay cert,
 *    POST /api/signature/sign con docType=PRESCRIPTION.
 *  - Tras crear, muestra un paso de éxito dentro del modal con acciones:
 *    PDF, enviar por WhatsApp/email y verificación pública.
 */
export function PrescriptionModal({ open, patientId, medicalRecordId, onClose, onCreated }: Props) {
  const t = useT();
  const [items, setItems] = useState<PrescriptionItemDraft[]>([]);
  const [indications, setIndications] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [cofeprisFolio, setCofeprisFolio] = useState("");
  const [signCheck, setSignCheck] = useState(false);
  const [keyPassword, setKeyPassword] = useState("");
  const [cert, setCert] = useState<CertInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdRx, setCreatedRx] = useState<{ id: string; verifyUrl: string } | null>(null);
  const [sendingVia, setSendingVia] = useState<null | "whatsapp" | "email">(null);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiResult, setAiResult] = useState<AiCheckResult | null>(null);
  const [expandedMed, setExpandedMed] = useState<number | null>(null);
  const [confirmContra, setConfirmContra] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems([]); setIndications(""); setDiagnosis(""); setValidUntil(""); setCofeprisFolio(""); setSignCheck(false); setKeyPassword("");
    setCreatedRx(null); setSendingVia(null);
    setAiChecking(false); setAiResult(null); setExpandedMed(null); setConfirmContra(false);
    fetch("/api/signature/cert")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.cert && new Date(d.cert.validUntil) > new Date()) {
          setCert({ id: d.cert.id, cerSerial: d.cert.cerSerial, validUntil: d.cert.validUntil });
        } else {
          setCert(null);
        }
      })
      .catch(() => setCert(null));
  }, [open]);

  // Auto-detect grupo COFEPRIS más restrictivo en los items seleccionados
  const cofeprisGroup = items
    .map((it) => it.cums?.cofeprisGroup)
    .filter((g): g is string => !!g)
    .sort()[0] ?? null; // I < II < III < ... → primero alfabéticamente

  // Firma de la lista actual: si cambia tras una revisión IA, los chips quedan
  // "stale" (la decisión de contraindicado deja de aplicar hasta re-revisar).
  const itemsSig = items.map((it) => `${it.cumsKey}|${(it.dosage || "").trim()}`).join("~");
  const aiStale = aiResult ? aiResult.__sig !== itemsSig : false;
  const hasContra = !!aiResult && !aiStale && aiResult.perMedication.some((m) => m.verdict === "CONTRAINDICADO");

  if (!open) return null;

  // Revisión IA de contraindicaciones. El contexto clínico lo arma el servidor
  // desde la BD; aquí solo enviamos IDs/nombres de los medicamentos.
  async function runAiCheck() {
    if (items.length === 0 || aiChecking) return;
    setAiChecking(true);
    setExpandedMed(null);
    try {
      const res = await fetch("/api/prescriptions/check-contraindications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          items: items.map((it) => ({
            cumsKey: it.cumsKey,
            name: it.cums?.descripcion ?? it.cumsKey,
            dosage: it.dosage || undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo revisar con IA.");
        return;
      }
      setAiResult({
        perMedication: Array.isArray(data.perMedication) ? data.perMedication : [],
        interactions: Array.isArray(data.interactions) ? data.interactions : [],
        summary: typeof data.summary === "string" ? data.summary : "",
        checkedAt: typeof data.checkedAt === "string" ? data.checkedAt : new Date().toISOString(),
        modelUsed: typeof data.modelUsed === "string" ? data.modelUsed : "",
        __sig: itemsSig,
      });
    } catch (err) {
      toast.error("Error al revisar con IA.");
    } finally {
      setAiChecking(false);
    }
  }

  // Gate de envío: valida y, si la revisión IA vigente marcó algún medicamento
  // CONTRAINDICADO, pide confirmación explícita. Nunca bloqueo duro.
  function submit() {
    if (items.length === 0) {
      toast.error(t("clinical.prescriptionModal.errorNoMeds"));
      return;
    }
    for (const it of items) {
      if (!it.dosage.trim()) {
        toast.error(t("clinical.prescriptionModal.errorNoDosage"));
        return;
      }
    }
    if (signCheck && !keyPassword) {
      toast.error(t("clinical.prescriptionModal.errorNoKeyPassword"));
      return;
    }
    if (hasContra) {
      setConfirmContra(true);
      return;
    }
    void doCreate();
  }

  async function doCreate() {
    setConfirmContra(false);
    setSubmitting(true);
    try {
      const rxRes = await fetch("/api/prescriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          medicalRecordId: medicalRecordId ?? undefined,
          items: items.map((it) => ({
            cumsKey: it.cumsKey,
            dosage: it.dosage,
            duration: it.duration || undefined,
            quantity: it.quantity || undefined,
            notes: it.notes || undefined,
          })),
          indications: indications || undefined,
          diagnosis: diagnosis.trim() || undefined,
          expiresAt: validUntil ? new Date(validUntil + "T23:59:59").toISOString() : undefined,
          cofeprisGroup: cofeprisGroup || undefined,
          cofeprisFolio: cofeprisFolio || undefined,
          // Evidencia del chequeo IA (solo si está vigente para la lista actual).
          aiCheck: aiResult && !aiStale
            ? {
                perMedication: aiResult.perMedication,
                interactions: aiResult.interactions,
                summary: aiResult.summary,
                checkedAt: aiResult.checkedAt,
                modelUsed: aiResult.modelUsed,
              }
            : undefined,
        }),
      });
      const rx = await rxRes.json();
      if (!rxRes.ok) {
        toast.error(rx.error ?? rx.detail ?? t("clinical.prescriptionModal.errorCreate"));
        setSubmitting(false);
        return;
      }

      // Firma electrónica opcional
      if (signCheck && cert) {
        const signRes = await fetch("/api/signature/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: "PRESCRIPTION",
            docId: rx.id,
            content: { id: rx.id, qrCode: rx.qrCode, items: rx.items, issuedAt: rx.issuedAt },
            keyPassword,
          }),
        });
        if (!signRes.ok) {
          const err = await signRes.json().catch(() => ({}));
          toast.error(t("clinical.prescriptionModal.errorSignFailed", { error: err.error ?? "error" }));
        } else {
          toast.success(t("clinical.prescriptionModal.successCreatedSigned"));
        }
      } else {
        toast.success(t("clinical.prescriptionModal.successCreated"));
      }

      onCreated?.({ id: rx.id, verifyUrl: rx.verifyUrl });
      setCreatedRx({ id: rx.id, verifyUrl: rx.verifyUrl });
    } catch (err) {
      toast.error(t("clinical.prescriptionModal.errorGeneric", { error: String(err) }));
    } finally {
      setSubmitting(false);
    }
  }

  async function sendVia(via: "whatsapp" | "email") {
    if (!createdRx || sendingVia) return;
    setSendingVia(via);
    try {
      const res = await fetch(`/api/prescriptions/${createdRx.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ via }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(t("clinical.prescriptionModal.sendFailed", { error: err.error ?? err.detail ?? String(res.status) }));
      } else {
        toast.success(t("clinical.prescriptionModal.sent"));
      }
    } catch (err) {
      toast.error(t("clinical.prescriptionModal.sendFailed", { error: String(err) }));
    } finally {
      setSendingVia(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rx-modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15, 10, 30, 0.55)", backdropFilter: "blur(4px)",
        display: "grid", placeItems: "center", zIndex: 100, padding: 20,
      }}
    >
      <div style={{
        background: "var(--bg-elev)", border: "1px solid var(--border-strong)",
        borderRadius: 14, width: "100%", maxWidth: 720, maxHeight: "90vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}>
        <header style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 id="rx-modal-title" style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t("clinical.prescriptionModal.title")}</h3>
          <button type="button" onClick={onClose} aria-label={t("common.close")} style={{
            width: 28, height: 28, display: "grid", placeItems: "center",
            background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)",
          }}>
            <X size={14} aria-hidden />
          </button>
        </header>

        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {createdRx ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "6px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <CheckCircle2 size={22} aria-hidden style={{ color: "#059669", flexShrink: 0 }} />
                <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{t("clinical.prescriptionModal.successTitle")}</h4>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{t("clinical.prescriptionModal.successHint")}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <a
                  href={`/api/prescriptions/${createdRx.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {t("clinical.prescriptionModal.actionPdf")}
                </a>
                <button
                  type="button"
                  onClick={() => sendVia("whatsapp")}
                  disabled={sendingVia !== null}
                  style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {sendingVia === "whatsapp" && <Loader2 size={13} className="animate-spin" aria-hidden />}
                  {t("clinical.prescriptionModal.actionWhatsApp")}
                </button>
                <button
                  type="button"
                  onClick={() => sendVia("email")}
                  disabled={sendingVia !== null}
                  style={{ ...btnGhost, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {sendingVia === "email" && <Loader2 size={13} className="animate-spin" aria-hidden />}
                  {t("clinical.prescriptionModal.actionEmail")}
                </button>
                <a
                  href={createdRx.verifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  {t("clinical.prescriptionModal.actionVerify")}
                </a>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label style={labelStyle}>{t("clinical.prescriptionModal.medicationsLabel")}</label>
                <CumsSelector items={items} onChange={setItems} disabled={submitting} />
              </div>

              {cofeprisGroup && (
                <div style={{ padding: "8px 12px", background: "rgba(220, 38, 38, 0.08)", border: "1px solid rgba(220, 38, 38, 0.30)", borderRadius: 8, fontSize: 12, color: "#b91c1c" }}>
                  <strong>{t("clinical.prescriptionModal.controlledSubstance", { group: cofeprisGroup })}</strong>{" "}
                  {t("clinical.prescriptionModal.legalValidity", { eta: t(COFEPRIS_ETA_KEY[cofeprisGroup] ?? "clinical.prescriptionModal.eta180d") })}
                </div>
              )}

              {/* ── Revisión IA de contraindicaciones ── */}
              <div style={{ border: "1px solid var(--border-soft)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
                    <Sparkles size={14} aria-hidden style={{ color: "var(--brand)" }} />
                    Revisión de contraindicaciones
                  </span>
                  <button
                    type="button"
                    onClick={runAiCheck}
                    disabled={submitting || aiChecking || items.length === 0}
                    style={{
                      ...btnGhost,
                      display: "inline-flex", alignItems: "center", gap: 6,
                      opacity: (aiChecking || items.length === 0) ? 0.55 : 1,
                      cursor: (submitting || aiChecking || items.length === 0) ? "default" : "pointer",
                    }}
                  >
                    {aiChecking ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />}
                    {aiResult ? "Volver a revisar" : "Revisar con IA"}
                  </button>
                </div>

                {!aiResult && !aiChecking && (
                  <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: 0 }}>
                    {items.length === 0
                      ? "Agrega medicamentos para poder revisarlos."
                      : "Revisa alergias, padecimientos, edad e interacciones entre los medicamentos de esta receta."}
                  </p>
                )}

                {aiResult && (
                  <>
                    {aiStale && (
                      <div style={{ fontSize: 11.5, color: "#b45309", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.30)", borderRadius: 8, padding: "6px 10px" }}>
                        La lista de medicamentos cambió. Vuelve a revisar para actualizar el análisis.
                      </div>
                    )}

                    {aiResult.summary && (
                      <p style={{ fontSize: 12, color: "var(--text-2)", margin: 0, lineHeight: 1.45, opacity: aiStale ? 0.55 : 1 }}>
                        {aiResult.summary}
                      </p>
                    )}

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: aiStale ? 0.55 : 1 }}>
                      {aiResult.perMedication.map((m, idx) => {
                        const c = VERDICT_STYLE[m.verdict] ?? VERDICT_STYLE.PRECAUCION;
                        const isOpen = expandedMed === idx;
                        return (
                          <div key={idx} style={{ border: `1px solid ${c.border}`, background: c.bg, borderRadius: 8, overflow: "hidden" }}>
                            <button
                              type="button"
                              onClick={() => setExpandedMed(isOpen ? null : idx)}
                              style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                            >
                              <span style={{ width: 8, height: 8, borderRadius: 99, background: c.dot, flexShrink: 0 }} aria-hidden />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.03em", color: c.text, textTransform: "uppercase", flexShrink: 0 }}>{c.label}</span>
                              <ChevronDown size={13} aria-hidden style={{ color: "var(--text-3)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
                            </button>
                            {isOpen && (
                              <div style={{ padding: "0 10px 9px 26px", display: "flex", flexDirection: "column", gap: 4 }}>
                                <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.45 }}>{m.reason}</span>
                                {m.saferAlternative && (
                                  <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>
                                    <strong style={{ color: "var(--text-1)" }}>Alternativa más segura:</strong> {m.saferAlternative}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {aiResult.interactions.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, opacity: aiStale ? 0.55 : 1 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Interacciones entre medicamentos</span>
                        {aiResult.interactions.map((it, idx) => {
                          const sc = SEVERITY_COLOR[it.severity] ?? SEVERITY_COLOR.moderada;
                          return (
                            <div key={idx} style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.4 }}>
                              <AlertTriangle size={12} aria-hidden style={{ color: sc, flexShrink: 0, marginTop: 2 }} />
                              <span>
                                <strong style={{ color: "var(--text-1)" }}>{it.pair}</strong>
                                {" · "}
                                <span style={{ color: sc, fontWeight: 700, textTransform: "capitalize" }}>{it.severity}</span>
                                {" — "}{it.reason}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                <p style={{ fontSize: 10.5, color: "var(--text-3)", margin: 0, fontStyle: "italic" }}>
                  Apoyo informativo generado con IA; no sustituye el juicio clínico.
                </p>
              </div>

              <div>
                <label style={labelStyle}>{t("clinical.prescriptionModal.diagnosisLabel")}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 56, padding: "10px 12px", resize: "vertical", width: "100%" }}
                  placeholder={t("clinical.prescriptionModal.diagnosisPlaceholder")}
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>{t("clinical.prescriptionModal.generalIndicationsLabel")}</label>
                  <select
                    aria-label="Plantilla de indicaciones"
                    value=""
                    disabled={submitting}
                    onChange={(e) => {
                      const tpl = INDICATION_TEMPLATES.find((x) => x.id === e.target.value);
                      e.currentTarget.value = "";
                      if (!tpl) return;
                      setIndications((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${tpl.text}` : tpl.text));
                    }}
                    style={{
                      fontSize: 12, padding: "5px 8px", borderRadius: 8, maxWidth: "100%",
                      border: "1px solid var(--border-strong)", background: "var(--bg-elev)",
                      color: "var(--text-2)", cursor: submitting ? "default" : "pointer", fontFamily: "inherit",
                    }}
                  >
                    <option value="" disabled>+ Plantilla de indicaciones…</option>
                    {INDICATION_TEMPLATES.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="input-new"
                  style={{ minHeight: 64, padding: "10px 12px", resize: "vertical", width: "100%" }}
                  placeholder={t("clinical.prescriptionModal.indicationsPlaceholder")}
                  value={indications}
                  onChange={(e) => setIndications(e.target.value)}
                  disabled={submitting}
                />
                <span style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                  Se imprimen en la receta del paciente. Elige una plantilla y edítala, o combina varias.
                </span>
              </div>

              <div>
                <label style={labelStyle}>{t("clinical.prescriptionModal.validityLabel")}</label>
                <input
                  type="date"
                  className="input-new"
                  style={{ width: "100%" }}
                  min={new Date().toISOString().slice(0, 10)}
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  disabled={submitting}
                />
                <span style={{ display: "block", fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                  {t("clinical.prescriptionModal.validityHint")}
                </span>
              </div>

              {cofeprisGroup && (cofeprisGroup === "I" || cofeprisGroup === "II") && (
                <div>
                  <label style={labelStyle}>{t("clinical.prescriptionModal.cofeprisFolioLabel", { group: cofeprisGroup })}</label>
                  <input
                    className="input-new"
                    style={{ width: "100%" }}
                    placeholder={t("clinical.prescriptionModal.cofeprisFolioPlaceholder")}
                    value={cofeprisFolio}
                    onChange={(e) => setCofeprisFolio(e.target.value.trim())}
                    disabled={submitting}
                  />
                </div>
              )}

              {/* Firma electrónica opcional */}
              {cert ? (
                <div style={{ padding: 12, background: "rgba(16, 185, 129, 0.06)", border: "1px solid rgba(16, 185, 129, 0.30)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                    <input type="checkbox" checked={signCheck} onChange={(e) => setSignCheck(e.target.checked)} disabled={submitting} />
                    <ShieldCheck size={14} aria-hidden style={{ color: "#059669" }} />
                    {t("clinical.prescriptionModal.signWithFiel")}
                  </label>
                  {signCheck && (
                    <input
                      type="password"
                      className="input-new"
                      style={{ width: "100%" }}
                      placeholder={t("clinical.prescriptionModal.keyPasswordPlaceholder")}
                      value={keyPassword}
                      onChange={(e) => setKeyPassword(e.target.value)}
                      disabled={submitting}
                      autoComplete="off"
                    />
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {t("clinical.prescriptionModal.certValidUntil", { date: new Date(cert.validUntil).toLocaleDateString("es-MX") })}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-3)", padding: "6px 4px" }}>
                  {t("clinical.prescriptionModal.noCert")}
                </div>
              )}
            </>
          )}
        </div>

        <footer style={{ padding: "14px 20px", borderTop: "1px solid var(--border-soft)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {createdRx ? (
            <button type="button" onClick={onClose} style={btnPrimary}>{t("clinical.prescriptionModal.done")}</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={submitting} style={btnGhost}>{t("common.cancel")}</button>
              <button type="button" onClick={submit} disabled={submitting || items.length === 0} style={btnPrimary}>
                {submitting ? <><Loader2 size={13} className="animate-spin" /> {t("common.saving")}</> : <><Save size={13} aria-hidden /> {t("clinical.prescriptionModal.createPrescription")}</>}
              </button>
            </>
          )}
        </footer>
      </div>

      {confirmContra && aiResult && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmContra(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15, 10, 30, 0.62)", display: "grid", placeItems: "center", zIndex: 110, padding: 20 }}
        >
          <div style={{ background: "var(--bg-elev)", border: "1px solid rgba(220, 38, 38, 0.45)", borderRadius: 12, width: "100%", maxWidth: 440, padding: 20, display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--font-sans, system-ui, sans-serif)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <ShieldAlert size={20} aria-hidden style={{ color: "#dc2626", flexShrink: 0 }} />
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>Medicamento contraindicado</h4>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
              La revisión con IA marcó como <strong style={{ color: "#b91c1c" }}>contraindicado</strong> al menos un medicamento de esta receta. Revisa el motivo antes de continuar — la decisión final es tuya.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              {aiResult.perMedication.filter((m) => m.verdict === "CONTRAINDICADO").map((m, i) => (
                <li key={i} style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.45 }}>
                  <strong style={{ color: "var(--text-1)" }}>{m.name}:</strong> {m.reason}
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setConfirmContra(false)} disabled={submitting} style={btnGhost}>Cancelar</button>
              <button
                type="button"
                onClick={() => void doCreate()}
                disabled={submitting}
                style={{ ...btnPrimary, background: "#dc2626", border: "1px solid #dc2626" }}
              >
                {submitting ? <><Loader2 size={13} className="animate-spin" /> Guardando…</> : "Recetar de todos modos"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-2)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 6,
};

const btnGhost: React.CSSProperties = {
  padding: "8px 14px", fontSize: 13, fontWeight: 600,
  background: "transparent", color: "var(--text-2)",
  border: "1px solid var(--border-strong)", borderRadius: 8,
  cursor: "pointer", fontFamily: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 700,
  background: "var(--brand)", color: "#fff",
  border: "1px solid var(--brand)", borderRadius: 8,
  cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", gap: 6,
};

// Paleta por veredicto IA — funciona en tema claro y oscuro (tonos medios).
const VERDICT_STYLE: Record<string, { label: string; text: string; bg: string; border: string; dot: string }> = {
  OK:             { label: "OK",             text: "#059669", bg: "rgba(16, 185, 129, 0.08)", border: "rgba(16, 185, 129, 0.32)", dot: "#10b981" },
  PRECAUCION:     { label: "Precaución",     text: "#b45309", bg: "rgba(245, 158, 11, 0.10)", border: "rgba(245, 158, 11, 0.34)", dot: "#f59e0b" },
  CONTRAINDICADO: { label: "Contraindicado", text: "#b91c1c", bg: "rgba(220, 38, 38, 0.09)",  border: "rgba(220, 38, 38, 0.34)",  dot: "#dc2626" },
};

const SEVERITY_COLOR: Record<string, string> = {
  leve:     "#d97706",
  moderada: "#ea580c",
  grave:    "#dc2626",
};
