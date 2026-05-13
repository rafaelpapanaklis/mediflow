"use client";

import { useEffect, useState } from "react";
import { X, ShieldCheck, Save, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { CumsSelector, type PrescriptionItemDraft } from "@/components/dashboard/clinical/cums-selector";

const COFEPRIS_ETA: Record<string, string> = {
  I:   "24 horas",
  II:  "30 días",
  III: "90 días",
  IV:  "180 días",
  V:   "180 días",
  VI:  "180 días",
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
 */
export function PrescriptionModal({ open, patientId, medicalRecordId, onClose, onCreated }: Props) {
  const [items, setItems] = useState<PrescriptionItemDraft[]>([]);
  const [indications, setIndications] = useState("");
  const [cofeprisFolio, setCofeprisFolio] = useState("");
  const [signCheck, setSignCheck] = useState(false);
  const [keyPassword, setKeyPassword] = useState("");
  const [cert, setCert] = useState<CertInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems([]); setIndications(""); setCofeprisFolio(""); setSignCheck(false); setKeyPassword("");
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
      toast.error("Agrega al menos un medicamento");
      return;
    }
    for (const it of items) {
      if (!it.dosage.trim()) {
        toast.error("Cada medicamento requiere dosis (ej. 1 tableta cada 8h)");
        return;
      }
    }
    if (signCheck && !keyPassword) {
      toast.error("Para firmar, ingresá la contraseña de tu llave SAT");
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
          cofeprisGroup: cofeprisGroup || undefined,
          cofeprisFolio: cofeprisFolio || undefined,
        }),
      });
      const rx = await rxRes.json();
      if (!rxRes.ok) {
        toast.error(rx.error ?? rx.detail ?? "No se pudo crear la receta");
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
          toast.error(`Receta creada pero firma falló: ${err.error ?? "error"}`);
        } else {
          toast.success("Receta creada y firmada electrónicamente");
        }
      } else {
        toast.success("Receta creada");
      }

      onCreated?.({ id: rx.id, verifyUrl: rx.verifyUrl });
      onClose();
    } catch (err) {
      toast.error(`Error: ${String(err)}`);
    } finally {
      setSubmitting(false);
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
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      }}>
        <header style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 id="rx-modal-title" style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Nueva receta médica</h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{
            width: 28, height: 28, display: "grid", placeItems: "center",
            background: "transparent", border: "none", cursor: "pointer", color: "var(--text-3)",
          }}>
            <X size={14} aria-hidden />
          </button>
        </header>

        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Medicamentos *</label>
            <CumsSelector items={items} onChange={setItems} disabled={submitting} />
          </div>

          {cofeprisGroup && (
            <div style={{ padding: "8px 12px", background: "rgba(220, 38, 38, 0.08)", border: "1px solid rgba(220, 38, 38, 0.30)", borderRadius: 8, fontSize: 12, color: "#b91c1c" }}>
              <strong>Sustancia controlada — Grupo COFEPRIS {cofeprisGroup}.</strong>{" "}
              Vigencia legal: {COFEPRIS_ETA[cofeprisGroup] ?? "180 días"}.
            </div>
          )}

          <div>
            <label style={labelStyle}>Indicaciones generales (opcional)</label>
            <textarea
              className="input-new"
              style={{ minHeight: 64, padding: "10px 12px", resize: "vertical", width: "100%" }}
              placeholder="Reposo, dieta, signos de alarma…"
              value={indications}
              onChange={(e) => setIndications(e.target.value)}
              disabled={submitting}
            />
          </div>

          {cofeprisGroup && (cofeprisGroup === "I" || cofeprisGroup === "II") && (
            <div>
              <label style={labelStyle}>Folio COFEPRIS (Grupo {cofeprisGroup})</label>
              <input
                className="input-new"
                style={{ width: "100%" }}
                placeholder="Folio del receteario oficial"
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
                Firmar electrónicamente con FIEL/SAT
              </label>
              {signCheck && (
                <input
                  type="password"
                  className="input-new"
                  style={{ width: "100%" }}
                  placeholder="Contraseña de tu llave privada SAT"
                  value={keyPassword}
                  onChange={(e) => setKeyPassword(e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                />
              )}
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                Cert válido hasta {new Date(cert.validUntil).toLocaleDateString("es-MX")}.
              </span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-3)", padding: "6px 4px" }}>
              No tienes certificado FIEL/SAT activo. Configúralo en /dashboard/settings/signature
              para firmar recetas electrónicamente.
            </div>
          )}
        </div>

        <footer style={{ padding: "14px 20px", borderTop: "1px solid var(--border-soft)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose} disabled={submitting} style={btnGhost}>Cancelar</button>
          <button type="button" onClick={submit} disabled={submitting || items.length === 0} style={btnPrimary}>
            {submitting ? <><Loader2 size={13} className="animate-spin" /> Guardando…</> : <><Save size={13} aria-hidden /> Crear receta</>}
          </button>
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
