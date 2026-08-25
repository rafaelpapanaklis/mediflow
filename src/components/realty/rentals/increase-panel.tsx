"use client";

// ═══════════════════════════════════════════════════════════════════════
// El aumento anual de la renta y EL TOPE DE LA CIUDAD DE MÉXICO.
//
// 🔴 El tope no es un texto de ayuda: es una reja. Si el inmueble está en
// la CDMX y el porcentaje pasa la inflación del año anterior, el botón de
// aplicar NO guarda — el servidor responde 409 y esta pantalla abre la
// confirmación explícita. Solo se guarda con esa confirmación, y entonces
// queda REGISTRADA en las notas del contrato con fecha, usuario, tope y
// motivo (buildIncreaseAckLine en src/lib/realty/inpc.ts).
//
// Si el INPC todavía no está capturado, esto NO truena ni inventa un
// número: lo dice con todas sus letras y deja capturar el porcentaje a
// mano. Un dato inventado en una cláusula de aumento es peor que un dato
// ausente.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Copy, ShieldAlert, TrendingUp } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { applyIncrease, formatPct, needsCapAck } from "@/lib/realty/inpc";
import { addMonthKey, formatMoney, monthLabel } from "@/lib/realty/rent-charges";
import type { RealtyCurrency, RealtyIncreaseRule } from "@/lib/realty/types";
import { Card, Field, Modal, Note, Pill } from "./ui";

interface IncreasePreview {
  rule: RealtyIncreaseRule;
  inpcPct: number | null;
  inpcYear: number | null;
  capPct: number | null;
  cdmx: boolean;
  suggestedPct: number | null;
  currentRent: number;
  suggestedRent: number | null;
  missing: "NINGUNO" | "INPC_SIN_CAPTURAR" | "PCT_SIN_PACTAR" | null;
  editableCharges: number;
  lockedCharges: number;
  currency: RealtyCurrency;
  propertyTitle: string;
  tenantName: string;
  acks: Array<{ date: string; userId: string; capPct: number | null; appliedPct: number; reason: string }>;
}

