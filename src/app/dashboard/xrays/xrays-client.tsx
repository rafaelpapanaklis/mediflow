"use client";

import { useState, useRef } from "react";
import { FileImage, Upload, Trash2, Search, Eye, Download, X } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { formatRelativeDate } from "@/lib/format";
import { XrayAiPanel } from "@/components/xrays/xray-ai-panel";
import { XrayNotesSection } from "@/components/xrays/xray-notes-section";

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber: string;
  _count: { files: number };
}

interface PatientFile {
  id: string;
  name: string;
  url: string;
  category: string;
  mimeType: string;
  size: number;
  notes: string | null;
  toothNumber: number | null;
  takenAt: string | null;
  createdAt: string;
  doctorNotes: string | null;
  doctorNotesUpdatedAt: string | null;
  patient: { id: string; firstName: string; lastName: string; patientNumber: string };
}

interface Props {
  patients: Patient[];
  recentFiles: PatientFile[];
  clinicId: string;
  aiUsed: number;
  aiLimit: number;
}

const CATEGORIES = [
  { id: "XRAY_PERIAPICAL",   label: "Periapical" },
  { id: "XRAY_PANORAMIC",    label: "Panorámica" },
  { id: "XRAY_CEPHALOMETRIC", label: "Cefalométrica" },
  { id: "XRAY_BITEWING",     label: "Bitewing" },
  { id: "PHOTO_FRONTAL",     label: "Foto frontal" },
  { id: "PHOTO_LATERAL",     label: "Foto lateral" },
  { id: "PHOTO_INTRAORAL",   label: "Foto intraoral" },
  { id: "SCAN_3D",           label: "Escaneo 3D" },
  { id: "OTHER",             label: "Otro" },
];

