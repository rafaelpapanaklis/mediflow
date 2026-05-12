// OrthoModuleShell · orchestrator client component del módulo Ortodoncia v2.
//
// Estructura visual:
//   ┌─────────────────────────────────────────────┐
//   │  PatientHeaderG16 (full-width)               │
//   ├──────────┬──────────────────────────────────┤
//   │ Sub-side │  Section (renderiza Sec*)          │
//   │  bar     │                                    │
//   └──────────┴──────────────────────────────────┘
//   + Drawers/Modales superpuestos según state
//
// Atajos de teclado (12):
//   N · nueva Treatment Card
//   F · subir foto
//   W · agregar wire step (solo en sección Plan)
//   C · cobrar mensualidad
//   D · marcar debonding (solo en Retención)
//   G · cargar plantilla (solo en Plan)
//   A · avanzar arco
//   1..8 · saltar a sección N del sub-sidebar
//   ?   · mostrar cheatsheet
//   Esc · cerrar drawer
//   Cmd+S · guardar drawer activo
//   Cmd+Enter · aceptar drawer

"use client";

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { PatientHeaderG16, SubSidebar, type OrthoSectionKey } from "./atoms";
import {
  SecResumen,
  SecExpediente,
  SecFotos,
  SecPlan,
  SecCitas,
  SecFinanciero,
  SecRetencion,
  SecDocumentos,
} from "./sections";
import {
  DrawerEditDiagnosis,
  DrawerEditPlan,
  DrawerNewWireStep,
  DrawerNewApplianceType,
  DrawerNewTAD,
  DrawerNewStage,
  DrawerUploadPhotos,
  ModalMobileUpload,
  LightboxPhoto,
  ModalCompare,
  ModalAnnotate,
  DrawerNewTreatmentCard,
  DrawerEditFinancialPlan,
  DrawerCollectInstallment,
  ModalQuoteScenarios,
  ModalSignAtHome,
  DrawerConfigRetention,
  DrawerNewReferralLetter,
  DrawerNewLabOrder,
  DrawerGenerateConsent,
  DrawerWhatsAppChat,
  ModalLoadTemplate,
  ModalSaveTemplate,
} from "./drawers";
import type { OrthoCaseBundle } from "@/lib/orthodontics-v2/types";

interface OrthoModuleShellProps {
  bundle: OrthoCaseBundle;
  doctorName: string;
}

const SECTION_ORDER: OrthoSectionKey[] = [
  "resumen",
  "expediente",
  "fotos",
  "plan",
  "citas",
  "financiero",
  "retencion",
  "documentos",
];

