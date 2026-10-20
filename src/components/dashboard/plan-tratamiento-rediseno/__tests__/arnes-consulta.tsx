/**
 * ARNÉS DE NAVEGADOR (ws1-t5, fase 2 · P9) — la Nueva consulta dental de verdad (`DentalForm`)
 * con «Armar el plan». Lo empaqueta esbuild y lo abre Chromium desde `consulta-toques.test.ts`;
 * no es parte de la app. Cada `fetch` lo contesta la prueba.
 */
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { DentalForm } from "@/components/clinical/dental-form";
import es from "@/i18n/dictionaries/es.json";

const w = window as unknown as { __GUARDADO__?: unknown; __CONSULTA_GUARDADA__?: unknown; __CON_PLAN__?: boolean };

createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale="es" dict={es as any}>
    <ConfirmProvider>
      <DentalForm
        patientId="pac-prueba"
        rediseno
        onSaved={(r) => { w.__CONSULTA_GUARDADA__ = r; }}
        armarPlan={w.__CON_PLAN__ === false ? undefined : {
          paciente: { id: "pac-prueba", nombre: "Mariana López Ortega", esNino: false },
          doctores: [{ id: "doc1", firstName: "Valeria", lastName: "Santos" }],
          doctorId: "doc1",
          onGuardado: (plan) => { w.__GUARDADO__ = plan; },
        }}
      />
    </ConfirmProvider>
    <Toaster />
  </I18nProvider>,
);
