"use client";
// Implants — entrada del módulo en el detalle del paciente. Spec §6.
// Combina los 3 sub-tabs (Implantes, Cirugías, Mantenimiento). Maneja
// el handler onAction central que abre wizards/drawers/modales (Phase 5).
//
// MOBILE FALLBACK: Si viewport < 1024px, renderiza banner read-only.
// La captura clínica requiere tablet/desktop (Spec §1.17).

import { useEffect, useState } from "react";
import { Anchor, MonitorSmartphone } from "lucide-react";
import { ImplantsSubTabs } from "./ImplantsSubTabs";
import { ImplantsListTab } from "./ImplantsListTab";
import type { ImplantFull } from "@/lib/types/implants";
import type { ImplantActionType } from "./ImplantActions";
import type { TimelineMilestone as MilestoneKey } from "@/lib/implants/implant-helpers";

export interface ImplantsTabProps {
  patientId: string;
  patientName: string;
  implants: ImplantFull[];
  onAction?: (action: ImplantActionType, implantId: string) => void;
  onNewImplant?: () => void;
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
        <p className="font-medium text-amber-900 dark:text-amber-200">
          Modo solo lectura
        </p>
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
  const isMobile = useIsMobile();

  const handleAction = (action: ImplantActionType, implantId: string) => {
    if (isMobile) return; // bloqueado en mobile
    props.onAction?.(action, implantId);
  };

  const handleNew = () => {
    if (isMobile) return;
    props.onNewImplant?.();
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <Anchor className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-1,theme(colors.gray.900))]">
              Implantología
            </h1>
            <p className="text-xs text-[var(--text-3,theme(colors.gray.500))]">
              {props.patientName}
            </p>
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
            onMilestoneClick={props.onMilestoneClick}
          />
        }
        surgeriesContent={
          <p className="text-sm text-[var(--text-3,theme(colors.gray.500))] py-8 text-center">
            Timeline de cirugías y aumentos óseos — disponible en próxima fase.
          </p>
        }
        maintenanceContent={
          <p className="text-sm text-[var(--text-3,theme(colors.gray.500))] py-8 text-center">
            Tabla de mantenimientos + gráfico de pérdida ósea — disponible en próxima fase.
          </p>
        }
      />
    </div>
  );
}