export function IncreasePanel({
  dict,
  leaseId,
  currentMonth,
  onApplied,
}: {
  dict: Dictionary;
  leaseId: string;
  currentMonth: string;
  onApplied: () => void;
}) {
  const t = makeRealtyT(dict);
  const [preview, setPreview] = useState<IncreasePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState("");
  const [from, setFrom] = useState(addMonthKey(currentMonth, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // El porcentaje sugerido se siembra UNA vez. La carga se repite al cambiar
  // el mes (para que el conteo de cobros sea el del mes elegido), y sin este
  // candado ese refresco le borraría al usuario el porcentaje que ya escribió.
  const seeded = useRef(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/realty/leases/${leaseId}/increase?desde=${encodeURIComponent(from)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        const p = data?.preview as IncreasePreview | undefined;
        setPreview(p ?? null);
        if (!seeded.current && p?.suggestedPct !== null && p?.suggestedPct !== undefined) {
          seeded.current = true;
          setPct(String(p.suggestedPct));
        }
      })
      .catch(() => {
        if (alive) setError(t("common.genericError"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // `t` fuera de las dependencias A PROPÓSITO: makeRealtyT devuelve una
    // función NUEVA en cada render, y meterla aquí sería un bucle de fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaseId, from]);

  async function apply(acknowledged: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/leases/${leaseId}/increase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pct: Number(pct),
          effectiveFromMonth: from,
          overCapAcknowledged: acknowledged,
          overCapReason: reason,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 409 && data?.code === "OVER_CAP") {
        // La reja. No se guardó nada: se pide la confirmación explícita.
        setConfirmOpen(true);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(data?.error ?? t("common.genericError"));
        setBusy(false);
        return;
      }

      setConfirmOpen(false);
      setNotice(String(data?.notice ?? ""));
      toast.success(
        t("increase.toast.applied", { rent: formatMoney(Number(data?.newRent ?? 0), preview?.currency ?? "MXN") }),
      );
      onApplied();
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card title={t("increase.title")} sub={t("increase.subtitle")}>
        <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>{t("common.loading")}</p>
      </Card>
    );
  }

  if (!preview) {
    return (
      <Card title={t("increase.title")}>
        <Note tone="danger">{error ?? t("common.genericError")}</Note>
      </Card>
    );
  }

  const pctNumber = Number(pct);
  // La MISMA función que usa el servidor, no una fórmula copiada: `needsCapAck`
  // también pide confirmación cuando el tope se desconoce, y calcular la renta
  // en pesos con `rent * (1 + pct/100)` difería un centavo de lo que se guarda
  // (163,537.15 +50 % → el panel decía 245,305.72 y se guardaba 245,305.73).
  const overCap = needsCapAck({
    cdmx: preview.cdmx,
    pct: pctNumber,
    capPct: preview.capPct,
  });
  const newRent =
    Number.isFinite(pctNumber) && preview.currentRent > 0
      ? applyIncrease(preview.currentRent, pctNumber)
      : null;

  // Meses que se pueden elegir: desde el mes que viene y hasta un año.
  const months: string[] = [];
  for (let i = 1; i <= 13; i++) months.push(addMonthKey(currentMonth, i));

  return (
    <>
      <Card
        title={t("increase.title")}
        sub={t("increase.subtitle")}
        action={
          preview.cdmx ? (
            <Pill tone="brand" dot>
              CDMX
            </Pill>
          ) : null
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {error ? <Note tone="danger">{error}</Note> : null}

          <div className="rnt-grid rnt-grid--auto">
            <div>
              <div className="rnt-field__label">{t("increase.rule")}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {t(`leases.increaseRule.${preview.rule}`)}
              </div>
            </div>
            <div>
              <div className="rnt-field__label">
                {t("increase.inpc", { year: preview.inpcYear ?? "" })}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{formatPct(preview.inpcPct)}</div>
            </div>
            <div>
              <div className="rnt-field__label">{t("increase.cap")}</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: preview.cdmx ? "var(--brand)" : "var(--text-3)",
                }}
              >
                {preview.cdmx ? formatPct(preview.capPct) : t("common.none")}
              </div>
            </div>
            <div>
              <div className="rnt-field__label">{t("increase.current")}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {formatMoney(preview.currentRent, preview.currency)}
              </div>
            </div>
          </div>

          {preview.cdmx ? (
            <Note tone="brand">{t("increase.capLaw")}</Note>
          ) : (
            <Note tone="info">{t("increase.capNotApplies")}</Note>
          )}

          {preview.missing === "INPC_SIN_CAPTURAR" ? (
            <Note tone="warning">
              <strong>{t("increase.inpcMissing")}</strong>
              <br />
              {t("increase.inpcMissingBody")}
            </Note>
          ) : null}
          {preview.missing === "PCT_SIN_PACTAR" ? (
            <Note tone="warning">
              <strong>{t("increase.pctMissing")}</strong>
              <br />
              {t("increase.pctMissingBody")}
            </Note>
          ) : null}
          {preview.missing === "NINGUNO" ? <Note tone="info">{t("increase.noneRule")}</Note> : null}

          <div className="rnt-grid">
            <Field label={t("increase.pct")}>
              <input
                className="rnt-input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="-100"
                max="100"
                value={pct}
                onChange={(e) => setPct(e.target.value)}
              />
            </Field>
            <Field label={t("increase.effectiveFrom")}>
              <select className="rnt-select" value={from} onChange={(e) => setFrom(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {newRent !== null ? (
            <div className="rnt-grid rnt-grid--auto">
              <div>
                <div className="rnt-field__label">{t("increase.newRent")}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--brand)" }}>
                  {formatMoney(newRent, preview.currency)}
                </div>
              </div>
              <div>
                <div className="rnt-field__label">{t("increase.suggested")}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {preview.suggestedPct === null ? t("common.none") : formatPct(preview.suggestedPct)}
                </div>
              </div>
            </div>
          ) : null}

          {overCap ? (
            <Note tone="danger">
              <strong>{t("increase.overTitle")}</strong>
              <br />
              {t("increase.overBody", {
                cap: formatPct(preview.capPct),
                pct: formatPct(pctNumber),
              })}
            </Note>
          ) : null}

          <div className="rnt-field__hint">
            {t("increase.editable", { count: preview.editableCharges })}
            {preview.lockedCharges > 0
              ? ` ${t("increase.locked", { count: preview.lockedCharges })}`
              : ""}
          </div>

          <div className="rnt-toolbar">
            <button
              type="button"
              className="rnt-btn rnt-btn--primary"
              onClick={() => apply(false)}
              disabled={busy || !Number.isFinite(pctNumber) || pct.trim() === ""}
            >
              <TrendingUp size={15} />
              {busy ? t("common.saving") : t("increase.apply")}
            </button>
          </div>

          {preview.acks.length > 0 ? (
            <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
              <div className="rnt-field__label" style={{ marginBottom: 6 }}>
                <ShieldAlert size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                {t("increase.history")}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--text-3)" }}>
                {preview.acks.map((a, i) => (
                  <li key={i} style={{ marginBottom: 3 }}>
                    {t("increase.historyRow", {
                      date: a.date,
                      cap: formatPct(a.capPct),
                      pct: formatPct(a.appliedPct),
                    })}
                    {a.reason ? ` — ${a.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      {notice ? (
        <Card
          title={t("increase.noticeTitle")}
          sub={t("increase.noticeBody")}
          action={
            <button
              type="button"
              className="rnt-btn rnt-btn--sm"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(notice)
                  .then(() => toast.success(t("increase.toast.copied")))
                  .catch(() => undefined);
              }}
            >
              <Copy size={13} />
              {t("common.copy")}
            </button>
          }
        >
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "var(--text-2)",
            }}
          >
            {notice}
          </pre>
        </Card>
      ) : null}

      {/* La confirmación explícita. Sin ella el servidor no guarda nada. */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        closeLabel={t("common.close")}
        title={t("increase.overTitle")}
        footer={
          <>
            <button
              type="button"
              className="rnt-btn"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--danger"
              onClick={() => apply(true)}
              disabled={busy}
            >
              {busy ? t("common.saving") : t("increase.overConfirm")}
            </button>
          </>
        }
      >
        <Note tone="danger">
          {t("increase.overBody", {
            cap: formatPct(preview.capPct),
            pct: formatPct(pctNumber),
          })}
        </Note>
        <Note tone="info">{t("increase.capLaw")}</Note>
        <Field label={t("increase.overReason")} hint={t("increase.overReasonHint")}>
          <textarea
            className="rnt-textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Modal>
    </>
  );
}
