"use client";

// ═══════════════════════════════════════════════════════════════════════
// La bandeja de mantenimiento del panel: abierto → en proceso → resuelto.
//
// Al resolver con costo se puede registrar el gasto del inmueble en el
// mismo acto. Es la diferencia entre saber cuánto rinde de verdad una casa
// y creer que rinde la renta bruta.
//
// El inquilino reporta desde SU portal (otra ola); esta pantalla es el lado
// de quien administra, y también deja capturar un reporte a mano — porque
// la mitad de los reportes llegan por WhatsApp o por teléfono.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Camera, Plus } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { formatMoney, formatShortDate } from "@/lib/realty/rent-charges";
import type { RealtyMaintenanceStatus } from "@/lib/realty/types";
import { Card, EmptyState, Field, Modal, Note, Pill, compressImage, type Tone } from "./ui";

export interface MaintenanceRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  leaseId: string | null;
  reportedBy: string | null;
  description: string;
  photoUrls: string[];
  status: RealtyMaintenanceStatus;
  vendorName: string | null;
  cost: number | null;
  resolvedAt: string | null;
  createdAt: string;
  daysOpen: number;
}

const STATUS_TONE: Record<RealtyMaintenanceStatus, Tone> = {
  ABIERTO: "warning",
  EN_PROCESO: "brand",
  RESUELTO: "success",
};

