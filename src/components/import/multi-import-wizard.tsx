"use client";

// ============================================================================
// "Importar mi clínica" — subir VARIOS archivos a la vez (WS1-T12).
//
// Sub-flujo hermano de FilesWizard (archivos en bloque): vive dentro del mismo
// modal, con su propio estado. A diferencia de FilesWizard (binarios, sin
// columnas), aquí cada archivo/hoja SÍ tiene columnas — reutiliza StepMapping
// y StepReview tal cual, uno por archivo, en vez de reinventarlos.
//
// Flujo: elegir varios .xlsx/.csv (un .xlsx de varias pestañas cuenta como
// varias) → POST /api/import/detect los clasifica con nivel de confianza →
// el usuario corrige lo que haga falta (nunca se adivina en silencio: lo no
// reconocido queda "sin identificar") → se ordenan por dependencia (pacientes
// primero) → se procesan EN ESE ORDEN, uno a la vez, por las MISMAS rutas de
// importación de siempre (preview/commit por entidad): "Confirmar automático"
// avanza solo cuando el archivo no necesita atención (sin mapeo pendiente, sin
// montos ambiguos sin decidir); si no, se confirma o se salta archivo por
// archivo. Nada se importa hasta que el usuario confirma. Un archivo que falla
// no detiene a los demás: el resultado final es un resumen por archivo.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { UploadCloud, X as XIcon, ArrowRight, AlertCircle, RefreshCw } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import {
  type ImportClient,
  type Entity,
  type ColumnMapping,
  type PreviewResult,
  type CommitResult,
  type Origin,
  type OnUploadProgress,
  type ValueMapping,
  type ValueOption,
  type DetectBatchResult,
  type DetectGuess,
  type Confidence,
  DATA_TYPES,
  ORIGINS,
  VALUE_UNLINKED,
  isAcceptedFile,
  MAX_FILE_MB,
  MAX_BATCH_FILES,
  MAX_BATCH_MB,
} from "./import-client";
import { RealImportClient, esErrorTransitorio } from "@/lib/import/client";
import { StepMapping } from "./step-mapping";
import { StepReview } from "./step-review";
import { UploadProgress, type UploadProgressState } from "./upload-progress";

/** El cliente real ya implementa esto (`RealImportClient.detectBatch`); un mock de test también puede. */
export type ImportClientWithDetect = ImportClient & {
  detectBatch(files: File[], origin: string | null): Promise<DetectBatchResult>;
};

type Sub = "elegir" | "plan" | "cola" | "resultado";

/** Un archivo, o UNA pestaña de un .xlsx de varias — la unidad del "plan" y de la cola. */
interface PlanItem {
  key: string;
  fileIndex: number;
  file: File;
  fileName: string;
  sheetName: string | null;
  rows: number;
  guesses: DetectGuess[];
  /** null = "sin identificar": el usuario debe elegir antes de continuar. */
  entity: Entity | null;
  confianza: Confidence | null;
}

interface Outcome {
  key: string;
  entity: Entity;
  status: "hecho" | "omitido" | "error";
  result?: CommitResult;
  errorMsg?: string;
}

interface Props {
  t: TFunction;
  originId: string | null;
  origins: Origin[];
  client?: ImportClientWithDetect;
  onClose: () => void;
  onImported?: () => void;
}

const ENTITY_OPTIONS: Entity[] = DATA_TYPES.map((d) => d.entity);

function entityLabel(t: TFunction, entity: Entity): string {
  const dt = DATA_TYPES.find((d) => d.entity === entity);
  return dt ? t(`shell.importClinic.step3.${dt.labelKey}`) : entity;
}

function confLabel(t: TFunction, c: Confidence | null): string {
  if (c === "alta") return t("shell.importClinic.multi.confHigh");
  if (c === "media") return t("shell.importClinic.multi.confMedium");
  if (c === "baja") return t("shell.importClinic.multi.confLow");
  return "";
}

