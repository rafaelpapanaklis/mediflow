"use client";

// "Archivos en bloque" — sub-flujo de "Importar mi clínica": sube muchos
// archivos (radiografías, fotos, PDFs) de MUCHOS pacientes a la vez, DIRECTO a
// Storage (nunca por el body de la función), emparejados por ID externo o por
// nombre de carpeta/archivo. Vista previa del emparejamiento ANTES de subir un
// solo byte; lo que no se pudo emparejar NUNCA se sube solo.
//
// No encaja en el asistente de hoja de cálculo (StepUpload/StepMapping/
// StepReview son para .xlsx/.csv con columnas): aquí no hay columnas, hay
// archivos binarios y un paciente por archivo. Vive como su propio bloque
// dentro del mismo modal (igual que "Migración asistida").

import { useRef, useState } from "react";
import { UploadCloud, FolderOpen, AlertTriangle, Check, X as XIcon, Search } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import {
  FILE_CATEGORIES,
  type FileCategoryValue,
  isBulkFileExt,
  extOfName,
  formatBytes,
} from "@/lib/uploads/patient-bulk-file-upload";
import { uploadPatientFilesBulk, type BulkUploadResult } from "@/lib/uploads/bulk-file-upload-client";

const CATEGORY_LABEL: Record<FileCategoryValue, string> = {
  XRAY_PERIAPICAL: "Radiografía periapical",
  XRAY_PANORAMIC: "Radiografía panorámica",
  XRAY_BITEWING: "Radiografía de aleta (bitewing)",
  XRAY_OCCLUSAL: "Radiografía oclusal",
  XRAY_CBCT: "Tomografía CBCT",
  XRAY_CEPHALOMETRIC: "Radiografía lateral de cráneo (cefalométrica)",
  PHOTO_FRONTAL: "Foto frontal",
  PHOTO_LATERAL: "Foto lateral",
  PHOTO_OCCLUSAL_UPPER: "Foto oclusal superior",
  PHOTO_OCCLUSAL_LOWER: "Foto oclusal inferior",
  PHOTO_INTRAORAL: "Foto intraoral",
  PHOTO_PATIENT: "Foto del paciente",
  CONSENT_FORM: "Consentimiento firmado",
  ORTHO_PHOTO_T0: "Foto ortodoncia — inicial",
  ORTHO_PHOTO_T1: "Foto ortodoncia — control 1",
  ORTHO_PHOTO_T2: "Foto ortodoncia — control 2",
  ORTHO_PHOTO_CONTROL: "Foto ortodoncia — control",
  CEPH_ANALYSIS_PDF: "Análisis cefalométrico (PDF)",
  SCAN_STL: "Escaneo 3D",
  OTHER: "Otro",
};

interface FilaArchivo {
  file: File;
  folderName: string | null;
  patientId: string | null;
  patientName: string | null;
  matchedBy: "externalId" | "folio" | "name" | null;
  ambiguous?: boolean;
  category: FileCategoryValue;
  /** Se llena después de intentar subir. */
  result?: BulkUploadResult;
}

type SubPaso = "elegir" | "emparejar" | "subiendo" | "resultado";

interface Props {
  t: TFunction;
  /** El origen ya elegido en el paso 1 del asistente (si lo hay): mismo sistema para el ID externo. */
  originId: string | null;
  onClose: () => void;
}

function readEntries(fileList: FileList): { file: File; folderName: string | null }[] {
  return Array.from(fileList).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const folderName = rel && rel.includes("/") ? rel.split("/")[0] : null;
    return { file, folderName };
  });
}

