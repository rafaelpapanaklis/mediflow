"use client";
// Endodontics — entrada del módulo: panel izquierdo + vista diente-céntrica. Spec §6.2

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { ToothMiniOdontogram } from "./ToothMiniOdontogram";
import { ToothCenterView } from "./ToothCenterView";
import type { EndoToothSummary, ToothCenterViewData } from "@/lib/types/endodontics";

export interface EndodonticsTabProps {
  patientId: string;
  patientName: string;
  summaries: EndoToothSummary[];
  initialTooth?: ToothCenterViewData | null;
  onLoadTooth?: (fdi: number) => Promise<ToothCenterViewData | null>;
}

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

  const selectTooth = useCallback(
    (fdi: number) => {
      setSelectedFdi(fdi);
      const sp = new URLSearchParams(params.toString());
      sp.set("tooth", String(fdi));
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [params, router],
  );

  // Cuando cambia la selección, recarga datos del diente.
  useEffect(() => {
    if (!selectedFdi) {
      setCenterData(null);
      return;
    }
    if (centerData?.toothFdi === selectedFdi) return;
    if (!onLoadTooth) return;
    let cancelled = false;
    setLoading(true);
    onLoadTooth(selectedFdi)
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
  }, [selectedFdi, onLoadTooth, centerData?.toothFdi]);

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
              // implementado en C14 (TreatmentWizard).
              toast("Wizard de TC pendiente — fase 5.");
            }}
            onContinueTreatment={() => {
              toast("Wizard de TC pendiente — fase 5.");
            }}
            onCaptureDiagnosis={() => toast("Drawer en C13.")}
            onCaptureVitality={() => toast("Drawer en C13.")}
            onClickCanal={() => toast("Drawer de conducto en C13.")}
            onClickTimelineEvent={() => toast("Detalle de evento en C13.")}
          />
        ) : (
          <div className="endo-empty">
            <p>Sin historial para el diente {selectedFdi}.</p>
          </div>
        )}
      </main>
    </div>
  );
}
