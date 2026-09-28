"use client";
// Ortodoncia — Cobro (ws1-t1, Ola 1): F9 (catálogo de reglas de descuento
// de la clínica: contado, hermanos, pago puntual…) + F10 (recargo por
// atraso, APAGADO por default — decisión de Rafael). Política de TODA la
// clínica, no de un caso: solo SUPER_ADMIN/ADMIN la cambian
// (`guardarConfigDeCobro` la vuelve a comprobar en el servidor).

import { useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { guardarConfigDeCobro } from "@/app/actions/orthodontics/cobro/guardarConfigDeCobro";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { ConfigDeCobro } from "@/lib/orthodontics/cobro/config-db";
import type { ReglaDescuento, TipoValorRecargo } from "@/lib/orthodontics/cobro/reglas";
import orto from "../orto.module.css";

export interface DrawerConfigCobroProps {
  config: ConfigDeCobro;
  onClose: () => void;
  onGuardado: () => void;
}

let seq = 0;
function nuevoId(): string { seq += 1; return `regla-nueva-${seq}`; }

export function DrawerConfigCobro(props: DrawerConfigCobroProps) {
  const [reglas, setReglas] = useState<ReglaDescuento[]>(props.config.discountRules);
  const [lateFeeEnabled, setLateFeeEnabled] = useState(props.config.lateFee.activo);
  const [lateFeeType, setLateFeeType] = useState<TipoValorRecargo>(props.config.lateFee.tipo);
  const [lateFeeValue, setLateFeeValue] = useState(props.config.lateFee.valor);
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState(props.config.lateFee.diasDeGracia);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function agregarRegla() {
    setReglas((prev) => [...prev, { id: nuevoId(), etiqueta: "", porcentaje: 0 }]);
  }
  function quitarRegla(id: string) {
    setReglas((prev) => prev.filter((r) => r.id !== id));
  }
  function patchRegla(id: string, patch: Partial<ReglaDescuento>) {
    setReglas((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const limpias = reglas.filter((r) => r.etiqueta.trim().length > 0);
      const r = await guardarConfigDeCobro({
        discountRules: limpias,
        lateFeeEnabled,
        lateFeeType,
        lateFeeValue,
        lateFeeGraceDays,
      });
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
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-config-cobro-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>Política de cobro</div>
            <h3 id="drawer-config-cobro-title" className={orto.cajonTitulo}>
              Descuentos y recargo por atraso
            </h3>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <section>
            <h4 className="text-xs font-semibold text-[color:var(--pr-texto-2)] mb-2">Reglas de descuento</h4>
            <p className="text-[11px] text-[color:var(--pr-texto-3)] mb-3">
              Solo son un catálogo de referencia: quien crea la factura sigue aplicando el % a mano en el descuento de la factura.
            </p>
            <div className="space-y-2">
              {reglas.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <input
                    value={r.etiqueta}
                    onChange={(e) => patchRegla(r.id, { etiqueta: e.target.value })}
                    placeholder="Ej. Contado, Hermanos, Pago puntual"
                    className={`${orto.entrada} flex-1`}
                  />
                  <div className="relative w-24">
                    <input
                      type="number" min={0} max={100} step={1}
                      value={r.porcentaje}
                      onChange={(e) => patchRegla(r.id, { porcentaje: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                      className={`${orto.entrada} w-full`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[color:var(--pr-texto-3)]">%</span>
                  </div>
                  <button type="button" onClick={() => quitarRegla(r.id)} aria-label="Quitar regla" className="text-[color:var(--pr-texto-3)] hover:text-[color:var(--pr-peligro)]">
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <Btn variant="ghost" size="sm" className="mt-2" icon={<Plus className="w-3.5 h-3.5" aria-hidden />} onClick={agregarRegla}>
              Añadir regla
            </Btn>
          </section>

          <section className="border-t border-[color:var(--pr-borde-suave)] pt-5">
            <label className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--pr-texto-2)]">
              <input type="checkbox" checked={lateFeeEnabled} onChange={(e) => setLateFeeEnabled(e.target.checked)} />
              Cobrar recargo por atraso
            </label>
            <p className="text-[11px] text-[color:var(--pr-texto-3)] mt-1 mb-3">
              Apagado por default. Nunca se cobra solo: quien cobra ve el monto sugerido y decide si lo suma.
            </p>
            {lateFeeEnabled ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[color:var(--pr-texto-2)]">
                  Tipo
                  <select
                    value={lateFeeType}
                    onChange={(e) => setLateFeeType(e.target.value as TipoValorRecargo)}
                    className={`${orto.entrada} mt-1 w-full`}
                  >
                    <option value="PCT">% de la mensualidad</option>
                    <option value="FIJO">Monto fijo</option>
                  </select>
                </label>
                <label className="text-xs text-[color:var(--pr-texto-2)]">
                  {lateFeeType === "PCT" ? "Porcentaje" : "Monto (MXN)"}
                  <input
                    type="number" min={0} step={lateFeeType === "PCT" ? 1 : 10}
                    value={lateFeeValue}
                    onChange={(e) => setLateFeeValue(Math.max(0, Number(e.target.value) || 0))}
                    className={`${orto.entrada} mt-1 w-full`}
                  />
                </label>
                <label className="text-xs text-[color:var(--pr-texto-2)] col-span-2">
                  Días de gracia tras el vencimiento
                  <input
                    type="number" min={0} step={1}
                    value={lateFeeGraceDays}
                    onChange={(e) => setLateFeeGraceDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    className={`${orto.entrada} mt-1 w-full`}
                  />
                </label>
              </div>
            ) : null}
          </section>

          {error ? (
            <div className="bg-[color:var(--pr-peligro-suave)] border border-[color:var(--orto-peligro-borde)] rounded-[10px] p-3 text-xs text-[color:var(--pr-peligro)]">{error}</div>
          ) : null}
        </div>

        <footer className={orto.cajonPie}>
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
          <Btn variant="emerald" size="md" icon={<Save className="w-3.5 h-3.5" aria-hidden />} onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar política"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}
