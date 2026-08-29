"use client";
// Pestaña "Modelos 3D" del expediente: lista, sube, visualiza y borra estudios
// intraorales (STL/PLY/OBJ), DICOM sueltos y sets CBCT (.zip). Reusa PatientFile
// (category SCAN_STL) + bucket patient-files. El visor three.js se carga
// dinámicamente (code-split) solo al abrir un modelo. Multi-tenant: el API
// resuelve clinicId desde la sesión, nunca desde el cliente.
//
// SUBIDA: TODO se sube DIRECTO del navegador a Storage (uploadStudyDirect), sin
// pasar el binario por el servidor. Antes las mallas y los DICOM iban en un
// multipart al route handler y morían contra el techo de ~4.5 MB de la
// plataforma; sólo el .zip tenía subida directa. Ahora el techo es 2 GB para
// todos los formatos y en todos los planes (lo que limita de verdad es el
// almacenamiento contratado).

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Plus, Trash2, Box, X, Layers, Download, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import type { Model3DFormat } from "./Model3DViewer";
import DiagnosticDisclaimer from "./DiagnosticDisclaimer";
import {
  uploadStudyDirect,
  UploadCancelled,
  type UploadPhase,
} from "@/lib/uploads/direct-upload-client";
import {
  MAX_CBCT_LITE_BYTES,
  MAX_SERVER_INSPECT_BYTES,
  MAX_STUDY_UPLOAD_LABEL,
  STUDY_UPLOAD_ACCEPT,
  extOfName,
  formatBytes,
  isMeshExt,
} from "@/lib/uploads/patient-study-upload";

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
  // GLB web-optimizado hermano (firmado) que devuelven GET/POST; "" o ausente
  // para DICOM/legacy/conversión fallida. El visor de malla lo carga si existe.
  webUrl?: string;
  size: number | null;
  mimeType: string | null;
  createdAt: string;
  doctorNotes?: string | null;
  annotations?: unknown;
  // CBCT reducido para móvil (`.lite2.bin`); "" si aún no se generó. Lo llena el GET.
  liteUrl?: string;
}

function isZip(name: string): boolean {
  return /\.zip$/i.test(name);
}

/**
 * ¿Este estudio se quedó SIN procesamiento automático por su tamaño?
 *
 * Se deduce del propio archivo (nombre + tamaño), no de la respuesta de la
 * subida: la lista se recarga con GET y la tarjeta tiene que poder decir la
 * verdad también al abrir el expediente al día siguiente.
 *   · malla > 60 MB  → no se generó el GLB web (el visor abre el original)
 *   · CBCT  > 700 MB → no se puede generar la versión ligera para móvil
 */
