"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H1/H3/H4.
// Ranura montada dentro de SectionDiagnosis (reemplaza la tarjeta
// decorativa «Próximamente»).
//
// ⚠ TRAZADO MANUAL CANCELADO (decisión de Rafael, 28-sep-2026, ws1-t4).
// El trazador de la Ola 1 mide MAL los ángulos: guarda los puntos en
// porcentaje de un recuadro 3:4, no en píxeles de la placa, así que SNA, SNB,
// ANB, FMA e IMPA salen deformados en cuanto la radiografía no tiene esa
// proporción. Un ángulo equivocado en un expediente es peor que ninguno.
// Por eso aquí YA NO se montan:
//   · `CephalometricTracer`  (marcar puntos sobre la placa) ni sus botones
//     «Subir radiografía lateral» / «Nuevo trazado (control)»;
//   · `CephalometricOverlay` (superposición antes/después) ni su botón;
//   · la tabla de ángulos calculados a partir de esos puntos.
// Los dos archivos siguen en esta carpeta, sin tocar, y los trazados manuales
// que ya existan siguen en la base: solo se dejan de pintar. Para volver a
// montarlos hay que corregir primero la geometría.
//
// Lo que queda, al frente: GUARDAR EL PDF DEL TRAZADO que entrega el centro
// radiológico o el programa del doctor (Dolphin, Nemoceph, WebCeph…) y la
// lista de los trazados guardados, para abrirlos.

import { useEffect, useState } from "react";
import { ExternalLink, FileText, Loader2, Upload } from "lucide-react";
import { Pill } from "../redesign/atoms/Pill";
import { fmtDate } from "../redesign/atoms/format";
import {
  listCephalometricAnalyses,
  type CephalometricAnalysisRow,
} from "@/app/actions/orthodontics/imagen/listCephalometricAnalyses";
import { saveCephalometricAnalysis } from "@/app/actions/orthodontics/imagen/saveCephalometricAnalysis";
import { isFailure } from "@/app/actions/orthodontics/result";
import orto from "../redesign/orto.module.css";

export interface CephalometriaPanelProps {
  treatmentPlanId: string;
  patientId: string;
}

type Etapa = CephalometricAnalysisRow["kind"];

const ETAPA_LABEL: Record<Etapa, string> = {
  INITIAL: "Inicial",
  PROGRESS: "Control",
  FINAL: "Final",
};

export function CephalometriaPanel({ treatmentPlanId, patientId }: CephalometriaPanelProps) {
  const [rows, setRows] = useState<CephalometricAnalysisRow[] | null>(null);
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCephalometricAnalyses(treatmentPlanId).then((res) => {
      // Si la lista no se puede leer, se pinta vacía en vez de quedarse en
      // «Cargando…» para siempre.
      setRows(res.ok ? res.data : []);
    });
  }, [treatmentPlanId]);

  // Solo los trazados que traen su PDF. Los manuales (puntos sobre la placa)
  // se quedan en la base pero no se pintan — ver la nota de arriba.
  const guardados = (rows ?? []).filter((r) => r.tracingPdfFileUrl);
  // Sin elegir, la etapa sale sola: el primero es el inicial y los demás, de control.
  const etapaElegida: Etapa = etapa ?? (guardados.length === 0 ? "INITIAL" : "PROGRESS");

  async function guardarPdf(file: File) {
    setError(null);
    setGuardando(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("patientId", patientId);
      form.append("kind", "tracing-pdf");
      const res = await fetch("/api/orthodontics/imagen/upload", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.fileId) {
        setError(json?.error ?? "No se pudo subir el PDF");
        return;
      }
      // El PDF se liga al caso como un trazado sin puntos: así aparece en la
      // lista de abajo. (Antes el archivo se subía y aquí no se volvía a ver.)
      const guardado = await saveCephalometricAnalysis({
        treatmentPlanId,
        kind: etapaElegida,
        analysisType: "STEINER",
        normSet: "STANDARD",
        points: {},
        tracingPdfFileId: json.fileId,
      });
      if (isFailure(guardado)) {
        setError(guardado.error);
        return;
      }
      const lista = await listCephalometricAnalyses(treatmentPlanId);
      if (lista.ok) setRows(lista.data);
      setEtapa(null);
    } catch {
      setError("No se pudo guardar el PDF. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="px-[18px] py-[14px]">
      <h4 className={`${orto.bloqueTitulo} mb-[3px]`}>Trazado cefalométrico</h4>
      <p className="text-xs text-[color:var(--pr-texto-3)] mb-3">
        Guarda el PDF del trazado que entrega el centro radiológico o tu programa (Dolphin,
        Nemoceph, WebCeph…).
      </p>

      {error ? (
        <div className={`${orto.aviso} ${orto.avisoPeligro} mb-3`} role="alert">
          {error}
        </div>
      ) : null}

      <div className="flex items-end gap-2 flex-wrap">
        <label className={orto.campo} style={{ flex: "0 1 130px" }}>
          <span className={orto.campoEtiqueta}>Etapa</span>
          <select
            value={etapaElegida}
            onChange={(e) => setEtapa(e.target.value as Etapa)}
            className={orto.entrada}
            disabled={guardando}
          >
            {(Object.keys(ETAPA_LABEL) as Etapa[]).map((k) => (
              <option key={k} value={k}>
                {ETAPA_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`${orto.boton} ${orto.botonPrincipal} ${orto.botonSubir}`}
          style={{ height: 38, flex: "1 1 190px" }}
          aria-disabled={guardando}
        >
          {guardando ? (
            <Loader2 size={15} strokeWidth={1.75} className="animate-spin" aria-hidden />
          ) : (
            <Upload size={15} strokeWidth={1.75} aria-hidden />
          )}
          {guardando ? "Guardando…" : "Guardar el PDF del trazado"}
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            disabled={guardando}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void guardarPdf(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="mt-[16px]">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={orto.ceja}>Trazados guardados</span>
          {guardados.length > 0 ? (
            <span className="text-xs font-semibold text-[color:var(--pr-texto-3)]">
              {guardados.length}
            </span>
          ) : null}
        </div>
        {rows === null ? (
          // Reserva el alto de una fila: al llegar la lista no hay salto.
          <div className={orto.vacioLinea} style={{ minHeight: 44 }} role="status">
            Cargando…
          </div>
        ) : guardados.length === 0 ? (
          <div className={orto.vacioLinea} style={{ minHeight: 44 }}>
            Todavía no hay trazados guardados en este caso.
          </div>
        ) : (
          <ul className="flex flex-col gap-[6px]">
            {/* El más reciente arriba. */}
            {[...guardados].reverse().map((r) => (
              <li key={r.id}>
                <a
                  href={r.tracingPdfFileUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${orto.listaFila} ${orto.listaFilaEnlace}`}
                  style={{ alignItems: "center", padding: "9px 11px" }}
                >
                  <FileText
                    size={16}
                    strokeWidth={1.75}
                    className={`${orto.tonoVioleta} flex-none`}
                    aria-hidden
                  />
                  <span className="flex-1 min-w-0 text-[13px] font-semibold">
                    Trazado del {fmtDate(r.createdAt)}
                  </span>
                  <Pill
                    color={r.kind === "INITIAL" ? "violet" : r.kind === "FINAL" ? "emerald" : "slate"}
                    size="xs"
                  >
                    {ETAPA_LABEL[r.kind]}
                  </Pill>
                  <span
                    className={`${orto.tonoVioleta} inline-flex items-center gap-1 text-xs font-semibold flex-none`}
                  >
                    Abrir
                    <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
