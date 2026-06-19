"use client";

// ============================================================================
// "Importar mi clínica" — wizard (modal .modal--wide). Máquina de estado de 6
// pasos + desvío a Migración asistida, fiel al prototipo design/import-clinic/.
//
// Recibe un ImportClient por prop (default = MockImportClient). TODO(T4): pasar
// el cliente real para descarga de plantilla, preview/commit y ticket asistidos.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ArrowLeft, ArrowRight, Check } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import {
  type ImportClient,
  type ColumnMapping,
  type PreviewResult,
  type CommitResult,
  type Origin,
  MockImportClient,
  ORIGINS,
  DATA_TYPES,
  isAcceptedFile,
  MAX_FILE_MB,
} from "./import-client";
import { StepOrigin } from "./step-origin";
import { StepExport } from "./step-export";
import { StepWhat } from "./step-what";
import { StepUpload } from "./step-upload";
import { StepMapping } from "./step-mapping";
import { StepReview } from "./step-review";
import { ImportingPanel } from "./importing-panel";
import { ResultPanel } from "./result-panel";
import { AssistedPanel } from "./assisted-panel";

type NumStep = 1 | 2 | 3 | 4 | 5 | 6;
type Step = NumStep | "importing" | "result";
type Flow = "wizard" | "assisted";

const STEP_KEYS = ["origin", "export", "what", "upload", "map", "review"] as const;
const DEFAULT_TYPES = new Set(DATA_TYPES.filter((d) => d.on).map((d) => d.id));

interface Props {
  open: boolean;
  onClose: () => void;
  /** Se llama tras un import exitoso (al ir a "Ver pacientes") para recargar. */
  onImported?: () => void;
  /** Abrir directo en el flujo de migración asistida. */
  startInAssisted?: boolean;
  /** Inyección del cliente de datos. Default: Mock (sin backend). */
  client?: ImportClient;
}

