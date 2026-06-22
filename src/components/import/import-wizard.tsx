"use client";

// ============================================================================
// "Importar mi clínica" — wizard (modal .modal--wide). Máquina de estado de 6
// pasos + desvío a Migración asistida, fiel al prototipo design/import-clinic/.
//
// Recibe un ImportClient por prop; por defecto usa el cliente REAL
// (RealImportClient, WS2-T4) que habla con /api/import/* (plantilla, preview/
// commit por entidad, migración asistida). Se puede inyectar un mock en tests.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ArrowLeft, ArrowRight, Check, AlertCircle, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import {
  type ImportClient,
  type Entity,
  type ColumnMapping,
  type PreviewResult,
  type CommitResult,
  type Origin,
  type OnUploadProgress,
  ORIGINS,
  DATA_TYPES,
  isAcceptedFile,
  MAX_FILE_MB,
} from "./import-client";
import { RealImportClient } from "@/lib/import/client";
import { StepOrigin } from "./step-origin";
import { StepExport } from "./step-export";
import { StepWhat } from "./step-what";
import { StepUpload } from "./step-upload";
import { StepMapping } from "./step-mapping";
import { StepReview } from "./step-review";
import { ImportingPanel } from "./importing-panel";
import { UploadProgress, type UploadProgressState } from "./upload-progress";
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
  /** Inyección del cliente de datos. Default: RealImportClient (APIs reales). */
  client?: ImportClient;
}

