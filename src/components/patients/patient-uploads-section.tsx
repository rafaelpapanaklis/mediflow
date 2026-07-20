"use client";

// Sección "Subidos por el paciente" del expediente (lado clínica, WS1-T8).
// Lista los archivos que el paciente subió desde su portal y permite abrirlos
// con signed URL de corta duración. Aislado por clinicId en el endpoint
// GET /api/patients/[id]/uploads.
import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Inbox, RefreshCw, Upload } from "lucide-react";
import { BadgeNew } from "@/components/ui/design-system/badge-new";

interface UploadItem {
  id: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  kind: "ESTUDIO" | "IDENTIFICACION" | "OTRO";
  createdAt: string;
  url: string;
}

const KIND_LABEL: Record<UploadItem["kind"], string> = {
  ESTUDIO: "Estudio",
  IDENTIFICACION: "Identificación",
  OTRO: "Otro",
};

// Tono visual del badge por tipo de archivo (solo presentación).
const KIND_TONE: Record<UploadItem["kind"], "info" | "brand" | "neutral"> = {
  ESTUDIO: "info",
  IDENTIFICACION: "brand",
  OTRO: "neutral",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PatientUploadsSection({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(false);
    try {
      const res = await fetch(`/api/patients/${patientId}/uploads`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("load");
      const b = await res.json();
      setItems(Array.isArray(b.items) ? b.items : []);
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl p-4 shadow-[var(--shadow-1)] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Upload size={17} strokeWidth={1.75} aria-hidden />
          </span>
          <div>
            <h2 className="text-[15px] font-bold tracking-[-0.01em]">Subidos por el paciente</h2>
            <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
              {items.length} archivos · subidos desde el portal del paciente
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-2 min-h-[40px] rounded-lg hover:bg-[var(--bg-hover)] hover:border-[var(--border-brand)] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] disabled:opacity-[.45] disabled:cursor-not-allowed"
        >
          <RefreshCw size={14} strokeWidth={1.75} className={loading ? "animate-spin" : ""} aria-hidden />
          Actualizar
        </button>
      </div>

      {err ? (
        <div
          className="bg-[var(--danger-soft)] border rounded-xl p-8 text-center"
          style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)" }}
        >
          <p className="text-sm font-semibold text-[var(--danger-strong)]">
            No se pudieron cargar los archivos.
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-2 inline-flex items-center justify-center min-h-[40px] px-3 rounded-lg text-xs font-semibold text-[var(--brand)] hover:underline focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
          >
            Reintentar
          </button>
        </div>
      ) : loading && items.length === 0 ? (
        // Skeleton de carga con el mismo template de columnas del grid real.
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}
          aria-busy="true"
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-[var(--brand-softer)] border border-[var(--border-brand)] px-5 py-14 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)] shadow-[var(--shadow-1)]">
            <Inbox size={24} strokeWidth={1.75} aria-hidden />
          </span>
          <p className="text-sm font-bold text-foreground">
            El paciente aún no ha subido archivos.
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto">
            El paciente puede subirlos desde su portal — aparecerán aquí al instante.
          </p>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))" }}
        >
          {items.map((it) => {
            const isImage = it.fileType.startsWith("image/");
            return (
              <div
                key={it.id}
                className="bg-card border border-border rounded-2xl p-3 flex flex-col gap-2 shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)] hover:border-[var(--border-brand)] motion-safe:hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-start gap-2">
                  {isImage ? (
                    // La miniatura abre el archivo (misma signed URL de descarga).
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ver ${it.fileName}`}
                      className="flex-shrink-0 rounded-lg focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={it.url}
                        alt={it.fileName}
                        className="w-14 h-14 rounded-lg object-cover bg-muted"
                      />
                    </a>
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <FileText size={20} strokeWidth={1.75} className="text-[var(--text-3)]" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate" title={it.fileName}>
                      {it.fileName}
                    </p>
                    <p className="mt-1">
                      <BadgeNew tone={KIND_TONE[it.kind]}>{KIND_LABEL[it.kind]}</BadgeNew>
                    </p>
                    <p className="text-[11px] text-muted-foreground tabular-nums mt-1">
                      {formatSize(it.sizeBytes)} · {formatFecha(it.createdAt)}
                    </p>
                  </div>
                </div>
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-[var(--brand)] text-white px-3 py-2 min-h-[40px] rounded-lg hover:bg-[var(--violet-700)] active:scale-[.98] transition duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ring)]"
                >
                  <Download size={14} strokeWidth={1.75} aria-hidden />
                  Descargar
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
