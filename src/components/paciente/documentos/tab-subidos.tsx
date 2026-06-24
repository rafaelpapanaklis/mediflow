"use client";

// Tab "Mis archivos" del portal del paciente (WS1-T8). Subir (drag & drop o
// clic) + lista con descargar/eliminar. Estilo dark del portal; responsive sin
// anchos fijos; español neutro con tú.
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { usePacienteData } from "@/lib/patient-portal/use-paciente";
import type {
  PacienteClinica,
  PacienteSubidoKind,
  PacienteSubidosResponse,
} from "@/lib/patient-portal/types";
import {
  PacienteCard,
  PacienteEmptyState,
  clinicName,
  formatFecha,
} from "@/components/paciente/ui";

const TEXT = "rgba(255,255,255,0.92)";
const MUTED = "rgba(255,255,255,0.55)";
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png", "webp"];

const KIND_LABEL: Record<PacienteSubidoKind, string> = {
  ESTUDIO: "Estudio",
  IDENTIFICACION: "Identificación",
  OTRO: "Otro",
};

function extOf(name: string): string {
  const p = name.split(".");
  return p.length > 1 ? p.pop()!.toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TabSubidos({ clinics }: { clinics: PacienteClinica[] }) {
  const { data, error, isLoading, mutate } = usePacienteData<PacienteSubidosResponse>(
    "/api/paciente/documentos/subidos",
  );

  const [kind, setKind] = useState<PacienteSubidoKind>("ESTUDIO");
  const [clinicId, setClinicId] = useState<string>(clinics[0]?.clinicId ?? "");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = data?.items ?? [];

  async function uploadOne(file: File): Promise<boolean> {
    const ext = extOf(file.name);
    if (!ALLOWED_EXT.includes(ext)) {
      setMsg({ tone: "err", text: `"${file.name}": formato no permitido (PDF, JPG, PNG o WEBP).` });
      return false;
    }
    if (file.size > MAX_SIZE) {
      setMsg({ tone: "err", text: `"${file.name}": supera el máximo de 15 MB.` });
      return false;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    fd.append("clinicId", clinicId || clinics[0]?.clinicId || "");
    const res = await fetch("/api/paciente/documentos/subir", {
      method: "POST",
      credentials: "same-origin",
      body: fd,
    });
    if (!res.ok) {
      let text = "No se pudo subir el archivo.";
      try {
        const b = await res.json();
        if (b?.error) text = b.error;
      } catch {
        /* body no-JSON */
      }
      setMsg({ tone: "err", text: `"${file.name}": ${text}` });
      return false;
    }
    return true;
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || uploading) return;
    setUploading(true);
    setMsg(null);
    let ok = 0;
    for (const f of Array.from(list)) {
      // eslint-disable-next-line no-await-in-loop
      if (await uploadOne(f)) ok++;
    }
    setUploading(false);
    if (ok > 0) {
      setMsg({ tone: "ok", text: ok === 1 ? "Archivo subido." : `${ok} archivos subidos.` });
      mutate();
    }
  }

  async function descargar(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(
        `/api/paciente/documentos/descargar?tipo=subido&id=${encodeURIComponent(id)}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) throw new Error("descarga");
      const b = await res.json();
      if (b?.url) window.open(b.url, "_blank", "noopener,noreferrer");
    } catch {
      setMsg({ tone: "err", text: "No se pudo abrir el archivo. Intenta de nuevo." });
    } finally {
      setBusyId(null);
    }
  }

  async function eliminar(id: string) {
    if (!window.confirm("¿Eliminar este archivo? Esta acción no se puede deshacer.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/paciente/documentos/subidos?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("delete");
      setMsg({ tone: "ok", text: "Archivo eliminado." });
      mutate();
    } catch {
      setMsg({ tone: "err", text: "No se pudo eliminar. Intenta de nuevo." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PacienteCard title="Subir un archivo">
        <p style={{ color: MUTED, fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
          Sube estudios, tu identificación u otros documentos para tu clínica. PDF, JPG, PNG o WEBP,
          máximo 15 MB.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <label style={fieldWrap}>
            <span style={fieldLabel}>Tipo</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PacienteSubidoKind)}
              style={selectStyle}
            >
              <option value="ESTUDIO">Estudio</option>
              <option value="IDENTIFICACION">Identificación</option>
              <option value="OTRO">Otro</option>
            </select>
          </label>

          {clinics.length > 1 && (
            <label style={fieldWrap}>
              <span style={fieldLabel}>Clínica</span>
              <select
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
                style={selectStyle}
              >
                {clinics.map((c) => (
                  <option key={c.clinicId} value={c.clinicId}>
                    {clinicName(clinics, c.clinicId)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Arrastra un archivo aquí o haz clic para elegir"
          onClick={() => !uploading && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !uploading) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          style={{
            border: dragOver ? "2px dashed #8b5cf6" : "1px dashed rgba(255,255,255,0.2)",
            borderRadius: 14,
            padding: "26px 16px",
            textAlign: "center",
            cursor: uploading ? "default" : "pointer",
            background: dragOver ? "rgba(124,58,237,0.08)" : "rgba(255,255,255,0.02)",
            transition: "all .15s",
          }}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }} aria-hidden>
            📎
          </div>
          <p style={{ margin: 0, color: TEXT, fontSize: 14, fontWeight: 600 }}>
            {uploading ? "Subiendo…" : "Arrastra un archivo o haz clic para elegir"}
          </p>
          <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 12 }}>
            PDF, JPG, PNG o WEBP · máx 15 MB
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            disabled={uploading}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
            style={{ display: "none" }}
          />
        </div>

        {msg && (
          <p
            role="status"
            style={{
              margin: "12px 0 0",
              fontSize: 13,
              color: msg.tone === "ok" ? "#34d399" : "#f87171",
            }}
          >
            {msg.text}
          </p>
        )}
      </PacienteCard>

      <PacienteCard title="Mis archivos">
        {isLoading && !data ? (
          <PacienteEmptyState message="Cargando tus archivos…" />
        ) : error && !data ? (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <p style={{ color: MUTED, margin: "0 0 12px" }}>
              No pudimos cargar tus archivos. Revisa tu conexión e intenta de nuevo.
            </p>
            <button type="button" onClick={() => mutate()} style={retryBtn}>
              Reintentar
            </button>
          </div>
        ) : items.length === 0 ? (
          <PacienteEmptyState message="Aún no has subido archivos. Sube tu primer documento arriba." />
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {items.map((it) => (
              <li key={it.id} style={rowStyle}>
                <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                  <p
                    style={{
                      margin: 0,
                      color: TEXT,
                      fontSize: 14,
                      fontWeight: 600,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {it.fileName}
                  </p>
                  <p style={{ margin: "3px 0 0", color: MUTED, fontSize: 12 }}>
                    <span style={kindBadge}>{KIND_LABEL[it.kind]}</span>
                    {` · ${formatSize(it.sizeBytes)} · ${formatFecha(it.createdAt)}`}
                    {clinics.length > 1 ? ` · ${clinicName(clinics, it.clinicId)}` : ""}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    disabled={busyId === it.id}
                    onClick={() => descargar(it.id)}
                    style={outlineBtn}
                  >
                    Descargar
                  </button>
                  <button
                    type="button"
                    disabled={busyId === it.id}
                    onClick={() => eliminar(it.id)}
                    style={dangerBtn}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PacienteCard>
    </div>
  );
}

const fieldWrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  flex: "1 1 160px",
};

const fieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: MUTED,
};

const selectStyle: CSSProperties = {
  appearance: "none",
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  color: TEXT,
  fontSize: 14,
  fontFamily: "inherit",
  padding: "9px 12px",
  cursor: "pointer",
};

const retryBtn: CSSProperties = {
  background: "#7c3aed",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 14px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
};

const kindBadge: CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  padding: "2px 8px",
  borderRadius: 999,
  color: "#a78bfa",
  background: "rgba(124,58,237,0.18)",
  marginRight: 2,
};

const outlineBtn: CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(139,92,246,0.5)",
  color: "#a78bfa",
  borderRadius: 10,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

const dangerBtn: CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(248,113,113,0.4)",
  color: "#f87171",
  borderRadius: 10,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};