export function ImportWizard({ open, onClose, onImported, startInAssisted = false, client }: Props) {
  const t = useT();
  // El cliente por defecto (real) se crea una sola vez por montaje.
  const fallbackClient = useRef<ImportClient>();
  if (!fallbackClient.current) fallbackClient.current = new RealImportClient();
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
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  // Progreso REAL de la subida (vista previa del paso 5 + commit). null = inactivo.
  const [uploadProg, setUploadProg] = useState<UploadProgressState | null>(null);

  // Asistida
  const [assistedFile, setAssistedFile] = useState<File | null>(null);
  const [assistedNote, setAssistedNote] = useState("");
  const [assistedSent, setAssistedSent] = useState(false);
  const [assistedSubmitting, setAssistedSubmitting] = useState(false);

  const origin = useMemo(() => origins.find((o) => o.id === originId) ?? null, [origins, originId]);

  // Entidades elegidas en el paso 3, en ORDEN de prioridad (el orden de DATA_TYPES
  // ya es pacientes → saldos → citas). La PRINCIPAL es la primera: define los campos
  // del mapeo (paso 5) y el preview de revisión (paso 6). Antes el paso 5/6 asumían
  // SIEMPRE "patients", así que al importar solo saldos/citas el dropdown ofrecía
  // campos de paciente y la revisión salía en 0/duplicados.
  const selectedEntities = useMemo<Entity[]>(
    () => DATA_TYPES.filter((d) => d.entity && types.has(d.id)).map((d) => d.entity as Entity),
    [types],
  );
  const principalEntity: Entity = selectedEntities[0] ?? "patients";

  // Token de la petición de preview EN VUELO: solo la MÁS RECIENTE aplica su
  // resultado/loading. Atado a la PETICIÓN (archivo/montaje), NO al ciclo del
  // efecto — reemplaza el viejo flag `alive` que el re-run del efecto (por tener
  // `previewLoading` en las deps) ponía en false y descartaba la respuesta 200.
  const previewReqRef = useRef(0);
  // Invalida cualquier preview en vuelo al desmontar (evita setState tardío).
  useEffect(() => () => { previewReqRef.current++; }, []);

  // Construye un callback de progreso que calcula la ETA: velocidad =
  // bytes_subidos / segundos_transcurridos → ETA = bytes_restantes / velocidad.
  // Captura el inicio al CREARSE (justo antes de lanzar la subida); cada entidad
  // del commit usa uno nuevo para medir su propia subida por separado.
  function makeUploadHandler(label: string): OnUploadProgress {
    const startedAt = performance.now();
    return ({ loaded, total, pct }) => {
      let eta: number | null = null;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      if (pct < 100 && loaded > 0 && elapsedSec > 0.25) {
        const speed = loaded / elapsedSec; // bytes/s
        if (speed > 0) eta = (total - loaded) / speed;
      }
      setUploadProg({ phase: pct >= 100 ? "processing" : "uploading", pct, eta, label });
    };
  }

  // Contexto del commit multi-entidad: "Pacientes · 1 de 3" (solo si hay >1).
  function entityLabel(ent: Entity, i: number, n: number): string {
    if (n <= 1) return "";
    return t("shell.importClinic.importing.step", {
      entity: t(`shell.importClinic.importing.ent.${ent}`),
      i: i + 1,
      n,
    });
  }

  // Reset al abrir.
  useEffect(() => {
    if (open) {
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
      setPreviewError(null);
      previewReqRef.current++;
      setResult(null);
      setUploadProg(null);
      setAssistedFile(null);
      setAssistedNote("");
      setAssistedSent(false);
      setAssistedSubmitting(false);
      // Refresca el catálogo de orígenes desde el cliente (contrato getOrigins).
      api.getOrigins().then((list) => { if (list?.length) setOrigins(list); }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startInAssisted]);

  // Carga la vista previa (dry-run) del paso 5. Extraída a función para poder
  // REINTENTAR desde el estado de error. La staleness se controla con un TOKEN
  // (previewReqRef) atado a la PETICIÓN: solo la última aplica su resultado y
  // SIEMPRE apaga el loading. (Antes, el efecto tenía `previewLoading` en sus
  // deps → al setearlo se re-corría, su cleanup ponía alive=false y el `.then`
  // hacía `if(!alive) return`, descartando la respuesta 200 → spinner eterno.)
  function loadPreview() {
    if (!file) return;
    const f = file;
    const reqId = ++previewReqRef.current;
    const stale = () => previewReqRef.current !== reqId;
    setPreviewError(null);
    setPreviewLoading(true);
    setUploadProg({ phase: "uploading", pct: 0, eta: null, label: "" });
    const onProg = makeUploadHandler("");
    api.preview(principalEntity, f, undefined, (p) => { if (!stale()) onProg(p); })
      .then((res) => {
        if (stale()) return;
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
      .catch(() => { if (!stale()) setPreviewError(t("shell.importClinic.step5.errorTitle")); })
      .finally(() => { if (!stale()) { setPreviewLoading(false); setUploadProg(null); } });
  }

  // Reintento manual desde el estado de error (botón "Reintentar").
  function retryPreview() {
    setPreviewError(null);
    setPreview(null);
    loadPreview();
  }

  // Si cambia la entidad PRINCIPAL (porque el usuario volvió al paso 3 y ajustó la
  // selección), invalida el preview/mapeo en vuelo: el paso 5 lo recargará con los
  // campos de la nueva entidad y el paso 6 mostrará su preview. Mismo saneo que al
  // cambiar de archivo; evita arrastrar un mapeo de paciente a un commit de saldos.
  const principalRef = useRef(principalEntity);
  useEffect(() => {
    if (principalRef.current === principalEntity) return;
    principalRef.current = principalEntity;
    setPreview(null);
    setMapping({});
    setPreviewError(null);
    setPreviewLoading(false);
    previewReqRef.current++;
  }, [principalEntity]);

  // Dispara la carga al entrar al paso 5 si aún no hay preview (ni error mostrado).
  // `previewLoading`/`previewError` NO van en las deps a propósito: son estados que
  // el propio efecto/loadPreview setean; tenerlos como deps re-corría el efecto y
  // rompía la petición. La re-entrada se evita con la guarda (`preview`/`previewError`)
  // y los lanzamientos concurrentes se resuelven por token (gana el último).
  useEffect(() => {
    if (flow !== "wizard" || step !== 5 || !file || preview || previewError) return;
    loadPreview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, step, file, preview, origin]);

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
    // Un archivo nuevo invalida preview/mapeo/estado y cualquier petición en vuelo.
    setPreview(null);
    setMapping({});
    setPreviewError(null);
    setPreviewLoading(false);
    previewReqRef.current++;
  }
  function removeFile() {
    setFile(null);
    setUploadError(null);
    setPreview(null);
    setMapping({});
    setPreviewError(null);
    setPreviewLoading(false);
    previewReqRef.current++;
  }

  // ---- Importar (commit multi-entidad + progreso) ----
  // Importa, EN ORDEN, las entidades elegidas en el paso 3 (pacientes → saldos →
  // citas) desde el MISMO archivo. Pacientes va primero para que saldos/citas
  // resuelvan al paciente recién creado. La entidad PRINCIPAL (la primera elegida)
  // usa el mapeo del paso 5; las demás se autodetectan en el backend. El resumen se
  // acumula por entidad. La barra "crece" mientras corre el trabajo real y se
  // completa solo al terminar (no se simula el éxito).
  async function runImport() {
    if (!file) return;
    const f = file;
    const toRun: Entity[] = selectedEntities.length ? selectedEntities : ["patients"];
    const n = toRun.length;

    setStep("importing");
    setUploadProg({ phase: "uploading", pct: 0, eta: null, label: entityLabel(toRun[0], 0, n) });

    const agg: CommitResult = {
      created: 0,
      errors: 0,
      duplicates: 0,
      summary: { patients: 0, balances: "—", appointments: 0 },
      errorReportUrl: undefined,
    };
    let committedAny = false;

    // Cada entidad vuelve a SUBIR el MISMO archivo (pacientes primero, para que
    // saldos/citas resuelvan al paciente recién creado). Medimos la subida real de
    // cada una por separado: barra + ETA mientras sube, "Procesando…" al 100%.
    for (let i = 0; i < toRun.length; i++) {
      const ent = toRun[i];
      const label = entityLabel(ent, i, n);
      setUploadProg({ phase: "uploading", pct: 0, eta: null, label });
      const onProg = makeUploadHandler(label);
      try {
        const r = await api.commit(
          ent,
          f,
          ent === principalEntity ? mapping : {},
          { skipDuplicates: skipDup },
          onProg,
        );
        committedAny = true;
        agg.created += r.created;
        agg.errors += r.errors;
        agg.duplicates += r.duplicates;
        if (r.errorReportUrl) agg.errorReportUrl = r.errorReportUrl;
        if (ent === "patients") agg.summary.patients = r.created;
        else if (ent === "balances") agg.summary.balances = r.created.toLocaleString();
        else if (ent === "appointments") agg.summary.appointments = r.created;
      } catch (e) {
        // Falla la PRIMERA entidad sin nada importado → abortar y volver a revisar.
        // Falla una entidad secundaria (p. ej. el archivo no trae columnas de saldo
        // o cita) → se omite y se continúa con el resto.
        if (!committedAny) {
          toast.error(e instanceof Error ? e.message : t("shell.importClinic.errImport"));
          setUploadProg(null);
          setStep(6);
          return;
        }
      }
    }

    setResult(agg);
    setUploadProg(null);
    setStep("result");
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
    setFlow("wizard");
    setStep(1);
    setOriginId(null);
    setTypes(new Set(DEFAULT_TYPES));
    setFile(null);
    setUploadError(null);
    setMapping({});
    setSkipDup(true);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    previewReqRef.current++;
    setResult(null);
    setUploadProg(null);
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
                <ImportingPanel t={t} prog={uploadProg} />
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
                previewError ? (
                  <div className="imp-error" role="alert">
                    <AlertCircle size={40} className="imp-error__ic" aria-hidden />
                    <h3 className="imp-error__title">{t("shell.importClinic.step5.errorTitle")}</h3>
                    <p className="imp-error__desc">{t("shell.importClinic.step5.errorDesc")}</p>
                    <button type="button" className="btn-new btn-new--secondary imp-error__btn" onClick={retryPreview}>
                      <RefreshCw size={14} /> {t("shell.importClinic.step5.retry")}
                    </button>
                  </div>
                ) : previewLoading || !preview ? (
                  <UploadProgress t={t} prog={uploadProg} variant="inline" />
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
