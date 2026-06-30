"use client";

// Sección "Subidos por el paciente" del expediente (lado clínica, WS1-T8).
// Lista los archivos que el paciente subió desde su portal y permite abrirlos
// con signed URL de corta duración. Aislado por clinicId en el endpoint
// GET /api/patients/[id]/uploads.
import { useCallback, useEffect, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";

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
      <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold">Subidos por el paciente</h2>
          <p className="text-xs text-muted-foreground">
            Archivos que el paciente subió desde su portal ({items.length})
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {err ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm font-semibold text-muted-foreground">
            No se pudieron cargar los archivos.
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-3 text-xs font-semibold text-brand-600 hover:underline"
          >
            Reintentar
          </button>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-10 text-center">
          <div className="text-3xl mb-2">📁</div>
          <p className="text-sm font-semibold text-muted-foreground">
            El paciente aún no ha subido archivos.
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
                className="bg-card border border-border rounded-xl p-3 flex flex-col gap-2"
              >
                <div className="flex items-start gap-2">
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.url}
                      alt={it.fileName}
                      className="w-12 h-12 rounded-lg object-cover bg-muted flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate" title={it.fileName}>
                      {it.fileName}
                    </p>
                    <p className="mt-1">
                      <span className="inline-block px-1.5 py-0.5 rounded bg-muted text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {KIND_LABEL[it.kind]}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {formatSize(it.sizeBytes)} · {formatFecha(it.createdAt)}
                    </p>
                  </div>
                </div>
                <a
                  href={it.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
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