export function XraysClient({ patients, recentFiles: initialFiles, clinicId, aiUsed, aiLimit }: Props) {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientFiles, setPatientFiles] = useState<PatientFile[]>([]);
  const [allFiles, setAllFiles] = useState<PatientFile[]>(initialFiles);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState("OTHER");
  const [notes, setNotes] = useState("");
  const [previewFile, setPreviewFile] = useState<PatientFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const initialTokensRemaining = Math.max(0, aiLimit - aiUsed);

  const filtered = patients.filter(p => {
    const q = search.toLowerCase();
    return `${p.firstName} ${p.lastName} ${p.patientNumber}`.toLowerCase().includes(q);
  });

  async function selectPatient(p: Patient) {
    setSelectedPatient(p);
    try {
      const res = await fetch(`/api/xrays?patientId=${p.id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPatientFiles(data);
    } catch {
      toast.error("Error al cargar archivos");
    }
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error("Selecciona un archivo primero"); return; }
    if (!selectedPatient) { toast.error("Selecciona un paciente primero"); return; }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("patientId", selectedPatient.id);
      form.append("category", category);
      if (notes) form.append("notes", notes);

      const res = await fetch("/api/xrays", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error al subir");
      }
      const record = await res.json();
      setPatientFiles(prev => [record, ...prev]);
      setAllFiles(prev => [{ ...record, patient: selectedPatient }, ...prev]);
      toast.success("Archivo subido");
      setNotes("");
      setCategory("OTHER");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: any) {
      toast.error(err.message ?? "Error al subir archivo");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(fileId: string) {
    if (!confirm("¿Eliminar este archivo?")) return;
    try {
      const res = await fetch(`/api/xrays/${fileId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setPatientFiles(prev => prev.filter(f => f.id !== fileId));
      setAllFiles(prev => prev.filter(f => f.id !== fileId));
      toast.success("Archivo eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  }

  const catLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? id;

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Radiografías y archivos
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
          Gestiona imágenes y documentos de tus pacientes
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 2fr", gap: 14 }}>
        {/* Patient list */}
        <CardNew noPad>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border-soft)" }}>
            <div className="search-field" style={{ width: "100%" }}>
              <Search size={14} />
              <input
                type="text"
                placeholder="Buscar paciente…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div style={{ maxHeight: 540, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                No se encontraron pacientes
              </div>
            ) : filtered.map(p => {
              const isActive = selectedPatient?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPatient(p)}
                  className="list-row"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    background: isActive ? "var(--brand-soft)" : "transparent",
                    borderLeft: isActive ? "3px solid var(--brand)" : "3px solid transparent",
                    color: "inherit",
                  }}
                >
                  <AvatarNew name={`${p.firstName} ${p.lastName}`} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.firstName} {p.lastName}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>#{p.patientNumber}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>
                    {p._count.files}
                  </span>
                </button>
              );
            })}
          </div>
        </CardNew>

        {/* Main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {selectedPatient ? (
            <>
              {/* Upload */}
              <CardNew
                title={`Subir archivo — ${selectedPatient.firstName} ${selectedPatient.lastName}`}
                sub="Imágenes y PDF, máx 50MB"
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px", marginBottom: 14 }}>
                  <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                    <label className="field-new__label">Archivo</label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,application/pdf"
                      style={{ position: "absolute", left: "-9999px" }}
                      onChange={() => { /* fuerza re-render si se desea */ }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      style={{
                        width: "100%",
                        border: "2px dashed var(--border-soft)",
                        borderRadius: "var(--radius-lg)",
                        padding: 24,
                        textAlign: "center",
                        cursor: "pointer",
                        background: "transparent",
                        color: "var(--text-2)",
                        transition: "all .15s",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = "var(--border-brand)";
                        e.currentTarget.style.background = "var(--brand-softer)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "var(--border-soft)";
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Upload size={24} style={{ margin: "0 auto 8px", color: "var(--text-3)" }} />
                      <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>
                        {fileRef.current?.files?.[0]?.name ?? "Arrastra o haz click para subir"}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>
                        PNG, JPG, PDF hasta 50MB
                      </div>
                    </button>
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Categoría</label>
                    <select className="input-new" value={category} onChange={e => setCategory(e.target.value)}>
                      {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div className="field-new">
                    <label className="field-new__label">Notas (opcional)</label>
                    <input
                      className="input-new"
                      placeholder="Ej: control post-tratamiento"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                    />
                  </div>
                </div>
                <ButtonNew variant="primary" icon={<Upload size={14} />} onClick={handleUpload} disabled={uploading}>
                  {uploading ? "Subiendo…" : "Subir archivo"}
                </ButtonNew>
              </CardNew>

              {/* Patient files */}
              <CardNew
                title={`Archivos de ${selectedPatient.firstName}`}
                sub={`${patientFiles.length} archivos`}
                noPad
              >
                {patientFiles.length === 0 ? (
                  <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                    <FileImage size={32} style={{ color: "var(--text-4)", margin: "0 auto 8px" }} />
                    Sin archivos aún
                  </div>
                ) : (
                  <div>
                    {patientFiles.map(f => (
                      <div key={f.id} className="list-row">
                        <div style={{
                          width: 40, height: 40, borderRadius: 8,
                          background: "var(--brand-soft)",
                          display: "grid", placeItems: "center", flexShrink: 0,
                          border: "1px solid rgba(124,58,237,0.2)",
                        }}>
                          <FileImage size={16} style={{ color: "#c4b5fd" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {f.name}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                            <BadgeNew tone="neutral">{catLabel(f.category)}</BadgeNew>
                            <span className="mono" style={{ marginLeft: 6 }}>{formatSize(f.size)}</span>
                            <span style={{ marginLeft: 6 }}>· {formatDate(f.createdAt)}</span>
                          </div>
                          {f.notes && (
                            <div style={{ fontSize: 10, color: "var(--text-3)", fontStyle: "italic", marginTop: 2 }}>
                              {f.notes}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => setPreviewFile(f)}
                            type="button"
                            className="btn-new btn-new--ghost btn-new--sm"
                            style={{ padding: 0, width: 28 }}
                            title="Ver"
                          >
                            <Eye size={12} />
                          </button>
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-new btn-new--ghost btn-new--sm"
                            style={{ padding: 0, width: 28, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                            title="Descargar"
                          >
                            <Download size={12} />
                          </a>
                          <button
                            onClick={() => handleDelete(f.id)}
                            type="button"
                            className="btn-new btn-new--ghost btn-new--sm"
                            style={{ padding: 0, width: 28 }}
                            title="Eliminar"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardNew>
            </>
          ) : (
            <CardNew
              title="Archivos recientes"
              sub="Selecciona un paciente para ver sus archivos o subir nuevos"
              noPad
            >
              {allFiles.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
                  <FileImage size={32} style={{ color: "var(--text-4)", margin: "0 auto 8px" }} />
                  Sin archivos aún
                </div>
              ) : (
                <div>
                  {allFiles.map(f => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        const p = patients.find(pt => pt.id === f.patient.id);
                        if (p) selectPatient(p);
                      }}
                      className="list-row"
                      style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "transparent", color: "inherit" }}
                    >
                      <div style={{
                        width: 40, height: 40, borderRadius: 8,
                        background: "var(--brand-soft)",
                        display: "grid", placeItems: "center", flexShrink: 0,
                        border: "1px solid rgba(124,58,237,0.2)",
                      }}>
                        <FileImage size={16} style={{ color: "#c4b5fd" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {f.name}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                          {f.patient.firstName} {f.patient.lastName} · {catLabel(f.category)} · {formatRelativeDate(f.createdAt)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardNew>
          )}
        </div>
      </div>

      {/* Preview modal con panel de IA */}
      {previewFile && (
        <div className="modal-overlay" onClick={() => setPreviewFile(null)}>
          <div
            className="modal modal--wide"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 880, padding: 0 }}
          >
            <div className="modal__header">
              <div className="modal__title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {previewFile.name}
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                aria-label="Cerrar preview"
              >
                <X size={14} />
              </button>
            </div>

            {/* Image / PDF preview */}
            <div style={{ background: "#000", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
              {previewFile.url.includes(".pdf") || previewFile.mimeType === "application/pdf" ? (
                <iframe src={previewFile.url} style={{ height: "60vh", width: "100%", borderRadius: 8, background: "#fff" }} />
              ) : (
                <img
                  src={previewFile.url}
                  alt={previewFile.name}
                  style={{ maxHeight: "60vh", width: "auto", objectFit: "contain", borderRadius: 8 }}
                />
              )}
            </div>

            {/* Notas del doctor */}
            <div style={{ borderTop: "1px solid var(--border-soft)", padding: 16 }}>
              <XrayNotesSection
                key={previewFile.id}
                fileId={previewFile.id}
                initialDoctorNotes={previewFile.doctorNotes}
                initialDoctorNotesUpdatedAt={previewFile.doctorNotesUpdatedAt}
              />
            </div>

            {/* Botón compacto de IA — solo para imágenes */}
            {previewFile.mimeType?.startsWith("image/") && (
              <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border-soft)", padding: 14, background: "rgba(0,0,0,0.2)" }}>
                <XrayAiPanel
                  fileId={previewFile.id}
                  fileUrl={previewFile.url}
                  fileName={previewFile.name}
                  mimeType={previewFile.mimeType}
                  initialTokensRemaining={initialTokensRemaining}
                  tokensLimit={aiLimit}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
