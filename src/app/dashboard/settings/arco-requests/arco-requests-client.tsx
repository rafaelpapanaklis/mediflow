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

const STATUS_COLOR: Record<ArcoRow["status"], string> = {
  PENDING:     "#d97706",
  IN_PROGRESS: "#2563eb",
  RESOLVED:    "#059669",
  REJECTED:    "#b91c1c",
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
    <div style={{ background: "var(--bg-elev, #fff)", border: "1px solid var(--border-soft, #e2e8f0)", borderRadius: 10, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--bg-elev-2, #f1f5f9)" }}>
            <Th>{t("common.date")}</Th>
            <Th>{t("settings.arco.colType")}</Th>
            <Th>{t("settings.arco.colEmail")}</Th>
            <Th>{t("settings.arco.colReason")}</Th>
            <Th>{t("settings.arco.colStatus")}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--border-soft, #f1f5f9)" }}>
              <Td>{new Date(r.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</Td>
              <Td><strong>{t(TYPE_LABEL_KEY[r.type])}</strong></Td>
              <Td><code style={{ fontFamily: "monospace", fontSize: 12 }}>{r.email}</code></Td>
              <Td>
                <div style={{ maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.reason}
                </div>
              </Td>
              <Td>
                <span style={{ padding: "2px 8px", fontSize: 11, fontWeight: 700, borderRadius: 99, color: "#fff", background: STATUS_COLOR[r.status] }}>
                  {t(STATUS_LABEL_KEY[r.status])}
                </span>
              </Td>
              <Td>
                <button
                  type="button"
                  onClick={() => onEdit(r)}
                  style={{ padding: "5px 10px", fontSize: 12, background: "var(--bg-elev-2, #f1f5f9)", border: "1px solid var(--border-soft, #cbd5e1)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}
                >
                  {t("settings.arco.manage")}
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-3, #64748b)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</th>;
}
function Td({ children }: { children?: React.ReactNode }) {
  return <td style={{ padding: "10px 12px" }}>{children}</td>;
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
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15, 10, 30, 0.55)", backdropFilter: "blur(4px)",
        display: "grid", placeItems: "center", zIndex: 100, padding: 24,
      }}
    >
      <div style={{ background: "var(--bg-elev, #fff)", border: "1px solid var(--border-strong, #94a3b8)", borderRadius: 14, width: "100%", maxWidth: 540, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft, #e2e8f0)", flexShrink: 0 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
            {t("settings.arco.modalTitle", { type: t(TYPE_LABEL_KEY[request.type]) })} · {request.email}
          </h3>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div>
            <Label>{t("settings.arco.requesterReason")}</Label>
            <p style={{ marginTop: 4, padding: 10, background: "var(--bg-elev-2, #f1f5f9)", borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap" }}>
              {request.reason}
            </p>
          </div>
          <div>
            <Label>{t("settings.arco.colStatus")}</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ArcoRow["status"])}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-soft, #cbd5e1)", borderRadius: 8, fontFamily: "inherit", fontSize: 13, marginTop: 4 }}
            >
              <option value="PENDING">{t("settings.arco.statusPending")}</option>
              <option value="IN_PROGRESS">{t("settings.arco.statusInProgress")}</option>
              <option value="RESOLVED">{t("settings.arco.statusResolved")}</option>
              <option value="REJECTED">{t("settings.arco.statusRejected")}</option>
            </select>
          </div>
          <div>
            <Label>{t("settings.arco.internalNotes")}</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
              rows={5}
              placeholder={t("settings.arco.notesPlaceholder")}
              style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border-soft, #cbd5e1)", borderRadius: 8, fontFamily: "inherit", fontSize: 13, marginTop: 4, resize: "vertical" }}
            />
          </div>
        </div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-soft, #e2e8f0)", display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, background: "transparent", color: "var(--text-2, #475569)", border: "1px solid var(--border-strong, #94a3b8)", borderRadius: 8, cursor: "pointer", fontFamily: "inherit" }}>
            {t("common.cancel")}
          </button>
          <button type="button" onClick={save} disabled={saving} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, background: "var(--brand, #2563eb)", color: "#fff", border: "1px solid var(--brand, #2563eb)", borderRadius: 8, cursor: saving ? "wait" : "pointer", fontFamily: "inherit" }}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3, #64748b)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</span>;
}
