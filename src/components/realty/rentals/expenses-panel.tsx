"use client";

// ═══════════════════════════════════════════════════════════════════════
// Gastos del inmueble: predial, agua, mantenimiento, reparaciones y otros.
//
// Es la mitad que casi nadie captura y sin la cual el "rendimiento" de un
// inmueble es la renta bruta disfrazada de utilidad. Por eso la pantalla
// está aquí, junto a la cobranza, y no escondida en un reporte.
//
// 🔴 El comprobante es una liga que guarda el dueño. Este vertical NO
// factura: ni CFDI, ni timbrado, ni SAT.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { formatCents, formatMoney, formatShortDate } from "@/lib/realty/rent-charges";
import type { RealtyExpenseKind } from "@/lib/realty/types";
import { Card, EmptyState, Field, Modal, Note, Pill } from "./ui";

export interface ExpenseRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  kind: RealtyExpenseKind;
  amount: number;
  paidAt: string;
  note: string | null;
  receiptUrl: string | null;
}

const KINDS: RealtyExpenseKind[] = ["PREDIAL", "AGUA", "MANTENIMIENTO", "REPARACION", "OTRO"];

export function ExpensesPanel({
  dict,
  rows,
  totalCents,
  properties,
  canEdit,
  todayISO,
}: {
  dict: Dictionary;
  rows: ExpenseRow[];
  totalCents: number;
  properties: Array<{ id: string; title: string }>;
  canEdit: boolean;
  todayISO: string;
}) {
  const t = makeRealtyT(dict);
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterProperty, setFilterProperty] = useState("");

  const [propertyId, setPropertyId] = useState("");
  const [kind, setKind] = useState<RealtyExpenseKind>("PREDIAL");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayISO);
  const [note, setNote] = useState("");
  const [receiptUrl, setReceiptUrl] = useState("");

  const visible = useMemo(
    () => (filterProperty ? rows.filter((r) => r.propertyId === filterProperty) : rows),
    [rows, filterProperty],
  );

  const visibleTotalCents = useMemo(
    () => (filterProperty ? visible.reduce((sum, r) => sum + Math.round(r.amount * 100), 0) : totalCents),
    [filterProperty, visible, totalCents],
  );

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, kind, amount, paidAt, note, receiptUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error ?? t("common.genericError")));
        setBusy(false);
        return;
      }
      toast.success(t("expenses.toast.created"));
      setOpen(false);
      setAmount("");
      setNote("");
      setReceiptUrl("");
      router.refresh();
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    if (!window.confirm(t("expenses.deleteConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/realty/expenses/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("common.genericError")));
        return;
      }
      toast.success(t("expenses.toast.deleted"));
      router.refresh();
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        title={t("expenses.title")}
        sub={t("expenses.subtitle")}
        flush
        action={
          canEdit ? (
            <button
              type="button"
              className="rnt-btn rnt-btn--sm rnt-btn--primary"
              onClick={() => setOpen(true)}
            >
              <Plus size={13} />
              {t("expenses.new")}
            </button>
          ) : null
        }
      >
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <select
            className="rnt-select"
            style={{ maxWidth: 280 }}
            value={filterProperty}
            onChange={(e) => setFilterProperty(e.target.value)}
            aria-label={t("expenses.filterProperty")}
          >
            <option value="">{t("expenses.filterProperty")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <div style={{ textAlign: "right" }}>
            <div className="rnt-field__label">{t("expenses.totalLabel")}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCents(visibleTotalCents)}</div>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState title={t("expenses.empty.title")} body={t("expenses.empty.body")} />
        ) : (
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <thead>
                <tr>
                  <th>{t("expenses.table.date")}</th>
                  <th>{t("expenses.table.property")}</th>
                  <th>{t("expenses.table.kind")}</th>
                  <th className="num">{t("expenses.table.amount")}</th>
                  <th className="rnt-hide-sm">{t("expenses.table.note")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>{formatShortDate(r.paidAt)}</td>
                    <td className="rnt-strong">{r.propertyTitle}</td>
                    <td>
                      <Pill tone="neutral">{t(`expenses.kinds.${r.kind}`)}</Pill>
                    </td>
                    <td className="num rnt-strong">{formatMoney(r.amount)}</td>
                    <td className="rnt-hide-sm rnt-muted">
                      {r.note ?? "—"}
                      {r.receiptUrl ? (
                        <>
                          {" · "}
                          <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer">
                            {t("expenses.receiptUrl")}
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td className="num">
                      {canEdit ? (
                        <button
                          type="button"
                          className="rnt-btn rnt-btn--sm rnt-btn--danger"
                          onClick={() => remove(r.id)}
                          disabled={busy}
                          aria-label={t("common.delete")}
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        closeLabel={t("common.close")}
        title={t("expenses.new")}
        sub={t("expenses.subtitle")}
        footer={
          <>
            <button type="button" className="rnt-btn" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--primary"
              onClick={create}
              disabled={busy || !propertyId || amount.trim() === ""}
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </>
        }
      >
        {error ? <Note tone="danger">{error}</Note> : null}
        <Field label={t("expenses.property")}>
          <select
            className="rnt-select"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
          >
            <option value="">{t("leases.form.pickProperty")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="rnt-grid">
          <Field label={t("expenses.kind")}>
            <select
              className="rnt-select"
              value={kind}
              onChange={(e) => setKind(e.target.value as RealtyExpenseKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`expenses.kinds.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("expenses.amount")}>
            <input
              className="rnt-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("expenses.paidAt")}>
          <input
            className="rnt-input"
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </Field>
        <Field label={t("expenses.note")}>
          <input className="rnt-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label={t("expenses.receiptUrl")} hint={t("expenses.receiptUrlHint")}>
          <input
            className="rnt-input"
            value={receiptUrl}
            onChange={(e) => setReceiptUrl(e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Note tone="info">{t("expenses.receiptUrlHint")}</Note>
      </Modal>
    </>
  );
}
