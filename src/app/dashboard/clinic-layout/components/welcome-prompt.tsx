"use client";

import { useState } from "react";
import { Building2, FileWarning, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import promptStyles from "./welcome-prompt.module.css";

interface ChairResource {
  id: string;
  name: string;
  color: string | null;
  orderIndex: number;
}

export function WelcomePrompt({
  onLoaded,
}: {
  onLoaded: (data: { elements: unknown[]; chairs: ChairResource[]; chairsCreated: number }) => void;
}) {
  const [loading, setLoading] = useState<"demo" | "empty" | null>(null);

  const loadDemo = async () => {
    setLoading("demo");
    try {
      const res = await fetch("/api/clinic-layout/seed-demo", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      onLoaded({
        elements: (data.layout?.elements ?? []) as unknown[],
        chairs: (data.chairs ?? []) as ChairResource[],
        chairsCreated: data.created?.chairs ?? 0,
      });
      toast.success(
        data.created?.chairs
          ? `Layout demo cargado · ${data.created.chairs} sillones creados`
          : "Layout demo cargado",
      );
    } catch {
      toast.error("No se pudo cargar el demo");
    } finally {
      setLoading(null);
    }
  };

  const startEmpty = async () => {
    setLoading("empty");
    try {
      const res = await fetch("/api/clinic-layout/seed-demo", { method: "PUT" });
      if (!res.ok) throw new Error();
      onLoaded({ elements: [], chairs: [], chairsCreated: 0 });
    } catch {
      toast.error("Error al inicializar layout");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className={promptStyles.wrap}>
      <div className={promptStyles.card}>
        <div className={promptStyles.icon}>
          <Building2 size={32} aria-hidden />
        </div>
        <h1 className={promptStyles.title}>Diseña tu clínica</h1>
        <p className={promptStyles.subtitle}>
          Empieza con un layout de ejemplo (recepción + 3 consultorios + sala de
          rayos X + esterilización + baño) o construye desde cero arrastrando
          elementos al canvas.
        </p>

        <div className={promptStyles.cta}>
          <button
            type="button"
            className={`${promptStyles.btn} ${promptStyles.btnPrimary}`}
            onClick={loadDemo}
            disabled={loading !== null}
          >
            <Sparkles size={14} aria-hidden />
            {loading === "demo" ? "Cargando demo…" : "Cargar layout demo"}
          </button>
          <button
            type="button"
            className={promptStyles.btn}
            onClick={startEmpty}
            disabled={loading !== null}
          >
            {loading === "empty" ? "Iniciando…" : "Empezar de cero"}
          </button>
        </div>

        <div className={promptStyles.info}>
          <FileWarning size={11} aria-hidden />
          <span>
            El demo crea automáticamente 3 Resources tipo CHAIR (Consultorio 1,
            2 y 3) en la agenda. Si ya tienes sillones registrados con esos
            nombres, los reusa.
          </span>
        </div>
      </div>
    </div>
  );
}
