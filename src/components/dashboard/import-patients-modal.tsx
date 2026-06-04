"use client";

import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Upload, X, FileSpreadsheet, Download, Loader2, Check, AlertCircle } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

interface PreviewRow {
  row: number;
  data: Record<string, any>;
  status: "ok" | "error" | "duplicate";
  errors: string[];
  warnings: string[];
}

interface PreviewResponse {
  total: number;
  validos: number;
  invalidos: number;
  duplicados: number;
  preview: PreviewRow[];
}

interface CommitResponse {
  created: number;
  skipped: number;
  duplicates: number;
  errors: { row: number; errors: string[] }[];
}

type Step = "upload" | "preview" | "committing";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportPatientsModal({ open, onClose, onImported }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);

  if (!open) return null;

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setSkipDuplicates(true);
    setLoading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleClose() {
    if (loading) return;
    reset();
    onClose();
  }

  async function handleFile(f: File) {
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) {
      toast.error(t("shell.importPatients.errFileType"));
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error(t("shell.importPatients.errFileSize"));
      return;
    }
    setFile(f);
    setLoading(true);
    setStep("preview");
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("dryRun", "true");
      const res = await fetch("/api/patients/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("shell.importPatients.errProcess"));
      setPreview(data);
    } catch (err: any) {
      toast.error(err.message ?? t("shell.importPatients.errProcessFile"));
      setStep("upload");
      setFile(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!file || !preview) return;
    setStep("committing");
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("dryRun", "false");
      fd.append("skipDuplicates", String(skipDuplicates));
      const res = await fetch("/api/patients/import", { method: "POST", body: fd });
      const data: CommitResponse = await res.json();
      if (!res.ok) throw new Error((data as any).error ?? t("shell.importPatients.errImport"));
      toast.success(t("shell.importPatients.importedCount", { count: data.created }));
      if (data.errors?.length) toast(t("shell.importPatients.errorRowsSkipped", { count: data.errors.length }), { icon: "⚠️" });
      onImported();
      reset();
    } catch (err: any) {
      toast.error(err.message ?? t("shell.importPatients.errImport"));
      setStep("preview");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal--wide" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal__header">
          <div className="modal__title">{t("shell.importPatients.title")}</div>
          <button onClick={handleClose} className="icon-btn-new" aria-label={t("common.close")}><X size={14} /></button>
        </div>

        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
          {step === "upload" && (
            <>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); }}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
                style={{
                  border: "2px dashed var(--border)",
                  borderRadius: 12,
                  padding: 40,
                  textAlign: "center",
                  cursor: "pointer",
                  background: "rgba(124,58,237,0.03)",
                }}
              >
                <Upload size={28} style={{ color: "var(--text-3)", marginBottom: 10 }} />
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-1)" }}>
                  {t("shell.importPatients.dropzone")}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
                  {t("shell.importPatients.dropzoneHint")}
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>

              <a
                href="/api/patients/import/template"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 13, color: "var(--brand)", textDecoration: "none", alignSelf: "center",
                }}
              >
                <Download size={13} /> {t("shell.importPatients.downloadTemplate")}
              </a>
            </>
          )}

          {step === "preview" && loading && (
            <div style={{ padding: 50, textAlign: "center" }}>
              <Loader2 className="animate-spin" size={28} style={{ color: "var(--brand)", marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>{t("shell.importPatients.processing", { name: file?.name ?? "" })}</div>
            </div>
          )}

          {step === "preview" && !loading && preview && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <FileSpreadsheet size={18} style={{ color: "var(--text-2)" }} />
                <div style={{ flex: 1, fontSize: 13, color: "var(--text-1)" }}>{file?.name}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {((file?.size ?? 0) / 1024).toFixed(1)} KB
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                <StatCard label={t("shell.importPatients.statValid")} value={preview.validos} color="#34d399" />
                <StatCard label={t("shell.importPatients.statErrors")} value={preview.invalidos} color="#ef4444" />
                <StatCard label={t("shell.importPatients.statDuplicates")} value={preview.duplicados} color="#fbbf24" />
              </div>

              <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table className="table-new" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>#</th>
                      <th>{t("shell.importPatients.colName")}</th>
                      <th>{t("shell.importPatients.colEmail")}</th>
                      <th>{t("shell.importPatients.colPhone")}</th>
                      <th style={{ width: 90 }}>{t("common.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map(r => (
                      <tr key={r.row}>
                        <td className="mono" style={{ color: "var(--text-3)" }}>{r.row}</td>
                        <td>{r.data.firstName} {r.data.lastName}</td>
                        <td className="mono" style={{ color: "var(--text-2)" }}>{r.data.email ?? "—"}</td>
                        <td className="mono" style={{ color: "var(--text-2)" }}>{r.data.phone ?? "—"}</td>
                        <td>
                          {r.status === "ok" && <span className="badge-new" style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", borderColor: "rgba(52,211,153,0.3)" }}>OK</span>}
                          {r.status === "error" && <span className="badge-new" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }} title={r.errors.join(", ")}>{t("shell.importPatients.badgeError")}</span>}
                          {r.status === "duplicate" && <span className="badge-new" style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", borderColor: "rgba(251,191,36,0.3)" }}>{t("shell.importPatients.badgeDuplicate")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.total > 200 && (
                  <div style={{ padding: 10, textAlign: "center", fontSize: 11, color: "var(--text-3)" }}>
                    {t("shell.importPatients.moreRows", { count: preview.total - 200 })}
                  </div>
                )}
              </div>

              {preview.duplicados > 0 && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={e => setSkipDuplicates(e.target.checked)}
                  />
                  {t("shell.importPatients.skipDuplicates", { count: preview.duplicados })}
                </label>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="btn-new" onClick={handleClose}>{t("common.cancel")}</button>
                <button
                  className="btn-new"
                  style={{ background: "#7c3aed", color: "#fff", borderColor: "#7c3aed" }}
                  onClick={handleCommit}
                  disabled={preview.validos === 0 && (skipDuplicates || preview.duplicados === 0)}
                >
                  {t("shell.importPatients.importBtn", { count: skipDuplicates ? preview.validos : preview.validos + preview.duplicados })}
                </button>
              </div>
            </>
          )}

          {step === "committing" && (
            <div style={{ padding: 50, textAlign: "center" }}>
              <Loader2 className="animate-spin" size={28} style={{ color: "var(--brand)", marginBottom: 12 }} />
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>{t("shell.importPatients.committing")}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
