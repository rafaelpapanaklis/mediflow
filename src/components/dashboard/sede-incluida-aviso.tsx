"use client";

import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { avisoSedeIncluida } from "@/lib/billing/sedes-incluidas-core";

/**
 * M2 (ws1-t5) — pestaña Suscripción de una sede incluida: el plan lo paga otra clínica, así que no hay
 * «Cancelar», «Cambiar plan» ni «Activar». Se dice quién paga y se ofrece pasar a esa clínica.
 */
export function SedeIncluidaAviso({
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
      window.location.href = "/dashboard/settings?tab=subscription";
    } catch {
      toast.error("No pudimos cambiarte de clínica. Usa el selector de sedes.");
      setYendo(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6" data-testid="sede-incluida-aviso">
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Building2 size={20} aria-hidden />
        </span>
        <div className="space-y-3">
          <h2 className="text-lg font-bold">Sede incluida en tu plan</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{avisoSedeIncluida(principalNombre)}</p>
          <button
            type="button"
            onClick={irALaPrincipal}
            disabled={yendo}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {yendo ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {principalNombre ? `Ir a ${principalNombre}` : "Ir a la clínica principal"}
          </button>
        </div>
      </div>
    </div>
  );
}
