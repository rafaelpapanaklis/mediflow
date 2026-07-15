"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

interface ArcoRow {
  id: string;
  clinicId: string | null;
  patientId: string | null;
  type: "ACCESS" | "RECTIFICATION" | "CANCELLATION" | "OPPOSITION";
  reason: string;
  email: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";
  resolvedAt: string | null;
  resolvedNotes: string | null;
  createdAt: string;
}

interface Props {
  clinicRequests: ArcoRow[];
  anonymousRequests: ArcoRow[];
  isSuperAdmin: boolean;
}

const TYPE_LABEL_KEY: Record<ArcoRow["type"], string> = {
  ACCESS: "settings.arco.typeAccess",
  RECTIFICATION: "settings.arco.typeRectification",
  CANCELLATION: "settings.arco.typeCancellation",
  OPPOSITION: "settings.arco.typeOpposition",
};

const STATUS_LABEL_KEY: Record<ArcoRow["status"], string> = {
  PENDING: "settings.arco.statusPending",
  IN_PROGRESS: "settings.arco.statusInProgress",
  RESOLVED: "settings.arco.statusResolved",
  REJECTED: "settings.arco.statusRejected",
};

// Tono semántico del sistema (badge-new): pendiente=warning, en curso=info,
// resuelta=success, rechazada=danger. Migrado de hex crudos a clases del sistema.
const STATUS_TONE: Record<ArcoRow["status"], string> = {
  PENDING:     "warning",
  IN_PROGRESS: "info",
  RESOLVED:    "success",
  REJECTED:    "danger",
};

export function ArcoRequestsClient({ clinicRequests, anonymousRequests, isSuperAdmin }: Props) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<ArcoRow | null>(null);

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{t("settings.arco.title")}</h1>
      <p style={{ fontSize: 13, color: "var(--text-3, #64748b)", marginBottom: 24 }}>
        {t("settings.arco.subtitle")}
      </p>

      <Section title={t("settings.arco.sectionClinic", { count: clinicRequests.length })}>
        <Table rows={clinicRequests} onEdit={setEditing} />
      </Section>

      {isSuperAdmin && (
        <Section title={t("settings.arco.sectionAnonymous", { count: anonymousRequests.length })}>
          <Table rows={anonymousRequests} onEdit={setEditing} />
        </Section>
      )}

      {editing && (
        <EditModal
          request={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); toast.success(t("settings.arco.toastUpdated")); }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-2, #475569)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ rows, onEdit }: { rows: ArcoRow[]; onEdit: (r: ArcoRow) => void }) {
  const t = useT();
  if (rows.length === 0) {
    return (
      <div style={{ padding: 20, background: "var(--bg-elev, #f8fafc)", border: "1px solid var(--border-soft, #e2e8f0)", borderRadius: 10, fontSize: 13, color: "var(--text-3, #64748b)" }}>
        {t("settings.arco.emptyTable")}
      </div>
    );
  }
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="table-new">
          <thead>
            <tr>
              <th>{t("common.date")}</th>
              <th>{t("settings.arco.colType")}</th>
              <th>{t("settings.arco.colEmail")}</th>
              <th>{t("settings.arco.colReason")}</th>
              <th>{t("settings.arco.colStatus")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                  {new Date(r.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                </td>
                <td><strong style={{ fontWeight: 600 }}>{t(TYPE_LABEL_KEY[r.type])}</strong></td>
                <td><code className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{r.email}</code></td>
                <td>
                  <div style={{ maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-2)" }}>
                    {r.reason}
                  </div>
                </td>
                <td>
                  <span className={`badge-new badge-new--${STATUS_TONE[r.status]}`}>
                    <span className="badge-new__dot" />
                    {t(STATUS_LABEL_KEY[r.status])}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => onEdit(r)}
                    className="btn-new btn-new--secondary btn-new--sm"
                  >
                    {t("settings.arco.manage")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditModal({ request, onClose, onSaved }: { request: ArcoRow; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [status, setStatus] = useState(request.status);
  const [notes, setNotes] = useState(request.resolvedNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/arco/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolvedNotes: notes }),
      });
      if (!res.ok) throw new Error();
      onSaved();
    } catch {
      toast.error(t("settings.arco.toastSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal">
        <div className="modal__header">
          <h3 className="modal__title">
            {t("settings.arco.modalTitle", { type: t(TYPE_LABEL_KEY[request.type]) })} · {request.email}
          </h3>
        </div>
        <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="field-new">
            <Label>{t("settings.arco.requesterReason")}</Label>
            <p style={{ padding: 10, background: "var(--bg-elev-2)", borderRadius: "var(--radius-sm)", fontSize: 13, whiteSpace: "pre-wrap", color: "var(--text-2)" }}>
              {request.reason}
            </p>
          </div>
          <div className="field-new">
            <Label>{t("settings.arco.colStatus")}</Label>
            <select
              className="input-new"
              value={status}
              onChange={(e) => setStatus(e.target.value as ArcoRow["status"])}
            >
              <option value="PENDING">{t("settings.arco.statusPending")}</option>
              <option value="IN_PROGRESS">{t("settings.arco.statusInProgress")}</option>
              <option value="RESOLVED">{t("settings.arco.statusResolved")}</option>
              <option value="REJECTED">{t("settings.arco.statusRejected")}</option>
            </select>
          </div>
          <div className="field-new">
            <Label>{t("settings.arco.internalNotes")}</Label>
            <textarea
              className="input-new"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
              rows={5}
              placeholder={t("settings.arco.notesPlaceholder")}
              style={{ height: "auto", resize: "vertical" }}
            />
          </div>
        </div>
        <div className="modal__footer">
          <button type="button" onClick={onClose} className="btn-new btn-new--secondary">
            {t("common.cancel")}
          </button>
          <button type="button" onClick={save} disabled={saving} className="btn-new btn-new--primary">
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="field-new__label" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</span>;
}
