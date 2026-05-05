"use client";
// Endodontics — entrada del módulo: panel izquierdo + vista diente-céntrica
// + drawers/wizard que reaccionan a las acciones del panel central. Spec §6.2

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ToothMiniOdontogram } from "./ToothMiniOdontogram";
import { ToothCenterView } from "./ToothCenterView";
import { DiagnosisDrawer } from "./drawers/DiagnosisDrawer";
import { VitalityDrawer } from "./drawers/VitalityDrawer";
import { RootCanalDrawer } from "./drawers/RootCanalDrawer";
import { FollowUpDrawer } from "./drawers/FollowUpDrawer";
import { ApicalSurgeryDrawer } from "./drawers/ApicalSurgeryDrawer";
import { TreatmentWizard } from "./TreatmentWizard";
import { StartTreatmentModal } from "./modals/StartTreatmentModal";
import { loadToothAction } from "@/app/actions/endodontics/loadToothAction";
import type { EndoToothSummary, ToothCenterViewData } from "@/lib/types/endodontics";

export interface EndodonticsTabProps {
  patientId: string;
  patientName: string;
  summaries: EndoToothSummary[];
  initialTooth?: ToothCenterViewData | null;
  /**
   * Override opcional para tests/storybook. Si no se pasa, se usa
   * el server action `loadToothAction(patientId, fdi)`.
   */
  onLoadTooth?: (fdi: number) => Promise<ToothCenterViewData | null>;
}

type DrawerKind =
  | { kind: "none" }
  | { kind: "diagnosis" }
  | { kind: "vitality" }
  | { kind: "canal"; canalId: string | null }
  | { kind: "followup"; followUpId: string; milestoneLabel: string }
  | { kind: "apical-surgery" };

