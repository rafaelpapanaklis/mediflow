"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F9 por caso. Solo ANOTA qué regla
// (de las que configuró la clínica) se le aplicó a este plan — el % en sí
// ya se puso a mano en el descuento de la factura al crearla. Sirve para
// que la ficha lo enseñe consistente, no para calcular nada.

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { elegirDescuentoDelCaso } from "@/app/actions/orthodontics/cobro/elegirDescuentoDelCaso";
import type { ReglaDescuento } from "@/lib/orthodontics/cobro/reglas";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

export interface DrawerElegirDescuentoProps {
  treatmentPlanId: string;
  reglas: ReglaDescuento[];
  actual: { ruleId: string | null };
  onClose: () => void;
  onGuardado: () => void;
}

export function DrawerElegirDescuento(props: DrawerElegirDescuentoProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const [seleccion, setSeleccion] = useState<string | null>(props.actual.ruleId);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const regla = props.reglas.find((r) => r.id === seleccion) ?? null;
      await elegirDescuentoDelCaso({
        treatmentPlanId: props.treatmentPlanId,
        ruleId: regla?.id ?? null,
        label: regla?.etiqueta ?? null,
        pct: regla?.porcentaje ?? null,
      });
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
        aria-labelledby="drawer-elegir-descuento-title"
      >
        <header className={orto.cajonCabeza}>
          <h3 id="drawer-elegir-descuento-title" className={orto.cajonTitulo}>Descuento de este caso</h3>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {props.reglas.length === 0 ? (
            <p className="text-xs text-[color:var(--pr-texto-3)]">La clínica todavía no tiene reglas de descuento. Se configuran en «Política de cobro».</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSeleccion(null)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-[8px] border text-[13px] text-left ${seleccion === null ? "border-[color:var(--pr-activo)] bg-[color:var(--pr-activo-suave)]" : "border-[color:var(--pr-borde)]"}`}
              >
                <span>Sin descuento</span>
                {seleccion === null ? <Check className="w-4 h-4 text-[color:var(--orto-violeta)]" aria-hidden /> : null}
              </button>
              {props.reglas.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSeleccion(r.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-[8px] border text-[13px] text-left ${seleccion === r.id ? "border-[color:var(--pr-activo)] bg-[color:var(--pr-activo-suave)]" : "border-[color:var(--pr-borde)]"}`}
                >
                  <span>{r.etiqueta}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-xs text-[color:var(--pr-texto-3)]">{r.porcentaje}%</span>
                    {seleccion === r.id ? <Check className="w-4 h-4 text-[color:var(--orto-violeta)]" aria-hidden /> : null}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
        <footer className={orto.cajonPie}>
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="emerald" size="md" onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</Btn>
        </footer>
      </aside>
    </>
  );
}
