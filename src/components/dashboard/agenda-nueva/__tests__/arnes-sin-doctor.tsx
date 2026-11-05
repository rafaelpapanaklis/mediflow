/**
 * ARNÉS DE NAVEGADOR (ws1-t11 · fase 2 · P2) — la cita «Sin doctor» con la Agenda nueva ENTERA y sus
 * proveedores de verdad (la ventana Nueva cita de verdad, el panel de la cita, el arrastre). Lo empaqueta
 * esbuild y lo abre Chromium desde `cita-sin-doctor-chromium.test.ts`; no es parte de la app. Cada `fetch`
 * lo contesta la prueba.
 *
 *  · `window.__ROL__` / `window.__USUARIO__`: quién mira (ADMIN, o un DOCTOR con «solo sus citas»).
 *  · `#nueva-con-paciente`: lo mismo que un botón genérico «Nueva cita» (sin doctor ni hueco), con el
 *    paciente ya elegido para poder guardar sin el buscador.
 */
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AgendaProvider } from "@/components/dashboard/agenda/agenda-provider";
import {
  NewAppointmentProvider,
  useNewAppointmentDialog,
} from "@/components/dashboard/new-appointment/new-appointment-provider";
import { NewPatientProvider } from "@/components/dashboard/new-patient/new-patient-provider";
import { AgendaNueva } from "@/components/dashboard/agenda-nueva/agenda-nueva";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import es from "@/i18n/dictionaries/es.json";

const w = window as unknown as { __PAYLOAD__: any; __DIA__: string; __ROL__: any; __USUARIO__: string };

function NuevaConPaciente() {
  const { open } = useNewAppointmentDialog();
  return (
    <button
      type="button"
      id="nueva-con-paciente"
      style={{ position: "fixed", right: 8, bottom: 8, zIndex: 5 }}
      onClick={() => open({ initialPatient: { id: "cmpac0000000000ana00001", name: "Ana García" }, initialDateISO: w.__DIA__ })}
    >
      nueva
    </button>
  );
}

createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale="es" dict={es as any}>
    <ConfirmProvider>
      <AgendaProvider initialPayload={w.__PAYLOAD__} initialDayISO={w.__DIA__} clinicCategory="DENTAL">
        {/* El mismo orden que el layout del panel: Nueva paciente por fuera de Nueva cita. */}
        <NewPatientProvider apariencia="nueva">
          <NewAppointmentProvider apariencia="nueva">
            <div style={{ height: "100vh" }}>
              <AgendaNueva clinicTaxMode="exempt" userRole={w.__ROL__} userId={w.__USUARIO__} detallesAlPasar={false} />
            </div>
            <NuevaConPaciente />
          </NewAppointmentProvider>
        </NewPatientProvider>
      </AgendaProvider>
    </ConfirmProvider>
    <Toaster />
  </I18nProvider>,
);
