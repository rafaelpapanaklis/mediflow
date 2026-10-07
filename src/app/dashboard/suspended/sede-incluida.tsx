"use client";

import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { avisoSedeIncluida } from "@/lib/billing/sedes-incluidas-core";

/**
 * M1 (ws1-t5) — sede incluida sin acceso: no se paga aquí. Se explica y se lleva a la clínica que paga
 * (cambia la sede activa con /api/switch-clinic; el layout de esa clínica decide si pide el pago).
 */
export function SedeIncluidaSuspendida({
  principalId,
  principalNombre,
}: {
  principalId: string;
  principalNombre: string | null;
}) {
  const [yendo, setYendo] = useState(false);

  async function irALaPrincipal() {
    setYendo(true);
    try {
      const res = await fetch("/api/switch-clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId: principalId }),
      });
      if (!res.ok) throw new Error();
      window.location.href = "/dashboard";
    } catch {
      toast.error("No pudimos cambiarte de clínica. Usa el selector de sedes o vuelve a entrar.");
      setYendo(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 px-6 pb-20 pt-24 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-card text-muted-foreground ring-1 ring-border">
          <Building2 size={22} aria-hidden />
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight">Esta sede va incluida en tu plan</h1>
        <p className="text-base leading-relaxed text-muted-foreground">{avisoSedeIncluida(principalNombre)}</p>
        <button
          type="button"
          onClick={irALaPrincipal}
          disabled={yendo}
          className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {yendo ? <Loader2 size={15} className="animate-spin" aria-hidden /> : null}
          {principalNombre ? `Ir a ${principalNombre}` : "Ir a la clínica principal"}
        </button>
      </div>
    </div>
  );
}