/** Huella de un mapeo (solo lo mapeado, en orden estable): ¿cambió desde la última vista previa? */
function mappingKeyOf(m: ColumnMapping): string {
  return JSON.stringify(Object.entries(m).filter(([, v]) => v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function MultiImportWizard({ t, originId, origins, client, onClose, onImported }: Props) {
  const fallback = useRef<ImportClientWithDetect>();
  if (!fallback.current) fallback.current = new RealImportClient() as unknown as ImportClientWithDetect;
  const api = client ?? fallback.current;
  const origin = origins.find((o) => o.id === originId) ?? ORIGINS.find((o) => o.id === "otro")!;

  // -- Elegir archivos ---------------------------------------------------------
  const [sub, setSub] = useState<Sub>("elegir");
  const [pending, setPending] = useState<File[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // -- Plan (detección + corrección manual) ------------------------------------
  const [items, setItems] = useState<PlanItem[]>([]);
  const [fileErrors, setFileErrors] = useState<{ fileName: string; error: string }[]>([]);
  const [order, setOrder] = useState<Entity[]>([]);

  // -- Cola (procesamiento secuencial, ya ordenada) ----------------------------
  const [queue, setQueue] = useState<PlanItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [skipDup, setSkipDup] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(true);

  // Estado del ítem ACTUAL de la cola (se resetea al avanzar el cursor).
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<"file" | "server" | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [formatoMontos, setFormatoMontos] = useState("");
  const [montosInfo, setMontosInfo] = useState<{ options: ValueOption[]; example: string; rows: number } | null>(null);
  const [refrescando, setRefrescando] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploadProg, setUploadProg] = useState<UploadProgressState | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const previewReqRef = useRef(0);
  const previewMappingRef = useRef("");
  const autoFiredKeyRef = useRef<string | null>(null);

  const current = queue[cursor] ?? null;
  const unresolvedField = preview?.unresolved?.find((u) => u.field !== "amountFormat")?.field;

  // ---- Elegir archivos ----
  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    const bad = arr.filter((f) => !isAcceptedFile(f));
    const tooBig = arr.filter((f) => isAcceptedFile(f) && f.size > MAX_FILE_MB * 1024 * 1024);
    const okFiles = arr.filter((f) => isAcceptedFile(f) && f.size <= MAX_FILE_MB * 1024 * 1024);
    setPending((prev) => {
      const merged = [...prev, ...okFiles];
      if (merged.length > MAX_BATCH_FILES) {
        setPickError(t("shell.importClinic.multi.tooManyFiles", { n: MAX_BATCH_FILES }));
        return merged.slice(0, MAX_BATCH_FILES);
      }
      return merged;
    });
    if (tooBig.length > 0) setPickError(t("shell.importClinic.multi.fileTooBig", { name: tooBig[0].name, mb: MAX_FILE_MB }));
    else if (bad.length > 0) setPickError(t("shell.importClinic.multi.invalidType", { name: bad[0].name }));
    else setPickError(null);
  }
  function removePending(i: number) {
    setPending((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function analyze() {
    if (pending.length === 0) return;
    const totalMb = pending.reduce((a, f) => a + f.size, 0) / (1024 * 1024);
    if (totalMb > MAX_BATCH_MB) {
      setPickError(`${t("shell.importClinic.multi.tooManyFiles", { n: MAX_BATCH_FILES })} (${totalMb.toFixed(1)} MB > ${MAX_BATCH_MB} MB)`);
      return;
    }
    setAnalyzing(true);
    setPickError(null);
    try {
      const res = await api.detectBatch(pending, originId);
      const planItems: PlanItem[] = res.items.map((it) => ({
        key: `${it.fileIndex}-${it.sheetName ?? ""}`,
        fileIndex: it.fileIndex,
        file: pending[it.fileIndex],
        fileName: it.fileName,
        sheetName: it.sheetName,
        rows: it.rows,
        guesses: it.guesses,
        entity: it.suggestedEntity,
        confianza: it.suggestedConfidence,
      }));
      setItems(planItems);
      setFileErrors(res.errors.map((e) => ({ fileName: e.fileName, error: e.error })));
      setOrder(res.order);
      setSub("plan");
    } catch (e) {
      setPickError(e instanceof Error ? e.message : t("shell.importClinic.multi.errPreviewFile"));
    } finally {
      setAnalyzing(false);
    }
  }

  // ---- Plan: corregir entidad, quitar filas, ordenar ----
  function setItemEntity(key: string, entity: Entity | "") {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, entity: entity || null, confianza: null } : it)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }
  function orderIndex(entity: Entity | null): number {
    if (!entity) return order.length + 1;
    const i = order.indexOf(entity);
    return i === -1 ? order.length : i;
  }
  const sortedItems = [...items].sort((a, b) => orderIndex(a.entity) - orderIndex(b.entity) || a.fileIndex - b.fileIndex);
  const allIdentified = items.length > 0 && items.every((it) => it.entity !== null);

  function startQueue() {
    setQueue(sortedItems);
    setCursor(0);
    setOutcomes([]);
    setSub("cola");
  }

  // ---- Estado del ítem actual ----
  function resetItemState() {
    setMapping({});
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setDecisions({});
    setFormatoMontos("");
    setMontosInfo(null);
    setRefrescando(false);
    setConfirming(false);
    previewMappingRef.current = "";
    previewReqRef.current++;
  }

  function seedDecisions(res: PreviewResult) {
    const field = (res.unresolved ?? []).find((u) => u.field !== "amountFormat")?.field;
    if (field !== "procedure") { setDecisions({}); return; }
    setDecisions((prev) => {
      const next: Record<string, string> = {};
      for (const u of res.unresolved ?? []) {
        if (u.field === "procedure") next[u.key] = prev[u.key] ?? VALUE_UNLINKED;
      }
      return next;
    });
  }
  function recordarMontos(res: PreviewResult) {
    const u = res.unresolved?.find((x) => x.field === "amountFormat");
    const options = res.options?.amountFormat;
    if (u && options?.length) setMontosInfo({ options, example: u.value, rows: u.rows });
  }
  function valueMappingActual(formato: string = formatoMontos): ValueMapping | undefined {
    return formato ? { amountFormat: { formato } } : undefined;
  }

  function loadPreview(item: PlanItem) {
    const reqId = ++previewReqRef.current;
    const stale = () => previewReqRef.current !== reqId;
    setPreviewLoading(true);
    setPreviewError(null);
    api.preview(item.entity as Entity, item.file, undefined, undefined, { origin: originId, sheet: item.sheetName })
      .then((res) => {
        if (stale()) return;
        setPreview(res);
        seedDecisions(res);
        recordarMontos(res);
        const seeded: ColumnMapping = {};
        for (const c of res.columns) seeded[c.source] = c.suggestion ?? "";
        setMapping(seeded);
        previewMappingRef.current = mappingKeyOf(seeded);
      })
      .catch((e) => { if (!stale()) setPreviewError(esErrorTransitorio(e) ? "server" : "file"); })
      .finally(() => { if (!stale()) setPreviewLoading(false); });
  }

  function repreview(item: PlanItem) {
    const reqId = ++previewReqRef.current;
    const stale = () => previewReqRef.current !== reqId;
    setPreviewLoading(true);
    api.preview(item.entity as Entity, item.file, mapping, undefined, { origin: originId, valueMapping: valueMappingActual(), sheet: item.sheetName })
      .then((res) => {
        if (stale()) return;
        setPreview(res);
        seedDecisions(res);
        recordarMontos(res);
        previewMappingRef.current = mappingKeyOf(mapping);
      })
      .catch((e) => { if (!stale()) setPreviewError(esErrorTransitorio(e) ? "server" : "file"); })
      .finally(() => { if (!stale()) setPreviewLoading(false); });
  }

  function elegirFormatoMontos(item: PlanItem, formato: string) {
    setFormatoMontos(formato);
    if (!formato) return;
    const reqId = ++previewReqRef.current;
    const stale = () => previewReqRef.current !== reqId;
    setRefrescando(true);
    api.preview(item.entity as Entity, item.file, mapping, undefined, { origin: originId, valueMapping: valueMappingActual(formato), sheet: item.sheetName })
      .then((res) => { if (!stale()) { setPreview(res); seedDecisions(res); } })
      .finally(() => { if (!stale()) setRefrescando(false); });
  }

  // Al entrar a la cola, o avanzar el cursor: carga el preview del ítem actual.
  useEffect(() => {
    if (sub !== "cola" || !current) return;
    resetItemState();
    loadPreview(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, cursor]);

  function makeUploadHandler(): OnUploadProgress {
    const startedAt = performance.now();
    return ({ loaded, total, pct }) => {
      let eta: number | null = null;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      if (pct < 100 && loaded > 0 && elapsedSec > 0.25) {
        const speed = loaded / elapsedSec;
        if (speed > 0) eta = (total - loaded) / speed;
      }
      setUploadProg({ phase: pct >= 100 ? "processing" : "uploading", pct, eta, label: "" });
    };
  }

  function advance() {
    autoFiredKeyRef.current = null;
    setCursor((c) => {
      if (c + 1 >= queue.length) { setSub("resultado"); return c; }
      return c + 1;
    });
  }

  async function confirmCurrent() {
    if (!current || !preview || confirming) return;
    setConfirming(true);
    try {
      const r = await api.commit(
        current.entity as Entity,
        current.file,
        mapping,
        {
          skipDuplicates: skipDup,
          origin: originId,
          sheet: current.sheetName,
          valueMapping: {
            ...(Object.keys(decisions).length > 0 && unresolvedField ? { [unresolvedField]: decisions } : {}),
            ...(formatoMontos ? { amountFormat: { formato: formatoMontos } } : {}),
          },
        },
        makeUploadHandler(),
      );
      setOutcomes((prev) => [...prev, { key: current.key, entity: current.entity as Entity, status: "hecho", result: r }]);
    } catch (e) {
      setOutcomes((prev) => [
        ...prev,
        { key: current.key, entity: current.entity as Entity, status: "error", errorMsg: e instanceof Error ? e.message : t("shell.importClinic.multi.errImportFile") },
      ]);
    } finally {
      setUploadProg(null);
      setConfirming(false);
      advance();
    }
  }

  function skipCurrent() {
    if (!current) return;
    setOutcomes((prev) => [...prev, { key: current.key, entity: current.entity as Entity, status: "omitido" }]);
    advance();
  }

  // Modo automático: confirma solo cuando el archivo NO necesita atención
  // (sin mapeo pendiente, sin montos ambiguos sin decidir). Nunca se salta la
  // revisión de golpe: cada archivo pasa por su vista previa igual, solo que
  // el clic de confirmar se da solo cuando no hay nada que decidir.
  useEffect(() => {
    if (sub !== "cola" || !autoAdvance || !current || !preview) return;
    if (previewLoading || confirming || refrescando) return;
    if (preview.mappingError) return;
    const montosSinDecidir = preview.unresolved?.some((u) => u.field === "amountFormat");
    if (montosSinDecidir) return;
    if (autoFiredKeyRef.current === current.key) return;
    autoFiredKeyRef.current = current.key;
    confirmCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, autoAdvance, current, preview, previewLoading, confirming, refrescando]);

  function retryCurrentPreview() {
    if (!current) return;
    setPreviewError(null);
    setPreview(null);
    loadPreview(current);
  }

  function startAnother() {
    setSub("elegir");
    setPending([]);
    setPickError(null);
    setItems([]);
    setFileErrors([]);
    setQueue([]);
    setCursor(0);
    setOutcomes([]);
    resetItemState();
  }

  return (
    <div>
      {sub === "elegir" && (
        <>
          <h2 className="imp-title">{t("shell.importClinic.multi.title")}</h2>
          <p className="imp-sub">{t("shell.importClinic.multi.sub")}</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xlsx,.csv"
            hidden
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
          <div
            className="imp-dropzone"
            role="presentation"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
          >
            <span className="imp-dz__ic" aria-hidden><UploadCloud size={28} /></span>
            <h4>{t("shell.importClinic.multi.dropTitle")}</h4>
            <p>{t("shell.importClinic.multi.dropHint")}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
              <button type="button" className="btn-new btn-new--secondary" onClick={() => inputRef.current?.click()} disabled={analyzing}>
                {t("shell.importClinic.multi.chooseFiles")}
              </button>
            </div>
            <p className="imp-dz__formats">{t("shell.importClinic.multi.formats", { mb: MAX_FILE_MB, n: MAX_BATCH_FILES })}</p>
          </div>
          {pending.length > 0 && (
            <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 6 }}>
              {pending.map((f, i) => (
                <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }} className="imp-hint">
                  <span className="mono">{f.name} <span style={{ color: "var(--text-3)" }}>({(f.size / 1024).toFixed(0)} KB)</span></span>
                  <button type="button" className="icon-btn-new" aria-label={t("shell.importClinic.multi.removeFile")} onClick={() => removePending(i)}>
                    <XIcon size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pickError && <div className="imp-inline-msg"><AlertCircle size={17} aria-hidden /> {pickError}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn-new btn-new--secondary" onClick={onClose}>{t("shell.importClinic.back")}</button>
            <button type="button" className="btn-new btn-new--primary" onClick={analyze} disabled={pending.length === 0 || analyzing}>
              {analyzing ? t("shell.importClinic.multi.analyzing") : t("shell.importClinic.multi.analyze")}
            </button>
          </div>
        </>
      )}

      {sub === "plan" && (
        <>
          <h2 className="imp-title">{t("shell.importClinic.multi.planTitle")}</h2>
          <p className="imp-sub">{t("shell.importClinic.multi.planSub")}</p>
          {fileErrors.length > 0 && (
            <div className="imp-callout imp-callout--warn" style={{ marginTop: 10 }}>
              <span className="imp-callout__ic" aria-hidden><AlertCircle size={21} /></span>
              <div className="imp-callout__txt">
                <b>{t("shell.importClinic.multi.fileErrorsTitle")}</b>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {fileErrors.map((e, i) => <li key={i}>{e.fileName}: {e.error}</li>)}
                </ul>
              </div>
            </div>
          )}
          <div className="table-wrap" style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", overflow: "hidden", marginTop: 12 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table-new" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>{t("shell.importClinic.multi.colFile")}</th>
                    <th>{t("shell.importClinic.multi.colSheet")}</th>
                    <th>{t("shell.importClinic.multi.colEntity")}</th>
                    <th>{t("shell.importClinic.multi.colConfidence")}</th>
                    <th>{t("shell.importClinic.multi.colRows")}</th>
                    <th aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((it) => (
                    <tr key={it.key} className={it.entity === null ? "imp-row-err" : it.confianza === "media" ? "imp-row-dup" : ""}>
                      <td className="mono">{it.fileName}</td>
                      <td className="mono">{it.sheetName ?? "—"}</td>
                      <td>
                        <select
                          className="input-new imp-select"
                          value={it.entity ?? ""}
                          onChange={(e) => setItemEntity(it.key, e.target.value as Entity | "")}
                        >
                          <option value="">{t("shell.importClinic.multi.unidentified")}</option>
                          {ENTITY_OPTIONS.map((en) => <option key={en} value={en}>{entityLabel(t, en)}</option>)}
                        </select>
                      </td>
                      <td>{it.entity ? confLabel(t, it.confianza) : "—"}</td>
                      <td className="mono">{it.rows}</td>
                      <td>
                        <button type="button" className="icon-btn-new" aria-label={t("shell.importClinic.multi.removeItem")} onClick={() => removeItem(it.key)}>
                          <XIcon size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="imp-hint" style={{ marginTop: 10 }}>{t("shell.importClinic.multi.orderNote")}</p>
          {!allIdentified && items.length > 0 && (
            <p className="imp-hint" role="alert">{t("shell.importClinic.multi.needEntity")}</p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn-new btn-new--secondary" onClick={() => setSub("elegir")}>{t("shell.importClinic.multi.backToPlan")}</button>
            <button type="button" className="btn-new btn-new--primary" onClick={startQueue} disabled={!allIdentified}>
              {t("shell.importClinic.multi.startImport", { n: items.length })}
            </button>
          </div>
        </>
      )}

      {sub === "cola" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <span className="imp-hint">
              {t("shell.importClinic.multi.queueProgress", { i: cursor + 1, n: queue.length, entity: current ? entityLabel(t, current.entity as Entity) : "" })}
            </span>
            <div className="imp-review-toolbar" style={{ margin: 0 }}>
              <button
                type="button"
                role="switch"
                aria-checked={autoAdvance}
                className={`switch${autoAdvance ? " switch--on" : ""}`}
                onClick={() => setAutoAdvance((v) => !v)}
                aria-label={t("shell.importClinic.multi.autoAdvance")}
              >
                <span className="switch__thumb" />
              </button>
              <span className="imp-switch-lbl">{t("shell.importClinic.multi.autoAdvance")}</span>
            </div>
          </div>

          {!current ? null : previewError ? (
            <div className="imp-error" role="alert">
              <AlertCircle size={40} className="imp-error__ic" aria-hidden />
              <h3 className="imp-error__title">
                {t(previewError === "server" ? "shell.importClinic.step5.errorTitleServer" : "shell.importClinic.step5.errorTitle")}
              </h3>
              <p className="imp-error__desc">
                {t(previewError === "server" ? "shell.importClinic.step5.errorDescServer" : "shell.importClinic.step5.errorDesc")}
              </p>
              <button type="button" className="btn-new btn-new--secondary imp-error__btn" onClick={retryCurrentPreview}>
                <RefreshCw size={14} /> {t("shell.importClinic.multi.retry")}
              </button>
            </div>
          ) : previewLoading || !preview ? (
            <UploadProgress t={t} prog={uploadProg} variant="inline" />
          ) : confirming ? (
            <UploadProgress t={t} prog={uploadProg} variant="inline" />
          ) : preview.mappingError ? (
            <>
              <StepMapping
                t={t}
                origin={origin}
                preview={preview}
                mapping={mapping}
                hasSecondary={false}
                sheet={null}
                onChange={(source, value) => setMapping((m) => ({ ...m, [source]: value }))}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <button type="button" className="btn-new btn-new--primary" onClick={() => repreview(current)} disabled={previewLoading}>
                  {t("shell.importClinic.continue")} <ArrowRight size={14} />
                </button>
              </div>
            </>
          ) : (
            <>
              <StepReview
                t={t}
                entity={current.entity as Entity}
                unverifiedName={origin.hasProfile && origin.verified === false ? origin.name : null}
                amountFormat={montosInfo ? { ...montosInfo, value: formatoMontos, busy: refrescando, onChange: (f) => elegirFormatoMontos(current, f) } : null}
                preview={preview}
                skipDup={skipDup}
                onToggleSkip={() => setSkipDup((v) => !v)}
                decisions={decisions}
                onDecide={(key, id) => setDecisions((d) => ({ ...d, [key]: id }))}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                <button type="button" className="btn-new btn-new--secondary" onClick={skipCurrent} disabled={confirming}>
                  {t("shell.importClinic.multi.skipFile")}
                </button>
                <button
                  type="button"
                  className="btn-new btn-new--primary"
                  onClick={confirmCurrent}
                  disabled={confirming || !!preview.unresolved?.some((u) => u.field === "amountFormat")}
                >
                  {confirming ? t("shell.importClinic.multi.confirming") : t("shell.importClinic.multi.confirmFile")}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {sub === "resultado" && (
        <>
          <h2 className="imp-title">{t("shell.importClinic.multi.resultTitle")}</h2>
          <p className="imp-sub">{t("shell.importClinic.multi.resultSub")}</p>
          <div className="table-wrap" style={{ border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", overflow: "hidden", marginTop: 12 }}>
            <div style={{ overflowX: "auto" }}>
              <table className="table-new" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>{t("shell.importClinic.multi.resultColFile")}</th>
                    <th>{t("shell.importClinic.multi.resultColEntity")}</th>
                    <th>{t("shell.importClinic.multi.resultColCreated")}</th>
                    <th>{t("shell.importClinic.multi.resultColDuplicates")}</th>
                    <th>{t("shell.importClinic.multi.resultColErrors")}</th>
                    <th>{t("shell.importClinic.multi.resultColStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((it) => {
                    const o = outcomes.find((x) => x.key === it.key);
                    return (
                      <tr key={it.key} className={o?.status === "error" ? "imp-row-err" : o?.status === "omitido" ? "imp-row-dup" : ""}>
                        <td className="mono">{it.fileName}{it.sheetName ? ` · ${it.sheetName}` : ""}</td>
                        <td>{entityLabel(t, it.entity as Entity)}</td>
                        <td className="mono">{o?.result?.created ?? "—"}</td>
                        <td className="mono">{o?.result?.duplicates ?? "—"}</td>
                        <td className="mono">{o?.result?.errors ?? "—"}</td>
                        <td>
                          {o?.status === "hecho"
                            ? t("shell.importClinic.multi.statusDone")
                            : o?.status === "omitido"
                              ? t("shell.importClinic.multi.statusSkipped")
                              : o?.status === "error"
                                ? <span title={o.errorMsg}>{t("shell.importClinic.multi.statusError")}</span>
                                : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className="btn-new btn-new--secondary" onClick={startAnother}>{t("shell.importClinic.multi.importAnotherBatch")}</button>
            <button type="button" className="btn-new btn-new--primary" onClick={() => { onImported?.(); onClose(); }}>{t("shell.importClinic.multi.close")}</button>
          </div>
        </>
      )}
    </div>
  );
}