export function EndodonticsTab(props: EndodonticsTabProps) {
  const { patientId, patientName, summaries, initialTooth, onLoadTooth } = props;
  const router = useRouter();
  const params = useSearchParams();

  const initialFdi = (() => {
    const raw = params.get("tooth");
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : initialTooth?.toothFdi ?? null;
  })();

  const [selectedFdi, setSelectedFdi] = useState<number | null>(initialFdi);
  const [centerData, setCenterData] = useState<ToothCenterViewData | null>(initialTooth ?? null);
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind>({ kind: "none" });
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [wizardTreatmentId, setWizardTreatmentId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const selectTooth = useCallback(
    (fdi: number) => {
      setSelectedFdi(fdi);
      const sp = new URLSearchParams(params.toString());
      sp.set("tooth", String(fdi));
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  const refresh = useCallback(() => {
    setReloadKey((k) => k + 1);
    router.refresh();
  }, [router]);

  // Cuando llega un initialTooth nuevo (router.refresh tras un write),
  // sincronízalo si coincide con el diente seleccionado.
  useEffect(() => {
    if (initialTooth && initialTooth.toothFdi === selectedFdi) {
      setCenterData(initialTooth);
    }
  }, [initialTooth, selectedFdi]);

  // Cuando cambia la selección o reloadKey, recarga datos del diente.
  // Por defecto usa el server action `loadToothAction`; el test puede
  // pasar un override via `onLoadTooth` prop.
  useEffect(() => {
    if (!selectedFdi) {
      setCenterData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const loader = onLoadTooth
      ? onLoadTooth(selectedFdi)
      : loadToothAction(patientId, selectedFdi);
    loader
      .then((data) => {
        if (cancelled) return;
        setCenterData(data);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("No se pudo cargar el historial del diente");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFdi, onLoadTooth, patientId, reloadKey]);

  const closeDrawer = useCallback(() => {
    setDrawer({ kind: "none" });
    refresh();
  }, [refresh]);

  const activeTreatment = centerData?.activeTreatment ?? null;
  const canalInitial =
    drawer.kind === "canal" && drawer.canalId
      ? activeTreatment?.rootCanals.find((c) => c.id === drawer.canalId)
      : undefined;

  return (
    <div className="endo-shell">
      <ToothMiniOdontogram
        summaries={summaries}
        selectedFdi={selectedFdi}
        onSelect={selectTooth}
      />

      <main className="endo-main" aria-live="polite">
        {!selectedFdi ? (
          <div className="endo-empty">
            <h2>Selecciona un diente</h2>
            <p>
              Haz clic en cualquier diente del odontograma para ver el historial
              endodóntico de {patientName}.
            </p>
          </div>
        ) : loading ? (
          <div className="endo-empty">
            <p>Cargando historial del diente {selectedFdi}…</p>
          </div>
        ) : centerData ? (
          <ToothCenterView
            data={centerData}
            onStartTreatment={() => {
              if (activeTreatment) {
                toast(
                  "Ya existe un tratamiento activo en este diente. Continúa el actual o ciérralo antes de iniciar otro.",
                );
                return;
              }
              setStartModalOpen(true);
            }}
            onContinueTreatment={(treatmentId) => setWizardTreatmentId(treatmentId)}
            onCaptureDiagnosis={() => setDrawer({ kind: "diagnosis" })}
            onCaptureVitality={() => setDrawer({ kind: "vitality" })}
            onClickCanal={(canalId) => setDrawer({ kind: "canal", canalId })}
            onClickTimelineEvent={(id, kind) => {
              if (kind === "followup") {
                const fu = activeTreatment?.followUps.find((f) => f.id === id);
                if (!fu) {
                  toast("Control no disponible.");
                  return;
                }
                if (fu.performedAt) {
                  toast(
                    `Control ya cerrado el ${new Date(fu.performedAt).toLocaleDateString("es-MX")} (PAI ${fu.paiScore ?? "—"}).`,
                  );
                  return;
                }
                setDrawer({
                  kind: "followup",
                  followUpId: fu.id,
                  milestoneLabel: fu.milestone.replaceAll("_", " ").toLowerCase(),
                });
                return;
              }
              if (kind === "treatment-apical") {
                if (!activeTreatment) return;
                if (activeTreatment.apicalSurgery) {
                  toast("Cirugía apical ya registrada.");
                  return;
                }
                setDrawer({ kind: "apical-surgery" });
                return;
              }
              // Otros tipos (diagnosis, vitality, treatment-start, medication, restoration)
              // son informativos por ahora — sin drawer dedicado.
            }}
          />
        ) : (
          <div className="endo-empty">
            <p>Sin historial para el diente {selectedFdi}.</p>
          </div>
        )}
      </main>

      {selectedFdi ? (
        <>
          <DiagnosisDrawer
            open={drawer.kind === "diagnosis"}
            onClose={closeDrawer}
            patientId={patientId}
            toothFdi={selectedFdi}
          />
          <VitalityDrawer
            open={drawer.kind === "vitality"}
            onClose={closeDrawer}
            patientId={patientId}
            toothFdi={selectedFdi}
          />
          {activeTreatment ? (
            <RootCanalDrawer
              open={drawer.kind === "canal"}
              onClose={closeDrawer}
              treatmentId={activeTreatment.id}
              initial={
                canalInitial
                  ? {
                      id: canalInitial.id,
                      canonicalName: canalInitial.canonicalName,
                      workingLengthMm: Number(canalInitial.workingLengthMm),
                      coronalReferencePoint: canalInitial.coronalReferencePoint,
                      masterApicalFileIso: canalInitial.masterApicalFileIso,
                      masterApicalFileTaper: Number(canalInitial.masterApicalFileTaper),
                      obturationQuality: canalInitial.obturationQuality,
                      notes: canalInitial.notes,
                    }
                  : undefined
              }
            />
          ) : null}
          {activeTreatment ? (
            <ApicalSurgeryDrawer
              open={drawer.kind === "apical-surgery"}
              onClose={closeDrawer}
              treatmentId={activeTreatment.id}
            />
          ) : null}
          {drawer.kind === "followup" ? (
            <FollowUpDrawer
              open={true}
              onClose={closeDrawer}
              followUpId={drawer.followUpId}
              milestoneLabel={drawer.milestoneLabel}
            />
          ) : null}

          <StartTreatmentModal
            open={startModalOpen}
            onClose={() => setStartModalOpen(false)}
            patientId={patientId}
            toothFdi={selectedFdi}
            diagnosisId={centerData?.diagnosis?.id ?? null}
            onCreated={(id) => {
              refresh();
              setWizardTreatmentId(id);
            }}
          />
          {wizardTreatmentId ? (
            <TreatmentWizard
              open={true}
              onClose={() => {
                setWizardTreatmentId(null);
                refresh();
              }}
              treatmentId={wizardTreatmentId}
              toothFdi={selectedFdi}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
