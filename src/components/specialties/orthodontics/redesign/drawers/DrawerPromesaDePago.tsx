"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F12. Anota fecha y monto; no manda
// recordatorio (eso es W-block/portal, fuera de esta parte) — recepción la
// revisa desde la lista de vencidas al día siguiente.

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { registrarPromesaDePago } from "@/app/actions/orthodontics/cobro/registrarPromesaDePago";
import { isFailure } from "@/app/actions/orthodontics/result";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

function mañana(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DrawerPromesaDePagoProps {
  treatmentPlanId: string;
  montoSugerido: number;
  onClose: () => void;
  onGuardado: () => void;
}

export function DrawerPromesaDePago(props: DrawerPromesaDePagoProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const [amount, setAmount] = useState(props.montoSugerido || 0);
  const [promisedDate, setPromisedDate] = useState(mañana());
  const [note, setNote] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await registrarPromesaDePago({ treatmentPlanId: props.treatmentPlanId, amount, promisedDate, note: note.trim() || null });
      if (isFailure(r)) { setError(r.error); return; }
      props.onGuardado();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className={orto.velo} onClick={props.onClose} aria-hidden />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={`${orto.cajon} ${orto.cajonEstrecho}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-promesa-title"
      >
        <header className={orto.cajonCabeza}>
          <h3 id="drawer-promesa-title" className={orto.cajonTitulo}>Promesa de pago</h3>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)]">
            Monto
            <input
              type="number" min={0} step="0.01"
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
              className={`${orto.entrada} mt-1 w-full`}
            />
          </label>
          <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)]">
            Fecha prometida
            <input
              type="date"
              value={promisedDate}
              min={mañana()}
              onChange={(e) => setPromisedDate(e.target.value)}
              className={`${orto.entrada} mt-1 w-full`}
            />
          </label>
          <label className="block text-xs font-semibold text-[color:var(--pr-texto-2)]">
            Nota (opcional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Ej. el papá dijo que paga el viernes en la tarde"
              className={`${orto.entrada} mt-1 w-full`}
            />
          </label>
          {error ? (
            <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] rounded-[10px] p-3 text-xs text-[color:var(--pr-peligro)]">{error}</div>
          ) : null}
        </div>
        <footer className={orto.cajonPie}>
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={guardar} disabled={guardando || amount <= 0}>
            {guardando ? "Guardando..." : "Registrar promesa"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}