function unprocessedReason(name: string, size: number | null): "mesh" | "cbct" | null {
  if (size == null) return null;
  const ext = extOfName(name);
  if (isMeshExt(ext) && size > MAX_SERVER_INSPECT_BYTES) return "mesh";
  if (isZip(name) && size > MAX_CBCT_LITE_BYTES) return "cbct";
  return null;
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
  // Fase + intento: sin esto, un corte de red durante un reintento se ve igual
  // que una subida colgada. Con esto la barra dice "Reintentando (2 de 3)…".
  const [phase, setPhase] = useState<UploadPhase | null>(null);
  const [attempt, setAttempt] = useState(1);
  const [quotaHit, setQuotaHit] = useState(false);
  const [viewer, setViewer] = useState<Model3DFile | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // Subida DIRECTA a Storage para TODOS los formatos (mallas, DICOM y CBCT).
  // El binario nunca toca el servidor: éste sólo firma antes y registra después.
  // Cancelar aborta el PUT y borra del bucket lo que se hubiera subido, para no
  // dejar espacio fantasma que la clínica paga y nadie ve.
  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setUploading(true);
      setProgress(0);
      setPhase("signing");
      setAttempt(1);

      void (async () => {
        try {
          const created = await uploadStudyDirect({
            patientId,
            file,
            signal: controller.signal,
            onProgress: setProgress,
            onPhase: (p, n) => {
              setPhase(p);
              setAttempt(n);
            },
          });
          setFiles((prev) => [created as Model3DFile, ...prev]);
          toast.success(t("patients.models3d.uploadSuccess"));
        } catch (err: any) {
          // Cancelar es una decisión del usuario, no un fallo: aviso neutro.
          if (err instanceof UploadCancelled) {
            toast(t("patients.models3d.uploadCancelled"));
          } else {
            // El mensaje viene del servidor (cuota con cifras, formato, 413 del
            // bucket) o del cliente; siempre dice qué pasó y qué hacer.
            toast.error(err?.message || t("patients.models3d.uploadError"));
            // El código lo manda el servidor: nada de adivinar leyendo el texto.
            if (err?.code === "PLAN_LIMIT_STORAGE") setQuotaHit(true);
          }
        } finally {
          abortRef.current = null;
          setUploading(false);
          setProgress(0);
          setPhase(null);
        }
      })();
    },
    [patientId, t],
  );

  const cancelUpload = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Descarga del estudio. Re-firma ANTES de abrir: la URL de la lista dura 5
  // minutos y un expediente abierto un rato deja links caducados que revientan
  // con un XML de error de Storage — un fallo mudo en la práctica.
  // `?download=` hace que Storage mande Content-Disposition: attachment con el
  // nombre real, en vez de que el navegador intente pintar el binario.
  const downloadFile = useCallback(
    async (file: Model3DFile) => {
      try {
        const res = await fetch(`/api/patients/${patientId}/models-3d`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const fresh = Array.isArray(data) ? data.find((d: Model3DFile) => d.id === file.id) : null;
        if (!fresh?.url) throw new Error();
        setFiles(data);
        const sep = fresh.url.includes("?") ? "&" : "?";
        window.open(`${fresh.url}${sep}download=${encodeURIComponent(file.name)}`, "_blank");
      } catch {
        toast.error(t("patients.models3d.loadError"));
      }
    },
    [patientId, t],
  );

  // Re-firma la signed URL (TTL 5 min) antes de abrir, por si expiró desde la
  // carga inicial; de paso refresca la lista.
  const openViewer = useCallback(
    async (file: Model3DFile) => {
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
            {t("patients.models3d.fileCount", { count: files.length })} ·{" "}
            {t("patients.models3d.formats", { max: MAX_STUDY_UPLOAD_LABEL })}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-brand-700 transition-colors">
          <Plus className="w-3.5 h-3.5" />
          {uploading ? t("patients.models3d.uploading") : t("patients.models3d.upload")}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={STUDY_UPLOAD_ACCEPT}
            onChange={onPick}
            disabled={uploading}
          />
        </label>
      </div>

      {/* Cuota del plan agotada: mismo patrón (y misma ruta) que la pestaña de
          fotos clínicas, para que el CTA de plan viva en un solo lugar visual. */}
      {quotaHit && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden />
            <span>{t("patients.fotosTab.quotaTitle")}</span>
          </div>
          <Link
            href="/dashboard/settings?tab=subscription"
            className="text-xs font-bold px-3.5 py-2.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors flex-shrink-0 no-underline"
          >
            {t("patients.fotosTab.quotaCta")}
          </Link>
        </div>
      )}

      {/* Barra de progreso. Dice SIEMPRE en qué fase va: firmando, subiendo,
          reintentando tras un corte o registrando. Una subida de 2 GB sin este
          detalle es indistinguible de una pestaña colgada. */}
      {uploading && (
        <div className="bg-card border border-border rounded-xl p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5 gap-3">
            <span className={phase === "retrying" ? "text-amber-600 dark:text-amber-400 font-semibold" : undefined}>
              {phase === "signing"
                ? t("patients.models3d.preparing")
                : phase === "retrying"
                  ? t("patients.models3d.retrying", { attempt, total: 3 })
                  : phase === "confirming"
                    ? t("patients.models3d.registering")
                    : t("patients.models3d.uploading")}
            </span>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span>{progress}%</span>
              <button
                type="button"
                onClick={cancelUpload}
                className="flex items-center gap-1 font-semibold text-rose-600 hover:text-rose-700 transition-colors"
                aria-label={t("patients.models3d.cancelUpload")}
              >
                <X className="w-3.5 h-3.5" aria-hidden />
                {t("patients.models3d.cancel")}
              </button>
            </div>
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
              {f.size ? `${formatBytes(f.size)} · ` : ""}
              {new Date(f.createdAt).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </p>
            {/* Estado EXPLÍCITO de los estudios que no pasaron por el
                procesamiento automático por su tamaño. Se dice aquí, en la
                tarjeta, y no al abrir el visor: así el usuario sabe qué
                esperar ANTES de esperar. Nunca un spinner que no acaba. */}
            {unprocessedReason(f.name, f.size) && (
              <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3 h-3 mt-[1px] flex-shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">{t("patients.models3d.noAutoProcess")}</span>{" "}
                  {unprocessedReason(f.name, f.size) === "cbct"
                    ? t("patients.models3d.cbctDesktopOnly")
                    : t("patients.models3d.noAutoProcessHint")}
                </span>
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => openViewer(f)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              <Box className="w-3.5 h-3.5" /> {t("patients.models3d.view")}
            </button>
            {/* Descarga: la salida SIEMPRE disponible, y la única realista para
                un estudio que el visor del navegador no aguanta. Re-firma al
                pulsar (la URL de la lista caduca a los 5 min). */}
            <button
              type="button"
              onClick={() => downloadFile(f)}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
              aria-label={t("patients.models3d.downloadAria", { name: f.name })}
            >
              <Download className="w-3.5 h-3.5" aria-hidden />
              {t("patients.models3d.downloadStudy")}
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
              <button
                type="button"
                onClick={() => setViewer(null)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
                aria-label={t("patients.models3d.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* ENTRADA ÚNICA "Ver en 3D": el botón del modelo abre este modal y
                aquí se elige el visor REAL según el tipo de archivo — nunca el
                placeholder de descarga de Model3DViewer (su rama DICOM):
                  · .zip           → DicomSetViewer (set CBCT: MPR + volumen 3D)
                  · .dcm / .dicom  → DicomViewer2D (corte único 2D)
                  · .stl/.ply/.obj → Model3DViewer (malla 3D)
                El clinicId y la signed URL los resuelve el API; multi-tenant intacto. */}
            <div className="p-3 max-h-[80vh] overflow-y-auto">
              {isZip(viewer.name) ? (
                <DicomSetViewer
                  url={viewer.url}
                  name={viewer.name}
                  patientId={patientId}
                  fileId={viewer.id}
                  liteUrl={viewer.liteUrl}
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
                  webUrl={viewer.webUrl}
                  format={formatFromName(viewer.name)}
                  patientId={patientId}
                  fileId={viewer.id}
                  initialNotes={viewer.doctorNotes ?? ""}
                  initialAnnotations={viewer.annotations}
                />
              )}
            </div>
            {/* Leyenda legal persistente: se monta UNA vez aquí (no en cada visor
                interno) para que aparezca igual con malla, DICOM o CBCT. */}
            <DiagnosticDisclaimer text={t("patients.models3d.diagnosticDisclaimer")} />
          </div>
        </div>
      )}
    </div>
  );
}
