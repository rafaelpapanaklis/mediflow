/**
 * ARNÉS DE NAVEGADOR — la tarjeta de detalles al pasar el mouse (decisión de Rafael, 28-oct-2026), con la
 * Agenda nueva ENTERA y sus proveedores de verdad. Lo empaqueta esbuild y lo abre Chromium desde
 * `detalles-al-pasar-chromium.test.ts`; no es parte de la app. Cada `fetch` lo contesta la prueba.
 */
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AgendaProvider } from "@/components/dashboard/agenda/agenda-provider";
import { NewAppointmentProvider } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { NewPatientProvider } from "@/components/dashboard/new-patient/new-patient-provider";
import { AgendaNueva } from "@/components/dashboard/agenda-nueva/agenda-nueva";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const w = window as unknown as { __PAYLOAD__: any; __DIA__: string; __LANG__: "es" | "en" };

createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale={w.__LANG__} dict={(w.__LANG__ === "en" ? en : es) as any}>
    <ConfirmProvider>
    <AgendaProvider initialPayload={w.__PAYLOAD__} initialDayISO={w.__DIA__} clinicCategory="DENTAL">
      <NewPatientProvider apariencia="nueva">
        <NewAppointmentProvider apariencia="nueva">
          <div style={{ height: "100vh" }}>
            <AgendaNueva clinicTaxMode="exempt" userRole="ADMIN" />
          </div>
        </NewAppointmentProvider>
      </NewPatientProvider>
    </AgendaProvider>
    </ConfirmProvider>
  </I18nProvider>,
);