export function MaintenancePanel({
  dict,
  rows,
  properties,
  canEdit,
  canExpenses,
  todayISO,
}: {
  dict: Dictionary;
  rows: MaintenanceRow[];
  properties: Array<{ id: string; title: string }>;
  canEdit: boolean;
  canExpenses: boolean;
  todayISO: string;
}) {
  const t = makeRealtyT(dict);
  const router = useRouter();

  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Alta
  const [propertyId, setPropertyId] = useState("");
  const [description, setDescription] = useState("");
  const [reportedBy, setReportedBy] = useState("");

  // Edición
  const [status, setStatus] = useState<RealtyMaintenanceStatus>("EN_PROCESO");
  const [vendorName, setVendorName] = useState("");
  const [cost, setCost] = useState("");
  const [resolvedAt, setResolvedAt] = useState(todayISO);
  const [createExpense, setCreateExpense] = useState(true);

  const open = useMemo(() => rows.filter((r) => r.status !== "RESUELTO").length, [rows]);

  function startEdit(row: MaintenanceRow) {
    setEditing(row);
    setStatus(row.status === "ABIERTO" ? "EN_PROCESO" : row.status);
    setVendorName(row.vendorName ?? "");
    setCost(row.cost === null ? "" : String(row.cost));
    setResolvedAt((row.resolvedAt ?? new Date().toISOString()).slice(0, 10));
    setCreateExpense(canExpenses);
    setError(null);
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, description, reportedBy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error ?? t("common.genericError")));
        setBusy(false);
        return;
      }
      toast.success(t("maintenance.toast.created"));
      setNewOpen(false);
      setPropertyId("");
      setDescription("");
      setReportedBy("");
      router.refresh();
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/maintenance/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          vendorName,
          cost: cost.trim() === "" ? null : cost,
          resolvedAt,
          createExpense: createExpense && status === "RESUELTO",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data?.error ?? t("common.genericError")));
        setBusy(false);
        return;
      }
      toast.success(data?.expenseId ? t("maintenance.toast.expense") : t("maintenance.toast.updated"));
      if (data?.expenseSkippedByPermission) toast(t("maintenance.noExpensePermission"));
      setEditing(null);
      router.refresh();
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(row: MaintenanceRow, file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compressImage(file);
      const form = new FormData();
      form.append("file", blob, "evidencia.jpg");
      const res = await fetch(`/api/realty/maintenance/${row.id}/fotos`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("common.genericError")));
        return;
      }
      toast.success(t("inventory.toast.photo"));
      router.refresh();
    } catch {
      toast.error(t("common.genericError"));
    }
  }

  return (
    <>
      <Card
        title={t("maintenance.title")}
        sub={t("maintenance.subtitle")}
        flush
        action={
          canEdit ? (
            <button
              type="button"
              className="rnt-btn rnt-btn--sm rnt-btn--primary"
              onClick={() => setNewOpen(true)}
            >
              <Plus size={13} />
              {t("maintenance.new")}
            </button>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <EmptyState title={t("maintenance.empty.title")} body={t("maintenance.empty.body")} />
        ) : (
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <thead>
                <tr>
                  <th>{t("maintenance.table.property")}</th>
                  <th>{t("maintenance.table.description")}</th>
                  <th className="rnt-hide-sm">{t("maintenance.table.reported")}</th>
                  <th className="num rnt-hide-xs">{t("maintenance.table.days")}</th>
                  <th className="num rnt-hide-sm">{t("maintenance.table.cost")}</th>
                  <th>{t("maintenance.table.status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="rnt-strong">{r.propertyTitle}</td>
                    <td>
                      <div style={{ maxWidth: 320 }}>{r.description}</div>
                      {r.photoUrls.length > 0 ? (
                        <div className="rnt-inv-photos">
                          {r.photoUrls.slice(0, 4).map((u, i) =>
                            u ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={i} src={u} alt="" className="rnt-inv-photo" />
                            ) : null,
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td className="rnt-hide-sm">
                      <div>{r.reportedBy ?? "—"}</div>
                      <div className="rnt-muted">{formatShortDate(r.createdAt)}</div>
                    </td>
                    <td className="num rnt-hide-xs">{r.daysOpen}</td>
                    <td className="num rnt-hide-sm">
                      {r.cost === null ? "—" : formatMoney(r.cost)}
                    </td>
                    <td>
                      <Pill tone={STATUS_TONE[r.status]} dot>
                        {t(`maintenance.status.${r.status}`)}
                      </Pill>
                    </td>
                    <td className="num">
                      {canEdit ? (
                        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                          <label className="rnt-btn rnt-btn--sm" style={{ cursor: "pointer" }}>
                            <Camera size={13} />
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              style={{ display: "none" }}
                              onChange={(e) => void uploadPhoto(r, e.target.files?.[0])}
                            />
                          </label>
                          <button
                            type="button"
                            className="rnt-btn rnt-btn--sm"
                            onClick={() => startEdit(r)}
                          >
                            {t("common.edit")}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open > 0 ? (
          <div style={{ padding: "12px 16px" }}>
            <Note tone="info">{t("maintenance.portalNote")}</Note>
          </div>
        ) : null}
      </Card>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        closeLabel={t("common.close")}
        title={t("maintenance.new")}
        sub={t("maintenance.subtitle")}
        footer={
          <>
            <button type="button" className="rnt-btn" onClick={() => setNewOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--primary"
              onClick={create}
              disabled={busy || !propertyId || description.trim() === ""}
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </>
        }
      >
        {error ? <Note tone="danger">{error}</Note> : null}
        <Field label={t("maintenance.property")}>
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
        <Field label={t("maintenance.description")} hint={t("maintenance.descriptionHint")}>
          <textarea
            className="rnt-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label={t("maintenance.reportedBy")} hint={t("maintenance.reportedByHint")}>
          <input
            className="rnt-input"
            value={reportedBy}
            onChange={(e) => setReportedBy(e.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        closeLabel={t("common.close")}
        title={editing?.propertyTitle ?? t("maintenance.title")}
        sub={editing?.description}
        footer={
          <>
            <button type="button" className="rnt-btn" onClick={() => setEditing(null)} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button type="button" className="rnt-btn rnt-btn--primary" onClick={save} disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </>
        }
      >
        {error ? <Note tone="danger">{error}</Note> : null}
        <Field label={t("maintenance.table.status")}>
          <select
            className="rnt-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as RealtyMaintenanceStatus)}
          >
            <option value="ABIERTO">{t("maintenance.status.ABIERTO")}</option>
            <option value="EN_PROCESO">{t("maintenance.status.EN_PROCESO")}</option>
            <option value="RESUELTO">{t("maintenance.status.RESUELTO")}</option>
          </select>
        </Field>
        <div className="rnt-grid">
          <Field label={t("maintenance.vendor")}>
            <input
              className="rnt-input"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
            />
          </Field>
          <Field label={t("maintenance.cost")}>
            <input
              className="rnt-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </Field>
        </div>
        {status === "RESUELTO" ? (
          <>
            <Field label={t("maintenance.resolvedAt")}>
              <input
                className="rnt-input"
                type="date"
                value={resolvedAt}
                onChange={(e) => setResolvedAt(e.target.value)}
              />
            </Field>
            {canExpenses ? (
              <label
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={createExpense}
                  onChange={(e) => setCreateExpense(e.target.checked)}
                />
                <span>{t("maintenance.createExpense")}</span>
              </label>
            ) : (
              <Note tone="info">{t("maintenance.noExpensePermission")}</Note>
            )}
            {canExpenses ? (
              <div className="rnt-field__hint">{t("maintenance.createExpenseHint")}</div>
            ) : null}
          </>
        ) : null}
      </Modal>
    </>
  );
}
