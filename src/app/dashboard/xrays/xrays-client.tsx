"use client";

import { useState, useRef } from "react";
import { FileImage, Upload, Trash2, Search, Eye, Download, X } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
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
    if (!file || !selectedPatient) return;

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
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Radiografías y Archivos</h1>
          <p className="text-sm text-muted-foreground">Gestiona imágenes y documentos de tus pacientes</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Patient list */}
        <div className="lg:col-span-1 bg-card border border-border rounded-2xl shadow-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar paciente..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => selectPatient(p)}
                className={cn(
                  "w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors",
                  selectedPatient?.id === p.id && "bg-brand-50 dark:bg-brand-900/20 border-l-4 border-brand-500"
                )}
              >
                <div className="font-medium text-sm">{p.firstName} {p.lastName}</div>
                <div className="text-xs text-muted-foreground flex justify-between">
                  <span>{p.patientNumber}</span>
                  <span>{p._count.files} archivos</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">No se encontraron pacientes</div>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {selectedPatient ? (
            <>
              {/* Upload section */}
              <div className="bg-card border border-border rounded-2xl shadow-card p-6">
                <h2 className="text-lg font-bold mb-4">
                  Subir archivo — {selectedPatient.firstName} {selectedPatient.lastName}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Archivo</label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*,application/pdf"
                      className="w-full text-sm file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:font-medium file:cursor-pointer hover:file:bg-brand-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Categoría</label>
                    <select
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm"
                    >
                      {CATEGORIES.map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium mb-1">Notas (opcional)</label>
                    <input
                      type="text"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Ej: Radiografía de control post-tratamiento"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm"
                    />
                  </div>
                </div>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="mt-4 flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? "Subiendo..." : "Subir archivo"}
                </button>
              </div>

              {/* Patient files */}
              <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
                <div className="p-4 border-b border-border">
                  <h2 className="font-bold">Archivos de {selectedPatient.firstName} ({patientFiles.length})</h2>
                </div>
                {patientFiles.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <FileImage className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    Sin archivos aún
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {patientFiles.map(f => (
                      <div key={f.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/20">
                        <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
                          <FileImage className="w-5 h-5 text-brand-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{f.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {catLabel(f.category)} · {formatSize(f.size)} · {formatDate(f.createdAt)}
                          </div>
                          {f.notes && <div className="text-xs text-muted-foreground italic mt-0.5">{f.notes}</div>}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setPreviewFile(f)}
                            className="p-2 rounded-lg hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                            title="Ver"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-lg hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
                            title="Descargar"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => handleDelete(f.id)}
                            className="p-2 rounded-lg hover:bg-rose-50 text-muted-foreground hover:text-rose-600 transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Recent files from all patients */
            <div className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
              <div className="p-4 border-b border-border">
                <h2 className="font-bold">Archivos recientes</h2>
                <p className="text-xs text-muted-foreground">Selecciona un paciente para ver sus archivos o subir nuevos</p>
              </div>
              {allFiles.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <FileImage className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  Sin archivos aún
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {allFiles.map(f => (
                    <button
                      key={f.id}
                      onClick={() => {
                        const p = patients.find(pt => pt.id === f.patient.id);
                        if (p) selectPatient(p);
                      }}
                      className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/20 text-left"
                    >
                      <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center flex-shrink-0">
                        <FileImage className="w-5 h-5 text-brand-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{f.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {f.patient.firstName} {f.patient.lastName} · {catLabel(f.category)} · {formatDate(f.createdAt)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Preview modal con panel de IA */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 md:items-center"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative my-8 w-full max-w-4xl rounded-2xl bg-card shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setPreviewFile(null)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60"
              aria-label="Cerrar preview"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Image / PDF preview */}
            <div className="flex items-center justify-center bg-slate-950 p-2">
              {previewFile.url.includes(".pdf") || previewFile.mimeType === "application/pdf" ? (
                <iframe src={previewFile.url} className="h-[60vh] w-full rounded-xl" />
              ) : (
                <img
                  src={previewFile.url}
                  alt={previewFile.name}
                  className="max-h-[60vh] w-auto rounded-xl object-contain"
                />
              )}
            </div>

            {/* Notas del doctor — visibles en la vista principal, no en el Dialog */}
            <div className="border-t border-border/40 bg-[#0B0F1E] p-3 md:p-5">
              <XrayNotesSection
                key={previewFile.id}
                fileId={previewFile.id}
                initialDoctorNotes={previewFile.doctorNotes}
                initialDoctorNotesUpdatedAt={previewFile.doctorNotesUpdatedAt}
              />
            </div>

            {/* Botón compacto de IA — solo para imágenes */}
            {previewFile.mimeType?.startsWith("image/") && (
              <div className="flex justify-end border-t border-border/40 bg-[#0B0F1E] p-3 md:p-4">
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
