/**
 * ARNÉS DE NAVEGADOR (v17, decisiones de Rafael del 28-oct) — la tarjeta del plan con «Hecho» que pregunta
 * en qué cita se hizo y «Convertir en presupuesto» junto a «Abonar al plan», y el bloque «En esta cita» del
 * detalle de la cita. Con su proveedor de idioma de verdad. Lo empaqueta esbuild y lo abre Chromium desde
 * `v17-toques.test.ts`; no es parte de la app. Cada `fetch` lo contesta la prueba.
 */
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { PlanTratamiento } from "@/components/dashboard/expediente-rediseno/plan-tratamiento";
import { useCuentasDelPaciente } from "@/components/dashboard/expediente-rediseno/cuenta-del-plan";
import { EnEstaCita } from "@/components/dashboard/plan-a-agenda/en-esta-cita";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const w = window as unknown as {
  __ESCENA__?: string;
  __LOCALE__?: "es" | "en";
  __USUARIO__?: { id: string; esDoctor: boolean };
  __NOTA__?: number;
  __PRESUPUESTO__?: unknown;
  __ABONAR__?: boolean;
};

function Tarjeta() {
  const { cuentas, cargando, poner } = useCuentasDelPaciente("pac1", true, 1);
  return (
    <PlanTratamiento
      tratamientos={[{ id: "plan1", name: "Plan Ana", status: "ACTIVE", totalSessions: 3, sessionIntervalDays: 30, totalCost: 2050.5, sessions: [], doctorId: "doc-ana", doctor: { firstName: "Ana", lastName: "Ruiz" }, description: null }]}
      puedeEditar
      onNuevo={() => {}}
      onVer={() => {}}
      onEditar={() => {}}
      onEliminar={() => {}}
      cuentas={cuentas}
      cargandoCuentas={cargando}
      onCuentaNueva={poner}
      onCobrarPlan={() => { w.__ABONAR__ = true; }}
      patientId="pac1"
      puedeMarcarHecho
      refresco={1}
      onEscribirNota={() => { w.__NOTA__ = (w.__NOTA__ ?? 0) + 1; }}
      onAbrirPresupuesto={(q) => { w.__PRESUPUESTO__ = q; }}
      usuario={w.__USUARIO__ ?? { id: "admin1", esDoctor: false }}
    />
  );
}

function Escena() {
  if (w.__ESCENA__ === "cita") {
    // El ancho del panel lateral de la cita (420 px), o la pantalla si es menor.
    return <div style={{ width: "min(420px, 100%)" }}><EnEstaCita appointmentId="cita-hoy" /><EnEstaCita appointmentId="cita-sin-plan" /></div>;
  }
  return <Tarjeta />;
}

const locale = w.__LOCALE__ ?? "es";
createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale={locale} dict={(locale === "en" ? en : es) as any}>
    <Escena />
    <Toaster />
  </I18nProvider>,
);
