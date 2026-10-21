/**
 * ARNÉS DE NAVEGADOR (ws1-t12 · fase 2) — «Cobrar hoy» con plan, «Hoy en el sillón» (Tratamientos
 * detectados) y la tarjeta «Cuenta del plan», con su proveedor de idioma de verdad. Lo empaqueta
 * esbuild y lo abre Chromium desde `cobro-plan-toques.test.ts`; no es parte de la app. Cada `fetch`
 * lo contesta la prueba.
 */
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { CobrarHoy } from "@/components/dashboard/cobrar-hoy/cobrar-hoy";
import { TreatmentsModal } from "@/components/dashboard/patient-detail/treatments-modal";
import { PlanTratamiento } from "@/components/dashboard/expediente-rediseno/plan-tratamiento";
import { useCuentasDelPaciente } from "@/components/dashboard/expediente-rediseno/cuenta-del-plan";
import es from "@/i18n/dictionaries/es.json";

const w = window as unknown as { __ESCENA__?: string; __LISTO__?: unknown; __CERRADA__?: boolean; __HECHOS__?: number; __ABONAR__?: boolean };

function Cuenta() {
  const { cuentas, cargando } = useCuentasDelPaciente("pac1", true, 1);
  return (
    <PlanTratamiento
      tratamientos={[{ id: "plan1", name: "Plan Ana", status: "ACTIVE", totalSessions: 3, sessionIntervalDays: 30, totalCost: 2050.5, sessions: [], doctor: { firstName: "Valeria", lastName: "Santos" }, description: null }]}
      puedeEditar
      onNuevo={() => {}}
      onVer={() => {}}
      onEditar={() => {}}
      onEliminar={() => {}}
      cuentas={cuentas}
      cargandoCuentas={cargando}
      onCobrarPlan={() => { w.__ABONAR__ = true; }}
    />
  );
}

function Escena() {
  const escena = w.__ESCENA__ ?? "cobrar";
  if (escena === "cuenta") return <Cuenta />;
  if (escena === "hoy") {
    return (
      <TreatmentsModal
        open
        appointmentId="cita1"
        patientId="pac1"
        puedeMarcarHecho
        initialTreatments={[
          { code: "ODO_RESINA", name: "Resina", toothNumber: 16, surface: "O", unitPrice: 1250.5, procedureCatalogId: "proc-r" },
          { code: "ODO_BLANQ", name: "Blanqueamiento", toothNumber: 11, surface: null, unitPrice: 3000, procedureCatalogId: "proc-b" },
        ]}
        onClose={() => { w.__CERRADA__ = true; }}
        onInvoiced={(f) => { w.__LISTO__ = f; }}
        onCobrarHoy={() => { w.__ABONAR__ = true; }}
        onHechos={() => { w.__HECHOS__ = (w.__HECHOS__ ?? 0) + 1; }}
      />
    );
  }
  return (
    <CobrarHoy
      open
      onClose={() => { w.__CERRADA__ = true; }}
      patientId="pac1"
      patientName="Ana López"
      cita={{ id: "cita1", motivo: "Resina" }}
      puedeCobrar
      onListo={(n) => { w.__LISTO__ = n; }}
    />
  );
}

createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale="es" dict={es as any}>
    <Escena />
    <Toaster />
  </I18nProvider>,
);