export function ImportWizard({ open, onClose, onImported, startInAssisted = false, client }: Props) {
  const t = useT();
  // El cliente por defecto se crea una sola vez por montaje.
  const fallbackClient = useRef<ImportClient>();
  if (!fallbackClient.current) fallbackClient.current = new MockImportClient();
  const api = client ?? fallbackClient.current;

  const [origins, setOrigins] = useState<Origin[]>(ORIGINS);
  const [flow, setFlow] = useState<Flow>("wizard");
  const [step, setStep] = useState<Step>(1);
  const [originId, setOriginId] = useState<string | null>(null);
  const [types, setTypes] = useState<Set<string>>(new Set(DEFAULT_TYPES));
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [skipDup, setSkipDup] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [pct, setPct] = useState(0);
  const [progLabel, setProgLabel] = useState("");

  // Asistida
  const [assistedFile, setAssistedFile] = useState<File | null>(null);
  const [assistedNote, setAssistedNote] = useState("");
  const [assistedSent, setAssistedSent] = useState(false);
  const [assistedSubmitting, setAssistedSubmitting] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const origin = useMemo(() => origins.find((o) => o.id === originId) ?? null, [origins, originId]);

  function clearTimer() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }

  // Reset al abrir; limpia timers al cerrar/desmontar.
  useEffect(() => {
    if (open) {
      clearTimer();
      setFlow(startInAssisted ? "assisted" : "wizard");
      setStep(1);
      setOriginId(null);
      setTypes(new Set(DEFAULT_TYPES));
      setFile(null);
      setUploadError(null);
      setMapping({});
      setSkipDup(true);
      setPreview(null);
      setPreviewLoading(false);
      setResult(null);
      setPct(0);
      setProgLabel("");
      setAssistedFile(null);
      setAssistedNote("");
      setAssistedSent(false);
      setAssistedSubmitting(false);
      // Refresca el catálogo de orígenes desde el cliente (contrato getOrigins).
      api.getOrigins().then((list) => { if (list?.length) setOrigins(list); }).catch(() => {});
    }
    return clearTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startInAssisted]);

  // Carga el preview al entrar al paso 5 (mapeo) si aún no existe.
  useEffect(() => {
    if (flow !== "wizard" || step !== 5 || !file || preview || previewLoading) return;
    let alive = true;
    setPreviewLoading(true);
    api.preview("patients", file)
      .then((res) => {
        if (!alive) return;
        setPreview(res);
        // Con perfil: sembrar el mapeo desde las sugerencias. Sin perfil: vacío.
        if (origin?.hasProfile) {
          const seeded: ColumnMapping = {};
          for (const c of res.columns) seeded[c.source] = c.suggestion ?? "";
          setMapping(seeded);
        } else {
          setMapping({});
        }
      })
      .catch(() => { if (alive) toast.error(t("shell.importClinic.errPreview")); })
      .finally(() => { if (alive) setPreviewLoading(false); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, step, file, preview, previewLoading, origin]);

  // ---- Archivo (paso 4) ----
  function handleFile(f: File) {
    if (!isAcceptedFile(f)) {
      setFile(null);
      setUploadError(t("shell.importClinic.step4.invalidType", { name: f.name }));
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setFile(null);
      setUploadError(t("shell.importClinic.step4.invalidSize", { name: f.name, mb: MAX_FILE_MB }));
      return;
    }
    setUploadError(null);
    setFile(f);
    // Un archivo nuevo invalida el preview/mapeo previos.
    setPreview(null);
    setMapping({});
  }
  function removeFile() {
    setFile(null);
    setUploadError(null);
    setPreview(null);
    setMapping({});
  }

  // ---- Importar (commit + progreso simulado) ----
  async function runImport() {
    setStep("importing");
    setPct(0);
    setProgLabel(t("shell.importClinic.importing.prep"));
    let res: CommitResult;
    try {
      res = await api.commit("patients", file as File, mapping, { skipDuplicates: skipDup });
    } catch {
      toast.error(t("shell.importClinic.errImport"));
      setStep(6);
      return;
    }
    setResult(res);
    const labels: [number, string][] = [
      [15, t("shell.importClinic.importing.validating")],
      [45, t("shell.importClinic.importing.balances")],
      [75, t("shell.importClinic.importing.scheduling")],
      [100, t("shell.importClinic.importing.finishing")],
    ];
    let p = 0;
    clearTimer();
    intervalRef.current = setInterval(() => {
      p += Math.random() * 14 + 6;
      if (p >= 100) {
        p = 100;
        clearTimer();
        setPct(100);
        setProgLabel(labels[labels.length - 1][1]);
        setTimeout(() => setStep("result"), 420);
        return;
      }
      setPct(p);
      const lbl = labels.find(([thr]) => p <= thr);
      if (lbl) setProgLabel(lbl[1]);
    }, 360);
  }

  // ---- Asistida ----
  function openAssisted() {
    setFlow("assisted");
    setAssistedFile(null);
    setAssistedNote("");
    setAssistedSent(false);
  }
  async function submitAssisted() {
    if (!assistedFile || assistedSubmitting) return;
    setAssistedSubmitting(true);
    try {
      const res = await api.submitAssisted(assistedFile, assistedNote);
      if (res.ok) setAssistedSent(true);
      else toast.error(t("shell.importClinic.errAssisted"));
    } catch {
      toast.error(t("shell.importClinic.errAssisted"));
    } finally {
      setAssistedSubmitting(false);
    }
  }

  function toggleType(id: string) {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function startWizard() {
    clearTimer();
    setFlow("wizard");
    setStep(1);
    setOriginId(null);
    setTypes(new Set(DEFAULT_TYPES));
    setFile(null);
    setUploadError(null);
    setMapping({});
    setSkipDup(true);
    setPreview(null);
    setResult(null);
    setPct(0);
  }

  // ---- Navegación ----
  function goNext() {
    if (flow === "assisted") { submitAssisted(); return; }
    if (step === 6) { runImport(); return; }
    if (typeof step === "number" && step < 6) setStep((step + 1) as NumStep);
  }
  function goBack() {
    if (flow === "assisted") { setFlow("wizard"); setStep(1); return; }
    if (typeof step === "number" && step > 1) setStep((step - 1) as NumStep);
  }

  const isNumeric = typeof step === "number";
  const showStepbar = flow === "wizard" && isNumeric;
  const showFooter =
    (flow === "wizard" && isNumeric) || (flow === "assisted" && !assistedSent);

  // Validaciones de avance + etiqueta/hint del botón Continuar.
  let nextDisabled = false;
  let nextLabel = t("shell.importClinic.continue");
  let hint = "";
  if (flow === "assisted") {
    nextLabel = assistedSubmitting ? t("shell.importClinic.sending") : t("shell.importClinic.assisted.send");
    nextDisabled = !assistedFile || assistedSubmitting;
    if (!assistedFile) hint = t("shell.importClinic.assisted.needFile");
  } else if (step === 1) {
    nextDisabled = !originId;
    if (!originId) hint = t("shell.importClinic.step1.needOrigin");
  } else if (step === 3) {
    nextDisabled = types.size === 0;
    if (types.size === 0) hint = t("shell.importClinic.step3.needOne");
  } else if (step === 4) {
    nextDisabled = !file;
    if (!file) hint = t("shell.importClinic.step4.needFile");
  } else if (step === 6) {
    const n = preview ? (skipDup ? preview.stats.valid : preview.stats.valid + preview.stats.duplicates) : 0;
    nextLabel = t("shell.importClinic.step6.importBtn", { count: n });
  }

  const headerSub =
    flow === "assisted"
      ? t("shell.importClinic.subAssisted")
      : isNumeric
        ? t("shell.importClinic.subStep", { step })
        : "";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ position: "fixed", inset: 0, background: "rgba(15,10,30,0.55)", backdropFilter: "blur(4px)", zIndex: 90 }}
        />
        <Dialog.Content
          className="modal modal--wide"
          aria-describedby={undefined}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 91,
            width: "min(920px, 100%)",
            maxWidth: "min(920px, 100%)",
            maxHeight: "92vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            padding: 0,
          }}
        >
          {/* Header */}
          <div className="modal__header" style={{ flexShrink: 0 }}>
            <div>
              <Dialog.Title className="modal__title">{t("shell.importClinic.headerTitle")}</Dialog.Title>
              {headerSub && <div className="imp-head__sub">{headerSub}</div>}
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-btn-new" aria-label={t("shell.importClinic.closeWizard")}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {/* Step bar */}
          {showStepbar && (
            <nav className="imp-stepbar" aria-label={t("shell.importClinic.stepsAria")} style={{ flexShrink: 0 }}>
              {STEP_KEYS.map((key, i) => {
                const n = i + 1;
                const done = isNumeric && n < (step as number);
                const current = isNumeric && n === (step as number);
                return (
                  <div key={key} style={{ display: "contents" }}>
                    <div className={`imp-step${done ? " is-done" : ""}${current ? " is-current" : ""}`}>
                      <span className="imp-step__num">{done ? <Check size={14} /> : n}</span>
                      <span className="imp-step__lbl">{t(`shell.importClinic.steps.${key}`)}</span>
                    </div>
                    {i < STEP_KEYS.length - 1 && <span className="imp-step__line" aria-hidden />}
                  </div>
                );
              })}
            </nav>
          )}

          {/* Body */}
          <div className="modal__body imp-body" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <div className="imp-panel" key={`${flow}-${String(step)}-${assistedSent}`}>
              {flow === "assisted" ? (
                <AssistedPanel
                  t={t}
                  file={assistedFile}
                  note={assistedNote}
                  sent={assistedSent}
                  onFile={setAssistedFile}
                  onRemove={() => setAssistedFile(null)}
                  onNote={setAssistedNote}
                  onDone={onClose}
                />
              ) : step === "importing" ? (
                <ImportingPanel t={t} pct={pct} label={progLabel} />
              ) : step === "result" && result ? (
                <ResultPanel
                  t={t}
                  result={result}
                  onGoPatients={() => { onImported?.(); onClose(); }}
                  onImportAnother={startWizard}
                  onDownloadReport={() => {
                    if (result.errorReportUrl) window.open(result.errorReportUrl, "_blank", "noopener");
                    else toast(t("shell.importClinic.result.reportSoon")); // TODO(T4): reporte real
                  }}
                />
              ) : step === 1 ? (
                <StepOrigin t={t} origins={origins} selected={originId} onSelect={setOriginId} onAssisted={openAssisted} />
              ) : step === 2 && origin ? (
                <StepExport t={t} origin={origin} templateUrl={api.templateUrl()} />
              ) : step === 3 ? (
                <StepWhat t={t} selected={types} onToggle={toggleType} />
              ) : step === 4 ? (
                <StepUpload t={t} file={file} error={uploadError} onFile={handleFile} onRemove={removeFile} />
              ) : step === 5 ? (
                previewLoading || !preview ? (
                  <div className="imp-loading">
                    <span className="imp-spin-sm" aria-hidden /> {t("shell.importClinic.step5.loading")}
                  </div>
                ) : origin ? (
                  <StepMapping
                    t={t}
                    origin={origin}
                    preview={preview}
                    mapping={mapping}
                    onChange={(source, value) => setMapping((m) => ({ ...m, [source]: value }))}
                  />
                ) : null
              ) : step === 6 && preview ? (
                <StepReview t={t} preview={preview} skipDup={skipDup} onToggleSkip={() => setSkipDup((v) => !v)} />
              ) : null}
            </div>
          </div>

          {/* Footer */}
          {showFooter && (
            <div className="modal__footer imp-foot" style={{ flexShrink: 0 }}>
              {(flow === "assisted" || (isNumeric && step > 1)) ? (
                <button type="button" className="btn-new btn-new--secondary" onClick={goBack}>
                  <ArrowLeft size={14} /> {t("shell.importClinic.back")}
                </button>
              ) : <span className="imp-foot__gap" />}
              <span className="imp-hint">{hint}</span>
              <button type="button" className="btn-new btn-new--primary" onClick={goNext} disabled={nextDisabled}>
                {nextLabel} <ArrowRight size={14} />
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
