"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { CheckCircle2, FileJson, Upload, XCircle } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BLOG_IMPORT_LIMITS } from "@/lib/blog/types";

// ─────────────────────────────────────────────────────────────────────────────
// Importador JSON — sube un lote de artículos ya redactados y los programa.
//
// El archivo viaja como File dentro de un FormData: NUNCA se convierte a
// ArrayBuffer en el cliente ni se manda como argumento de un server action
// (los payloads binarios en args de server actions son la vía rápida al
// "Body exceeded" y a errores de serialización). El route handler lo lee con
// file.text().
//
// El reporte se muestra íntegro: rechazar unos cuantos artículos es normal y
// el motivo por slug es lo que permite arreglar el lote y reimportarlo.
// ─────────────────────────────────────────────────────────────────────────────

interface ImportReport {
  inserted: { slug: string; title: string; scheduledAt: string }[];
  rejected: { slug: string; reason: string }[];
  perDay: number;
  totalInFile: number;
}

const MAX_MB = BLOG_IMPORT_LIMITS.maxBytes / 1024 / 1024;

export function BlogImporter() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [perDay, setPerDay] = useState(String(BLOG_IMPORT_LIMITS.defaultPerDay));
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  function pick(next: File | null) {
    setReport(null);
    if (!next) {
      setFile(null);
      return;
    }
    const isJson = next.name.toLowerCase().endsWith(".json") || next.type === "application/json";
    if (!isJson) {
      toast.error("El archivo debe ser .json");
      return;
    }
    if (next.size > BLOG_IMPORT_LIMITS.maxBytes) {
      toast.error(`El archivo pesa más de ${MAX_MB} MB`);
      return;
    }
    setFile(next);
  }

  async function upload() {
    if (!file) {
      toast.error("Elige un archivo .json");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("perDay", perDay);

    setBusy(true);
    try {
      const res = await fetch("/api/admin/blog/import", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "No se pudo importar");

      const data = body as ImportReport;
      setReport(data);
      if (data.inserted.length > 0) {
        toast.success(
          `${data.inserted.length} artículo${data.inserted.length === 1 ? "" : "s"} programado${data.inserted.length === 1 ? "" : "s"}`,
        );
        router.refresh();
      } else {
        toast.error("No se importó ningún artículo");
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo importar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardNew
      title="Importar lote JSON"
      sub={`Máximo ${BLOG_IMPORT_LIMITS.maxItems} artículos y ${MAX_MB} MB. Entran como programados, espaciados a N por día a las 13:00 UTC.`}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          <div className="field-new">
            <label className="field-new__label">Archivo .json</label>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="input-new"
              onChange={(e) => pick(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
              style={{ padding: 8 }}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label">Artículos por día</label>
            <input
              type="number"
              min={1}
              max={BLOG_IMPORT_LIMITS.maxPerDay}
              className="input-new"
              value={perDay}
              onChange={(e) => setPerDay(e.target.value)}
            />
          </div>
          <ButtonNew
            variant="primary"
            icon={<Upload size={14} />}
            onClick={upload}
            disabled={busy || !file}
          >
            {busy ? "Importando…" : "Importar"}
          </ButtonNew>
        </div>

        {file && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: "var(--text-2)",
            }}
          >
            <FileJson size={14} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.name}
            </span>
            <span style={{ color: "var(--text-3)" }}>({Math.ceil(file.size / 1024)} KB)</span>
          </div>
        )}

        {report && (
          <div
            style={{
              borderTop: "1px solid var(--border-soft)",
              paddingTop: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--text-2)" }}>
              {report.totalInFile} en el archivo · {report.inserted.length} importados ·{" "}
              {report.rejected.length} rechazados · {report.perDay}/día
            </div>

            {report.inserted.length > 0 && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--success, #059669)",
                    marginBottom: 6,
                  }}
                >
                  <CheckCircle2 size={13} /> Importados
                </div>
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {report.inserted.map((r) => (
                    <div
                      key={r.slug}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 12,
                        padding: "4px 0",
                        borderBottom: "1px solid var(--border-soft)",
                      }}
                    >
                      <span className="mono" style={{ color: "var(--text-2)", minWidth: 0, overflowWrap: "anywhere" }}>
                        {r.slug}
                      </span>
                      <span style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>
                        {r.scheduledAt ? new Date(r.scheduledAt).toLocaleString("es-MX") : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.rejected.length > 0 && (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--danger, #dc2626)",
                    marginBottom: 6,
                  }}
                >
                  <XCircle size={13} /> Rechazados
                </div>
                <div style={{ maxHeight: 260, overflowY: "auto" }}>
                  {report.rejected.map((r, i) => (
                    <div
                      key={`${r.slug}-${i}`}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "2px 12px",
                        fontSize: 12,
                        padding: "5px 0",
                        borderBottom: "1px solid var(--border-soft)",
                      }}
                    >
                      <span className="mono" style={{ color: "var(--text-2)", overflowWrap: "anywhere" }}>
                        {r.slug}
                      </span>
                      <span style={{ color: "var(--text-3)", flex: 1, minWidth: 200 }}>{r.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CardNew>
  );
}
