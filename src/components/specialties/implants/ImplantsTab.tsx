"use client";
// Implants — entrada del módulo en el detalle del paciente. Spec §6.
// Combina los 3 sub-tabs + maneja el state de los wizards / drawers /
// modales que disparan las acciones rápidas de cada ImplantCard.
//
// MOBILE FALLBACK: Si viewport < 1024px, renderiza banner read-only
// y bloquea handlers de captura (Spec §1.17).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Anchor, MonitorSmartphone } from "lucide-react";
import { ImplantsSubTabs } from "./ImplantsSubTabs";
import { ImplantsListTab } from "./ImplantsListTab";
import { NewImplantModal } from "./modals/NewImplantModal";
import { RemoveImplantModal } from "./modals/RemoveImplantModal";
import { BrandUpdateJustificationModal } from "./modals/BrandUpdateJustificationModal";
import { ComplicationDrawer } from "./drawers/ComplicationDrawer";
import { MaintenanceDrawer } from "./drawers/MaintenanceDrawer";
import { SecondStageDrawer } from "./drawers/SecondStageDrawer";
import { SurgeryConsentModal } from "./modals/SurgeryConsentModal";
import { SurgeryWizard } from "./wizards/SurgeryWizard";
import { ProstheticWizard } from "./wizards/ProstheticWizard";
import type { ImplantFull } from "@/lib/types/implants";
import type { ImplantActionType } from "./ImplantActions";
import type { TimelineMilestone as MilestoneKey } from "@/lib/implants/implant-helpers";

type DialogKey =
  | null
  | "newImplant"
  | "surgery"
  | "prosthetic"
  | "complication"
  | "maintenance"
  | "secondStage"
  | "consent"
  | "remove"
  | "traceability";

export interface ImplantsTabProps {
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  doctorCedula: string | null;
  implants: ImplantFull[];
  onMilestoneClick?: (milestone: MilestoneKey, implantId: string) => void;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

function MobileReadOnlyBanner() {
  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 flex items-start gap-3">
      <MonitorSmartphone className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium text-amber-900 dark:text-amber-200">Modo solo lectura</p>
        <p className="text-amber-800 dark:text-amber-300 mt-1">
          Para captura de cirugía o fase protésica abre desde tablet o
          escritorio. Aquí puedes consultar las tarjetas, el carnet PDF y
          las visitas previas.
        </p>
      </div>
    </div>
  );
}

export function ImplantsTab(props: ImplantsTabProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [dialog, setDialog] = useState<DialogKey>(null);
  const [activeImplantId, setActiveImplantId] = useState<string | null>(null);

  const close = () => { setDialog(null); setActiveImplantId(null); };
  const refresh = () => router.refresh();

  const activeImplant = useMemo(
    () => (activeImplantId ? props.implants.find((i) => i.id === activeImplantId) ?? null : null),
    [props.implants, activeImplantId],
  );

  const handleAction = (action: ImplantActionType, implantId: string) => {
    if (isMobile) return;
    setActiveImplantId(implantId);
    switch (action) {
      case "remove":
        setDialog("remove");
        return;
      case "traceability":
        setDialog("traceability");
        return;
      case "complication":
        setDialog("complication");
        return;
      case "passport":
        window.open(`/api/implants/${implantId}/passport`, "_blank", "noopener,noreferrer");
        return;
      case "maintenance":
        setDialog("maintenance");
        return;
      case "consent":
        setDialog("consent");
        return;
      case "radiographs":
        toast(`"${action}" — disponible en la siguiente fase`);
        return;
    }
  };

  const handleMilestone = (m: MilestoneKey, implantId: string) => {
    if (isMobile) return;
    setActiveImplantId(implantId);
    if (m === "SURGERY") setDialog("surgery");
    else if (m === "PROSTHETIC") setDialog("prosthetic");
    else if (m === "SECOND_STAGE") setDialog("secondStage");
    else props.onMilestoneClick?.(m, implantId);
  };

  const handleNew = () => {
    if (isMobile) return;
    setDialog("newImplant");
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <Anchor className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-1,theme(colors.gray.900))]">Implantología</h1>
            <p className="text-xs text-[var(--text-3,theme(colors.gray.500))]">{props.patientName}</p>
          </div>
        </div>
      </header>

      {isMobile && <MobileReadOnlyBanner />}

      <ImplantsSubTabs
        implantsContent={
          <ImplantsListTab
            implants={props.implants}
            onNew={handleNew}
            onAction={handleAction}
            onMilestoneClick={handleMilestone}
          />
        }
        surgeriesContent={
          <p className="text-sm text-[var(--text-3,theme(colors.gray.500))] py-8 text-center">
            Timeline cronológico de cirugías y aumentos — próxima fase.
          </p>
        }
        maintenanceContent={
          <p className="text-sm text-[var(--text-3,theme(colors.gray.500))] py-8 text-center">
            Tabla de mantenimientos + gráfico Albrektsson — próxima fase.
          </p>
        }
      />

      <NewImplantModal
        open={dialog === "newImplant"}
        patientId={props.patientId}
        doctorId={props.doctorId}
        onClose={close}
        onCreated={() => refresh()}
      />
      <SurgeryWizard
        open={dialog === "surgery"}
        implantId={activeImplantId}
        onClose={close}
        onSaved={() => refresh()}
      />
      <ProstheticWizard
        open={dialog === "prosthetic"}
        implantId={activeImplantId}
        onClose={close}
        onSaved={() => refresh()}
      />
      <ComplicationDrawer
        open={dialog === "complication"}
        implantId={activeImplantId}
        onClose={close}
        onCreated={() => refresh()}
      />
      <MaintenanceDrawer
        open={dialog === "maintenance"}
        implantId={activeImplantId}
        placedAt={activeImplant ? new Date(activeImplant.placedAt) : null}
        onClose={close}
        onCreated={() => refresh()}
      />
      <SecondStageDrawer
        open={dialog === "secondStage"}
        implantId={activeImplantId}
        onClose={close}
        onCreated={() => refresh()}
      />
      <SurgeryConsentModal
        open={dialog === "consent"}
        implantId={activeImplantId}
        patientId={props.patientId}
        patientName={props.patientName}
        doctorId={props.doctorId}
        doctorName={props.doctorName}
        doctorCedula={props.doctorCedula}
        onClose={close}
        onSigned={() => refresh()}
      />
      <RemoveImplantModal
        open={dialog === "remove"}
        implantId={activeImplantId}
        onClose={close}
        onRemoved={() => refresh()}
      />
      <BrandUpdateJustificationModal
        open={dialog === "traceability"}
        implantId={activeImplantId}
        current={
          activeImplant
            ? {
                brand: activeImplant.brand,
                lotNumber: activeImplant.lotNumber,
                placedAt: new Date(activeImplant.placedAt),
              }
            : null
        }
        onClose={close}
        onUpdated={() => refresh()}
      />
    </div>
  );
}
