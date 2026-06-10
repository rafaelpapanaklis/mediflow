"use client";

import { useEffect, useState } from "react";
import { X, ShieldCheck, Save, Loader2, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { CumsSelector, type PrescriptionItemDraft } from "@/components/dashboard/clinical/cums-selector";
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

  useEffect(() => {
    if (!open) return;
    setItems([]); setIndications(""); setDiagnosis(""); setValidUntil(""); setCofeprisFolio(""); setSignCheck(false); setKeyPassword("");
    setCreatedRx(null); setSendingVia(null);
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

  if (!open) return null;

  async function submit() {
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
                <label style={labelStyle}>{t("clinical.prescriptionModal.generalIndicationsLabel")}</label>
                <textarea
                  className="input-new"
                  style={{ minHeight: 64, padding: "10px 12px", resize: "vertical", width: "100%" }}
                  placeholder={t("clinical.prescriptionModal.indicationsPlaceholder")}
                  value={indications}
                  onChange={(e) => setIndications(e.target.value)}
                  disabled={submitting}
                />
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
