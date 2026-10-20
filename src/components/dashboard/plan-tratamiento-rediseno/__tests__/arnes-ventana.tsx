/**
 * ARNÉS DE NAVEGADOR (ws1-t5, fase 2 · P3) — la ventana rápida «Nuevo plan de tratamiento» con
 * su proveedor de idioma de verdad. Lo empaqueta esbuild y lo abre Chromium desde
 * `ventana-toques.test.ts`; no es parte de la app. Cada `fetch` lo contesta la prueba.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { I18nProvider } from "@/i18n/i18n-provider";
import { VentanaNuevoPlan, type FormPlan } from "@/components/dashboard/plan-tratamiento-rediseno/ventana-nuevo-plan";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const w = window as unknown as { __IDIOMA__?: "es" | "en"; __GUARDADO__?: unknown; __CERRADA__?: boolean };
const idioma = w.__IDIOMA__ === "en" ? "en" : "es";

function Ficha() {
  // Como la ficha al abrir: el doctor de la sesión y el nombre vacío.
  const [form, setForm] = useState<FormPlan>({ doctorId: "doc1", name: "", description: "", totalSessions: "6", sessionIntervalDays: "30", totalCost: "" });
  return (
    <VentanaNuevoPlan
      paciente={{ id: "pac-prueba", nombre: "Mariana López Ortega", esNino: false }}
      doctores={[{ id: "doc1", firstName: "Valeria", lastName: "Santos" }, { id: "doc2", firstName: "Jorge", lastName: "Ruiz" }]}
      form={form}
      setForm={setForm}
      sugerencias={["Rehabilitación oral", "Ortodoncia"]}
      guardando={false}
      onCerrar={() => { w.__CERRADA__ = true; }}
      onGuardado={(plan) => { w.__GUARDADO__ = plan; }}
    />
  );
}

createRoot(document.getElementById("raiz")!).render(
  <I18nProvider locale={idioma} dict={(idioma === "en" ? en : es) as any}>
    <Ficha />
    <Toaster />
  </I18nProvider>,
);
