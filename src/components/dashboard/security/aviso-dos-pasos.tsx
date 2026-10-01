"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { TWO_FA_SETUP_PATH } from "@/lib/auth/two-factor-constants";

// ws1-t8 · M2 — aviso al DUEÑO durante la gracia de la verificación en dos
// pasos obligatoria. No bloquea: «Recordármelo después» lo calla 24 h en este
// navegador y lo deja seguir a donde iba. Al vencer la gracia ya no sale esto,
// sino el enrolamiento obligatorio (que también se puede hacer ahí mismo).

// Mismo filtro que el reto: solo rutas internas de /dashboard (no open-redirect).
function safeNext(): string {
  if (typeof window === "undefined") return "/dashboard";
  const n = new URLSearchParams(window.location.search).get("next") ?? "";
  if (n.startsWith("/dashboard") && !n.startsWith("//") && !n.startsWith("/dashboard/2fa")) return n;
  return "/dashboard";
}

interface Props {
  clinicName: string;
  /** Fecha (ya formateada) desde la que será obligatoria. */
  fechaLimite: string;
  diasRestantes: number;
}

export function AvisoDosPasos({ clinicName, fechaLimite, diasRestantes }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    setNext(safeNext());
  }, []);

  async function posponer() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/auth/2fa/posponer", { method: "POST" });
    } catch {
      // Sin la cookie el aviso vuelve a salir en la próxima entrada; no es
      // motivo para dejarlo aquí parado.
    }
    // Navegación dura: el layout decide de nuevo con la cookie ya puesta.
    window.location.href = next;
  }

  return (
    <div className="w-full" style={{ maxWidth: 440, margin: "0 auto" }}>
      <div className="card p-6 space-y-5" style={{ boxShadow: "var(--shadow-2)" }}>
        <div className="flex flex-col items-center text-center gap-2">
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 44, height: 44, background: "var(--brand-soft)", color: "var(--consult-active-accent)" }}
          >
            <ShieldCheck size={20} strokeWidth={1.75} />
          </div>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {t("settings.client.tfa.avisoTitle")}
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--text-2)", margin: 0 }}>
            {t("settings.client.tfa.avisoBody", { clinica: clinicName, fecha: fechaLimite })}
          </p>
          <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>
            {t("settings.client.tfa.avisoPorQue")}
          </p>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {t("settings.client.tfa.avisoDias", { count: diasRestantes })}
          </p>
        </div>

        <div className="space-y-2">
          <a
            href={TWO_FA_SETUP_PATH}
            className="btn-new btn-new--primary"
            style={{ width: "100%", height: 40, justifyContent: "center" }}
          >
            {t("settings.client.tfa.avisoActivar")}
          </a>
          <button
            type="button"
            onClick={posponer}
            disabled={loading}
            className="btn-new btn-new--ghost"
            style={{ width: "100%", height: 40, justifyContent: "center", fontSize: 12, fontWeight: 500 }}
          >
            {t("settings.client.tfa.avisoLuego")}
          </button>
        </div>

        <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: 0, textAlign: "center" }}>
          {t("settings.client.tfa.avisoRecuperacion")}
        </p>
      </div>
    </div>
  );
}
