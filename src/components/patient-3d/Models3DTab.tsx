"use client";
// Pestaña "Modelos 3D" del expediente: lista, sube, visualiza y borra modelos
// intraorales STL/PLY/OBJ. Reusa PatientFile (category SCAN_STL) + bucket
// patient-files vía /api/patients/[id]/models-3d. El visor three.js se carga
// dinámicamente (code-split) solo al abrir un modelo. Multi-tenant: el API
// resuelve clinicId desde la sesión, nunca desde el cliente.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Trash2, Box, X, Layers } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import type { Model3DFormat } from "./Model3DViewer";

const Model3DViewer = dynamic(() => import("./Model3DViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center text-xs text-white/70" style={{ height: 520 }}>
      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
    </div>
  ),
});

// Visor DICOM 2D (cortes). Dinámico + client-only (usa dicom-parser).
const DicomViewer2D = dynamic(() => import("./DicomViewer2D"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center text-xs text-white/70" style={{ height: 480 }}>
      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
    </div>
  ),
});

// Visor de SET CBCT (.zip de cortes). Dinámico + client-only (jszip + dicom-parser).
const DicomSetViewer = dynamic(() => import("./DicomSetViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center text-xs text-white/70" style={{ height: 480 }}>
      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
    </div>
  ),
});

// Visor CBCT REDISEÑADO (WS2-T7): enchufa el cargador real + persistencia al
// <CbctViewer/>. Primario para sets CBCT; DicomSetViewer queda como fallback
// (clásico) hasta QA. Dinámico + client-only (jszip + dicom-parser + three).
const CbctStudyViewer = dynamic(() => import("./cbct/CbctStudyViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center text-xs text-white/70" style={{ height: 480 }}>
      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
    </div>
  ),
});

// Miniatura por tarjeta. Dinámica para que three.js solo se descargue cuando se
// abre la pestaña de modelos, no en el bundle del expediente.
const Model3DThumbnail = dynamic(() => import("./Model3DThumbnail"), {
  ssr: false,
  loading: () => (
    <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
      <Box className="w-6 h-6 text-brand-600" aria-hidden />
    </div>
  ),
});

interface Model3DFile {
  id: string;
  name: string;
  url: string;
  size: number | null;
  mimeType: string | null;
  createdAt: string;
  doctorNotes?: string | null;
  annotations?: unknown;
}

const ACCEPT = ".stl,.ply,.obj,.dcm,.dicom,.zip";
const MAX_MB = 100;

function isZip(name: string): boolean {
  return /\.zip$/i.test(name);
}

function formatFromName(name: string): Model3DFormat | undefined {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "stl" || ext === "ply" || ext === "obj") return ext;
  if (ext === "dcm" || ext === "dicom") return "dicom";
  return undefined;
}

