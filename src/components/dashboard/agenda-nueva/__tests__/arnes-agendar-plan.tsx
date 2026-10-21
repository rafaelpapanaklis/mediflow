/**
 * ARNÉS DE NAVEGADOR (ws1-t1 · plan fase 2 · P8) — «Agendar lo pendiente» con los proveedores de
 * verdad. Lo empaqueta esbuild y lo abre Chromium desde `agendar-lo-pendiente-chromium.test.ts`; no
 * es parte de la app.
 *
 *  · `window.__MODO__ = "plan"`: la hoja del plan (`AgendarLoPendiente`), como en la ventana del plan.
 *  · `window.__MODO__ = "ventana"` / `"tarjeta"`: el botón MONTADO donde vive de verdad, en el pie de
 *    `VentanaVerPlan` y en la tarjeta del plan de la ficha (`PlanTratamiento`).
 *  · `window.__MODO__ = "agenda"`: la agenda «agendando del plan» (`useAgendarDelPlan` con la URL de
 *    la página) y un botón que hace lo mismo que el clic en un hueco de la cuadrícula.
 * Cada `fetch` lo contesta la prueba.
 */
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AgendaProvider } from "@/components/dashboard/agenda/agenda-provider";
import {
  ConParamsDeNuevaCita,
  NewAppointmentProvider,
  useNewAppointmentDialog,
} from "@/components/dashboard/new-appointment/new-appointment-provider";
import { NewPatientProvider } from "@/components/dashboard/new-patient/new-patient-provider";
import { AgendarLoPendiente } from "@/components/dashboard/plan-a-agenda/agendar-lo-pendiente";
import { VentanaVerPlan } from "@/components/dashboard/plan-tratamiento-rediseno/ventanas-plan";
import { PlanTratamiento } from "@/components/dashboard/expediente-rediseno/plan-tratamiento";
import { useAgendarDelPlan } from "@/components/dashboard/agenda-nueva/agendar-del-plan";
import es from "@/i18n/dictionaries/es.json";

const w = window as unknown as {
  __PAYLOAD__: any; __DIA__: string; __MODO__: string; __HUECO__: string; __abrioAgenda?: boolean;
  __cerroVentana?: boolean; __abrioPlan?: number;
};

/** Un plan del camino nuevo, activo, como lo pasa la ficha. */
const PLAN = {
  id: "plan1", name: "Plan 20 oct", status: "ACTIVE", description: "Resina 16 · Endodoncia 26 · Limpieza",
  totalSessions: 3, sessionIntervalDays: 7, totalCost: 4200, startDate: "2026-10-20T16:00:00Z", nextExpectedDate: null,
  doctor: { firstName: "Luis", lastName: "Ruiz" }, sessions: [],
};

function Hueco() {
  const { open } = useNewAppointmentDialog();
  return (
    <button type="button" id="hueco" onClick={() => open({ initialSlot: { startsAt: w.__HUECO__, doctorId: "d1", resourceId: null } })}>
      hueco
    </button>
  );
}

function AgendaConPlan() {
  const { extra, aviso } = useAgendarDelPlan();
  return (
    <>
      <ConParamsDeNuevaCita extra={extra}>
        <Hueco />
      </ConParamsDeNuevaCita>
      {aviso}
    </>
  );
}

createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale="es" dict={es as any}>
    <AgendaProvider initialPayload={w.__PAYLOAD__} initialDayISO={w.__DIA__} clinicCategory="DENTAL">
      {/* El mismo orden que el layout del panel: Nueva paciente por fuera de Nueva cita. */}
      <NewPatientProvider apariencia="nueva">
      <NewAppointmentProvider apariencia="nueva">
        {w.__MODO__ === "agenda" ? (
          <AgendaConPlan />
        ) : w.__MODO__ === "ventana" ? (
          <VentanaVerPlan plan={PLAN} puedeEditar onCerrar={() => { w.__cerroVentana = true; }} onEditar={() => {}} />
        ) : w.__MODO__ === "tarjeta" ? (
          <PlanTratamiento
            tratamientos={[PLAN]}
            puedeEditar={false}
            onNuevo={() => {}}
            onVer={() => { w.__abrioPlan = (w.__abrioPlan ?? 0) + 1; }}
            onEditar={() => {}}
            onEliminar={() => {}}
          />
        ) : (
          <div id="ventana-plan">
            <AgendarLoPendiente planId="plan1" onAbrirAgenda={() => { w.__abrioAgenda = true; }} />
          </div>
        )}
      </NewAppointmentProvider>
      </NewPatientProvider>
    </AgendaProvider>
    <Toaster />
  </I18nProvider>,
);
