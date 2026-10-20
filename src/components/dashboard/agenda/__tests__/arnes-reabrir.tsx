/**
 * ARNÉS DE NAVEGADOR (WS1-T5, revisión t8, N3-A3) — la agenda de siempre con
 * UNA tarjeta y su panel de detalle, con los proveedores de verdad. Lo
 * empaqueta esbuild y lo abre Chromium desde
 * `src/app/api/appointments/__tests__/reabrir-sobreagendada.test.ts`; no es
 * parte de la app.
 *
 * El payload llega en `window.__PAYLOAD__`. Cada `fetch` de la página lo
 * contesta la prueba (el PATCH de estado, con el handler REAL de la ruta).
 */
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { DndContext } from "@dnd-kit/core";
import { I18nProvider } from "@/i18n/i18n-provider";
import { AgendaProvider, useAgenda } from "@/components/dashboard/agenda/agenda-provider";
import { AgendaAppointmentCard } from "@/components/dashboard/agenda/agenda-appointment-card";
import { AgendaDetailPanel } from "@/components/dashboard/agenda/agenda-detail-panel";
import { NewAppointmentProvider } from "@/components/dashboard/new-appointment/new-appointment-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import es from "@/i18n/dictionaries/es.json";

const w = window as unknown as { __PAYLOAD__: any; __DIA__: string; __CON_PANEL__?: boolean };

function Tarjetas() {
  const { state } = useAgenda();
  return (
    <div id="tarjetas" style={{ position: "relative" }}>
      {state.appointments.map((a) => (
        <AgendaAppointmentCard
          key={a.id}
          appointment={a}
          dayISO={w.__DIA__}
          slotMinutes={state.slotMinutes}
          dayStart={state.dayStart}
          timezone={state.timezone}
        />
      ))}
    </div>
  );
}

createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale="es" dict={es as any}>
    <ConfirmProvider>
    <AgendaProvider initialPayload={w.__PAYLOAD__} initialDayISO={w.__DIA__} clinicCategory="DENTAL">
      <NewAppointmentProvider>
        <DndContext>
          <Tarjetas />
          {w.__CON_PANEL__ ? <AgendaDetailPanel clinicTaxMode="exempt" /> : null}
        </DndContext>
      </NewAppointmentProvider>
    </AgendaProvider>
    </ConfirmProvider>
    <Toaster />
  </I18nProvider>,
);