/** Buscador de reasignación manual (GET /api/patients/search, ya existe). */
function BuscadorPaciente({ onPick }: { onPick: (p: { id: string; name: string }) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string; phone: string | null }>>([]);
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    if (q.trim().length < 2) return;
    setBuscando(true);
    try {
      const res = await fetch(`/api/patients/search?q=${encodeURIComponent(q.trim())}`);
      const j = await res.json().catch(() => ({ hits: [] }));
      setHits(Array.isArray(j?.hits) ? j.hits.slice(0, 5) : []);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="input-new input-new--sm"
          placeholder="Nombre o teléfono…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
        />
        <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={buscar} disabled={buscando}>
          <Search size={14} />
        </button>
      </div>
      {hits.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="btn-new btn-new--ghost btn-new--sm"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => onPick({ id: h.id, name: h.name })}
              >
                {h.name} {h.phone ? `· ${h.phone}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FilesWizard({ t, originId, onClose }: Props) {
  const [sub, setSub] = useState<SubPaso>("elegir");
  const [filas, setFilas] = useState<FilaArchivo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progreso, setProgreso] = useState({ hecho: 0, total: 0 });
  const [reasignando, setReasignando] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  async function elegirArchivos(entries: { file: File; folderName: string | null }[]) {
    const validos = entries.filter((e) => isBulkFileExt(extOfName(e.file.name)));
    const invalidos = entries.length - validos.length;
    if (validos.length === 0) {
      setError(invalidos > 0 ? "Ninguno de esos archivos es un formato aceptado (jpg, png, pdf…)" : "Elige al menos un archivo");
      return;
    }
    setError(invalidos > 0 ? `${invalidos} archivo(s) con formato no aceptado se dejaron fuera` : null);
    setCargando(true);
    try {
      const res = await fetch("/api/import/patient-files/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: originId,
          files: validos.map((e, index) => ({ index, fileName: e.file.name, folderName: e.folderName, size: e.file.size })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(String(j?.error ?? "No se pudo emparejar el lote"));
        setCargando(false);
        return;
      }
      const j = (await res.json()) as {
        matches: Array<{ index: number; patientId: string | null; patientName: string | null; matchedBy: "externalId" | "folio" | "name" | null; ambiguous?: boolean; category: string }>;
      };
      const porIndice = new Map(j.matches.map((m) => [m.index, m]));
      setFilas(
        validos.map((e, index) => {
          const m = porIndice.get(index);
          return {
            file: e.file,
            folderName: e.folderName,
            patientId: m?.patientId ?? null,
            patientName: m?.patientName ?? null,
            matchedBy: m?.matchedBy ?? null,
            ambiguous: m?.ambiguous,
            category: (m?.category as FileCategoryValue) ?? "OTHER",
          };
        }),
      );
      setSub("emparejar");
    } finally {
      setCargando(false);
    }
  }

  function actualizarCategoria(i: number, category: FileCategoryValue) {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, category } : f)));
  }
  function quitarFila(i: number) {
    setFilas((prev) => prev.filter((_, idx) => idx !== i));
  }
  function reasignar(i: number, p: { id: string; name: string }) {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, patientId: p.id, patientName: p.name, matchedBy: "name", ambiguous: false } : f)));
    setReasignando(null);
  }

  const emparejadas = filas.filter((f) => f.patientId);
  const sinEmparejar = filas.length - emparejadas.length;

  async function subir() {
    setSub("subiendo");
    setProgreso({ hecho: 0, total: emparejadas.length });
    const inputs = emparejadas.map((f) => ({ file: f.file, patientId: f.patientId!, category: f.category }));
    const resultados = await uploadPatientFilesBulk(inputs, {
      onItemDone: (hecho, total) => setProgreso({ hecho, total }),
    });
    let ri = 0;
    setFilas((prev) =>
      prev.map((f) => {
        if (!f.patientId) return f;
        return { ...f, result: resultados[ri++] };
      }),
    );
    setSub("resultado");
  }

  const subidos = filas.filter((f) => f.result?.ok && !f.result.skippedDuplicate).length;
  const duplicados = filas.filter((f) => f.result?.skippedDuplicate).length;
  const conError = filas.filter((f) => f.result && !f.result.ok).length;

  return (
    <div>
      <h2 className="imp-title">Archivos en bloque</h2>
      <p className="imp-sub">Radiografías, fotos y PDFs de muchos pacientes a la vez, directo a su expediente.</p>

      {sub === "elegir" && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { if (e.target.files?.length) elegirArchivos(readEntries(e.target.files)); e.target.value = ""; }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            hidden
            // @ts-expect-error: atributo no tipado por React, soportado en Chromium/Firefox.
            webkitdirectory=""
            onChange={(e) => { if (e.target.files?.length) elegirArchivos(readEntries(e.target.files)); e.target.value = ""; }}
          />
          <div className="imp-dropzone" role="presentation">
            <span className="imp-dz__ic" aria-hidden><UploadCloud size={28} /></span>
            <h4>Elige archivos o una carpeta por paciente</h4>
            <p>Nómbralos con el folio del paciente (&ldquo;P0166_rx.jpg&rdquo;), su ID del sistema de origen o su nombre, o usa una carpeta por paciente.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
              <button type="button" className="btn-new btn-new--secondary" onClick={() => inputRef.current?.click()} disabled={cargando}>
                Elegir archivos
              </button>
              <button type="button" className="btn-new btn-new--secondary" onClick={() => folderInputRef.current?.click()} disabled={cargando}>
                <FolderOpen size={16} /> Elegir carpeta
              </button>
            </div>
            <p className="imp-dz__formats">Formatos: jpg, png, gif, webp, bmp, tiff, pdf · máx. 50 MB por archivo</p>
          </div>
          {error && <div className="imp-inline-msg"><AlertTriangle size={17} aria-hidden /> {error}</div>}
          {cargando && <p className="imp-hint">Emparejando…</p>}
        </>
      )}

      {sub === "emparejar" && (
        <>
          <div className="imp-stat-grid">
            <div className="imp-stat-card ok">
              <div className="imp-stat-card__top"><span className="imp-stat-card__ic" aria-hidden><Check size={17} /></span><span className="imp-stat-card__lbl">Emparejados</span></div>
              <div className="imp-stat-card__val mono">{emparejadas.length}</div>
            </div>
            <div className="imp-stat-card warn">
              <div className="imp-stat-card__top"><span className="imp-stat-card__ic" aria-hidden><AlertTriangle size={17} /></span><span className="imp-stat-card__lbl">Sin emparejar</span></div>
              <div className="imp-stat-card__val mono">{sinEmparejar}</div>
            </div>
          </div>
          {sinEmparejar > 0 && (
            <p className="imp-hint" style={{ margin: "10px 0 0" }}>
              Lo sin emparejar NUNCA se sube solo: reasígnalo a mano o quítalo del lote.
            </p>
          )}
          <div className="table-wrap" style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", overflow: "hidden", marginTop: 12 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table-new" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Archivo</th>
                    <th>Categoría</th>
                    <th>Tamaño</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i} className={!f.patientId ? "imp-row-err" : f.ambiguous ? "imp-row-dup" : ""}>
                      <td>
                        {f.patientId ? (
                          <>
                            {f.patientName}
                            <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-3)" }}>
                              ({f.matchedBy === "externalId" ? "por ID" : f.matchedBy === "folio" ? "por folio" : "por nombre"})
                            </span>
                          </>
                        ) : reasignando === i ? (
                          <BuscadorPaciente onPick={(p) => reasignar(i, p)} />
                        ) : (
                          <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={() => setReasignando(i)}>
                            Sin emparejar — asignar
                          </button>
                        )}
                      </td>
                      <td className="mono">{f.file.name}{f.folderName ? ` (${f.folderName}/)` : ""}</td>
                      <td>
                        <select
                          className="input-new input-new--sm"
                          value={f.category}
                          onChange={(e) => actualizarCategoria(i, e.target.value as FileCategoryValue)}
                        >
                          {FILE_CATEGORIES.map((c) => (
                            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="mono">{formatBytes(f.file.size)}</td>
                      <td>
                        <button type="button" className="icon-btn-new" aria-label="Quitar" onClick={() => quitarFila(i)}>
                          <XIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn-new btn-new--secondary" onClick={() => setSub("elegir")}>Atrás</button>
            <button type="button" className="btn-new btn-new--primary" onClick={subir} disabled={emparejadas.length === 0}>
              Subir {emparejadas.length} archivo(s)
            </button>
          </div>
        </>
      )}

      {sub === "subiendo" && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <h3 className="imp-title">Subiendo tus archivos…</h3>
          <p className="imp-sub">No cierres esta ventana.</p>
          <div className="imp-hint">{progreso.hecho} de {progreso.total}</div>
        </div>
      )}

      {sub === "resultado" && (
        <>
          <div className="imp-stat-grid">
            <div className="imp-stat-card ok">
              <div className="imp-stat-card__top"><span className="imp-stat-card__ic" aria-hidden><Check size={17} /></span><span className="imp-stat-card__lbl">Subidos</span></div>
              <div className="imp-stat-card__val mono">{subidos}</div>
            </div>
            <div className="imp-stat-card warn">
              <div className="imp-stat-card__top"><span className="imp-stat-card__lbl">Ya existían (omitidos)</span></div>
              <div className="imp-stat-card__val mono">{duplicados}</div>
            </div>
            <div className="imp-stat-card err">
              <div className="imp-stat-card__top"><span className="imp-stat-card__lbl">Con error</span></div>
              <div className="imp-stat-card__val mono">{conError}</div>
            </div>
          </div>
          {conError > 0 && (
            <ul style={{ marginTop: 12 }}>
              {filas.filter((f) => f.result && !f.result.ok).map((f, i) => (
                <li key={i} className="imp-hint">{f.file.name}: {f.result?.error}</li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn-new btn-new--secondary" onClick={() => { setFilas([]); setSub("elegir"); }}>
              Subir otro lote
            </button>
            <button type="button" className="btn-new btn-new--primary" onClick={onClose}>Listo</button>
          </div>
        </>
      )}
    </div>
  );
}