export function OrthoModuleShell({ bundle, doctorName }: OrthoModuleShellProps) {
  const [section, setSection] = useState<OrthoSectionKey>("resumen");
  const [drawer, setDrawer] = useState<string | null>(null);

  const onCmd = useCallback((cmd: string) => {
    if (cmd.startsWith("nav-")) {
      const key = cmd.slice(4) as OrthoSectionKey;
      if (SECTION_ORDER.includes(key)) setSection(key);
      return;
    }
    if (cmd.startsWith("drawer-") || cmd.startsWith("modal-")) {
      setDrawer(cmd);
      return;
    }
    if (cmd === "advance-arch") {
      toast("Avanzar arco · pendiente wire de submit");
      return;
    }
    if (cmd === "accept-plan") {
      toast("Aceptar plan · pendiente wire de submit");
      return;
    }
    toast(`Comando: ${cmd}`);
  }, []);

  // Keyboard shortcuts ─ 12 atajos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key === "Escape") {
        setDrawer(null);
        return;
      }
      if (e.key === "?") {
        toast("Atajos: N · F · W · C · D · G · A · 1-8 · ? · Esc · Cmd+S");
        return;
      }

      const k = e.key.toLowerCase();
      if (k === "n") setDrawer("drawer-new-tc");
      else if (k === "f") setDrawer("drawer-upload-photos");
      else if (k === "w" && section === "plan") setDrawer("drawer-new-wire");
      else if (k === "c") setDrawer("drawer-collect");
      else if (k === "d" && section === "retencion") onCmd("mark-debonding");
      else if (k === "g" && section === "plan") setDrawer("modal-template");
      else if (k === "a") onCmd("advance-arch");
      else if (/^[1-8]$/.test(k)) {
        const idx = Number(k) - 1;
        setSection(SECTION_ORDER[idx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section, onCmd]);

  const counts = {
    fotos: bundle.photoSets.length,
    citas: bundle.cards.length,
    documentos: bundle.documents.length + bundle.labOrders.length,
    financiero: bundle.financialPlan?.installments.filter((i) => i.status === "PENDING").length ?? 0,
  };

  const renderSection = () => {
    const props = { bundle, onCmd };
    switch (section) {
      case "resumen":
        return <SecResumen {...props} />;
      case "expediente":
        return <SecExpediente {...props} />;
      case "fotos":
        return <SecFotos {...props} />;
      case "plan":
        return <SecPlan {...props} />;
      case "citas":
        return <SecCitas {...props} />;
      case "financiero":
        return <SecFinanciero {...props} />;
      case "retencion":
        return <SecRetencion {...props} />;
      case "documentos":
        return <SecDocumentos {...props} />;
    }
  };

  const closeDrawer = () => setDrawer(null);

  return (
    <div className="flex flex-col gap-4">
      <PatientHeaderG16
        patient={{
          id: bundle.case.patient.id,
          firstName: bundle.case.patient.firstName,
          lastName: bundle.case.patient.lastName,
          patientNumber: bundle.case.patient.patientNumber,
        }}
        caseCode={bundle.case.caseCode}
        doctorName={doctorName}
        status={bundle.case.status}
        onCmd={onCmd}
      />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="overflow-y-auto rounded-2xl border border-border bg-card shadow-sm">
          <SubSidebar active={section} onChange={setSection} counts={counts} />
        </aside>

        <main className="min-w-0">{renderSection()}</main>
      </div>

      {/* Drawers · cada uno controla su open via prop */}
      <DrawerEditDiagnosis open={drawer === "drawer-edit-dx"} onClose={closeDrawer} />
      <DrawerEditPlan open={drawer === "drawer-edit-plan"} onClose={closeDrawer} />
      <DrawerNewWireStep open={drawer === "drawer-new-wire"} onClose={closeDrawer} />
      <DrawerNewApplianceType open={drawer === "drawer-new-appliance"} onClose={closeDrawer} />
      <DrawerNewTAD open={drawer === "drawer-new-tad"} onClose={closeDrawer} />
      <DrawerNewStage open={drawer === "drawer-new-stage"} onClose={closeDrawer} />
      <DrawerUploadPhotos open={drawer === "drawer-upload-photos"} onClose={closeDrawer} />
      <ModalMobileUpload open={drawer === "modal-mobile"} onClose={closeDrawer} />
      <LightboxPhoto open={drawer?.startsWith("lightbox:") ?? false} onClose={closeDrawer} />
      <ModalCompare open={drawer === "modal-compare"} onClose={closeDrawer} />
      <ModalAnnotate open={drawer === "modal-annotate"} onClose={closeDrawer} />
      <DrawerNewTreatmentCard open={drawer === "drawer-new-tc"} onClose={closeDrawer} />
      <DrawerEditFinancialPlan open={drawer === "drawer-edit-financial"} onClose={closeDrawer} />
      <DrawerCollectInstallment
        open={drawer === "drawer-collect" || (drawer?.startsWith("drawer-collect:") ?? false)}
        onClose={closeDrawer}
      />
      <ModalQuoteScenarios open={drawer === "modal-quote"} onClose={closeDrawer} />
      <ModalSignAtHome open={drawer === "modal-sign-at-home"} onClose={closeDrawer} />
      <DrawerConfigRetention open={drawer === "drawer-config-retention"} onClose={closeDrawer} />
      <DrawerNewReferralLetter open={drawer === "drawer-new-refer"} onClose={closeDrawer} />
      <DrawerNewLabOrder open={drawer === "drawer-new-lab"} onClose={closeDrawer} />
      <DrawerGenerateConsent open={drawer === "drawer-new-consent"} onClose={closeDrawer} />
      <DrawerWhatsAppChat open={drawer === "drawer-wa"} onClose={closeDrawer} />
      <ModalLoadTemplate open={drawer === "modal-template"} onClose={closeDrawer} />
      <ModalSaveTemplate open={drawer === "modal-save-template"} onClose={closeDrawer} />
    </div>
  );
}