export function Models3DTab({ patientId }: { patientId: string }) {
  const t = useT();
  const [files, setFiles] = useState<Model3DFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewer, setViewer] = useState<Model3DFile | null>(null);
  // Visor CBCT: usa el rediseñado por defecto; `useClassic` cae al DicomSetViewer
  // clásico (fallback hasta QA, o si el set no es CBCT legible).
  const [useClassic, setUseClassic] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Carga inicial de la lista.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/models-3d`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data)) setFiles(data);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Subida DIRECTA a Storage de un set CBCT (.zip): los CBCT pesan cientos de MB
  // y no caben en el route handler. Pedimos signed upload URL, subimos directo
  // y registramos el PatientFile.
  const uploadZip = useCallback(
    async (file: File) => {
      setUploading(true);
      setProgress(0);
      try {
        const signRes = await fetch(`/api/patients/${patientId}/dicom-set/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name }),
        });
        if (!signRes.ok) throw new Error((await signRes.json().catch(() => ({})))?.error || "No se pudo preparar la subida");
        const { path, signedUrl } = await signRes.json();

        // Subida con PROGRESO real: XHR PUT directo al signed URL (uploadToSignedUrl
        // del SDK no expone onprogress, por eso la barra quedaba en 0%).
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signedUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/zip");
          xhr.setRequestHeader("x-upsert", "false");
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`La subida falló (${xhr.status})`));
          xhr.onerror = () => reject(new Error("Error de red durante la subida"));
          xhr.send(file);
        });

        const regRes = await fetch(`/api/patients/${patientId}/dicom-set/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, name: file.name, size: file.size }),
        });
        if (!regRes.ok) throw new Error((await regRes.json().catch(() => ({})))?.error || "No se pudo registrar el set");
        const created: Model3DFile = await regRes.json();
        setFiles((prev) => [created, ...prev]);
        toast.success("CBCT subido");
      } catch (e: any) {
        toast.error(e?.message ? `Error: ${e.message}` : "No se pudo subir el CBCT");
      } finally {
        setUploading(false);
        setProgress(0);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [patientId],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // CBCT (.zip): subida directa a Storage (archivos grandes).
      if (isZip(file.name)) {
        void uploadZip(file);
        e.target.value = "";
        return;
      }
      // Doble candado: el servidor también valida, pero rechazamos aquí antes de
      // gastar la subida si la extensión no está permitida.
      if (!/\.(stl|ply|obj|dcm|dicom)$/i.test(file.name)) {
        toast.error(t("patients.models3d.formatNotAllowed"));
        e.target.value = "";
        return;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        toast.error(t("patients.models3d.tooLarge", { mb: MAX_MB }));
        e.target.value = "";
        return;
      }

      setUploading(true);
      setProgress(0);
      const form = new FormData();
      form.append("file", file);

      // XHR para barra de progreso real (fetch no expone upload progress).
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/patients/${patientId}/models-3d`);
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      const reset = () => {
        setUploading(false);
        setProgress(0);
        if (inputRef.current) inputRef.current.value = "";
      };
      xhr.onload = () => {
        reset();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const created: Model3DFile = JSON.parse(xhr.responseText);
            setFiles((prev) => [created, ...prev]);
            toast.success(t("patients.models3d.uploadSuccess"));
          } catch {
            toast.error(t("patients.models3d.uploadError"));
          }
        } else {
          let msg = t("patients.models3d.uploadError");
          try {
            msg = JSON.parse(xhr.responseText).error ?? msg;
          } catch {
            /* keep default */
          }
          toast.error(msg);
        }
      };
      xhr.onerror = () => {
        reset();
        toast.error(t("patients.models3d.uploadError"));
      };
      xhr.send(form);
    },
    [patientId, t, uploadZip],
  );

  // Re-firma la signed URL (TTL 5 min) antes de abrir, por si expiró desde la
  // carga inicial; de paso refresca la lista.
  const openViewer = useCallback(
    async (file: Model3DFile) => {
      setUseClassic(false); // cada apertura arranca en el visor rediseñado
      try {
        const res = await fetch(`/api/patients/${patientId}/models-3d`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setFiles(data);
            const fresh = data.find((d: Model3DFile) => d.id === file.id);
            setViewer(fresh ?? file);
            return;
          }
        }
      } catch {
        /* ignore */
      }
      setViewer(file);
    },
    [patientId],
  );

  const onDelete = useCallback(
    async (file: Model3DFile) => {
      if (!window.confirm(t("patients.models3d.deleteConfirm", { name: file.name }))) return;
      try {
        const res = await fetch(`/api/patients/${patientId}/models-3d/${file.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? t("patients.models3d.deleteError"));
        }
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
        toast.success(t("patients.models3d.deleteSuccess"));
      } catch (err: any) {
        toast.error(err?.message ?? t("patients.models3d.deleteError"));
      }
    },
    [patientId, t],
  );

  // Cae al visor clásico (DicomSetViewer) si el rediseñado no puede leer el set,
  // o por elección manual (botón del header). Estable para el effect de fallback.
  const handleCbctFallback = useCallback(() => setUseClassic(true), []);

  // Cerrar visor con Escape.
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  return (
    <div className="space-y-4">
      {/* Barra de subida */}
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold">{t("patients.models3d.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("patients.models3d.fileCount", { count: files.length })} · {t("patients.models3d.formats")}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-brand-700 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {uploading ? t("patients.models3d.uploading") : t("patients.models3d.upload")}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={ACCEPT}
            onChange={onPick}
            disabled={uploading}
          />
        </label>
      </div>

      {/* Barra de progreso */}
      {uploading && (
        <div className="bg-card border border-border rounded-xl p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>{t("patients.models3d.uploading")}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-600 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Estado vacío */}
      {loaded && files.length === 0 && !uploading && (
        <div className="bg-card border border-border rounded-xl p-10 text-center">
          <div className="text-3xl mb-2">🦷</div>
          <p className="text-sm font-semibold text-muted-foreground">{t("patients.models3d.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("patients.models3d.emptyHint")}</p>
        </div>
      )}

      {/* Tarjetas de modelos */}
      {files.map((f) => (
        <div key={f.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
          {isZip(f.name) ? (
            <button
              type="button"
              onClick={() => openViewer(f)}
              className="w-16 h-16 rounded-lg flex flex-col items-center justify-center flex-shrink-0 gap-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              style={{ background: "rgba(124,58,237,.14)" }}
              aria-label={t("patients.models3d.view")}
            >
              <Layers className="w-5 h-5" style={{ color: "#a78bfa" }} aria-hidden />
              <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: "#a78bfa" }}>
                CBCT
              </span>
            </button>
          ) : (
            <Model3DThumbnail
              url={f.url}
              format={formatFromName(f.name)}
              sizeBytes={f.size}
              name={f.name}
              fileId={f.id}
              onOpen={() => openViewer(f)}
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{f.name}</p>
            <p className="text-xs text-muted-foreground">
              {f.size ? `${(f.size / (1024 * 1024)).toFixed(1)} MB · ` : ""}
              {new Date(f.createdAt).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => openViewer(f)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              <Box className="w-3.5 h-3.5" /> {t("patients.models3d.view")}
            </button>
            <button
              type="button"
              onClick={() => onDelete(f)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-rose-600 border border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              aria-label={t("patients.models3d.deleteAria", { name: f.name })}
              title={t("patients.models3d.view")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}

      {/* Modal del visor */}
      {viewer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("patients.models3d.viewerTitle", { name: viewer.name })}
          onClick={() => setViewer(null)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold truncate">{viewer.name}</h3>
                <p className="text-[11px] text-muted-foreground">{t("patients.models3d.viewerHint")}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isZip(viewer.name) && (
                  <button
                    type="button"
                    onClick={() => setUseClassic((c) => !c)}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
                    title="Cambiar entre el visor nuevo y el clásico"
                  >
                    {useClassic ? "Visor nuevo" : "Visor clásico"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewer(null)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                  aria-label={t("patients.models3d.close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {isZip(viewer.name) && !useClassic ? (
              // Visor CBCT rediseñado (T7 enchufa datos reales; el render del Stage
              // llega en T5). Altura fija para que el <CbctViewer/> llene el modal.
              <div style={{ height: "80vh" }}>
                <CbctStudyViewer
                  patientId={patientId}
                  file={viewer}
                  onClose={() => setViewer(null)}
                  onFallback={handleCbctFallback}
                />
              </div>
            ) : (
              <div className="p-3 max-h-[80vh] overflow-y-auto">
                {isZip(viewer.name) ? (
                  <DicomSetViewer
                    url={viewer.url}
                    name={viewer.name}
                    patientId={patientId}
                    fileId={viewer.id}
                    initialNotes={viewer.doctorNotes ?? ""}
                  />
                ) : formatFromName(viewer.name) === "dicom" ? (
                  <DicomViewer2D
                    url={viewer.url}
                    name={viewer.name}
                    patientId={patientId}
                    fileId={viewer.id}
                    initialNotes={viewer.doctorNotes ?? ""}
                  />
                ) : (
                  <Model3DViewer
                    url={viewer.url}
                    format={formatFromName(viewer.name)}
                    patientId={patientId}
                    fileId={viewer.id}
                    initialNotes={viewer.doctorNotes ?? ""}
                    initialAnnotations={viewer.annotations}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
