"use client";
// Ortodoncia — ws1-t4 #75: «Ligar una factura que ya existe». Un presupuesto
// aceptado o una factura del tratamiento hecha en Facturación no abría el caso,
// y «Abrir plan de pago» solo sabía crear otra: quedaban dos del mismo
// tratamiento. Aquí se elige la que ya existe y se liga al caso (nada se crea,
// nada se cancela, nada se cobra).

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { fmtMoney, fmtDate } from "../atoms/format";
import { listarFacturasLigables, type FacturaLigable } from "@/app/actions/orthodontics/cobro/listarFacturasLigables";
import { abrirPlanDePago } from "@/app/actions/orthodontics/cobro/abrirPlanDePago";
import { isFailure } from "@/app/actions/orthodontics/result";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

export interface DrawerLigarFacturaProps {
  treatmentPlanId: string;
  onClose: () => void;
  onLigada: () => void;
}

export function DrawerLigarFactura(props: DrawerLigarFacturaProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  const [facturas, setFacturas] = useState<FacturaLigable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ligando, setLigando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listarFacturasLigables({ treatmentPlanId: props.treatmentPlanId })
      .then((r) => {
        if (!vivo) return;
        if (isFailure(r)) setError(r.error);
        else setFacturas(r.data.facturas);
      })
      .catch(() => { if (vivo) setError("No se pudieron cargar las facturas"); });
    return () => { vivo = false; };
  }, [props.treatmentPlanId]);

  async function ligar(f: FacturaLigable) {
    setLigando(f.id);
    setError(null);
    try {
      const r = await abrirPlanDePago({ treatmentPlanId: props.treatmentPlanId, invoiceId: f.id });
      if (isFailure(r)) { setError(r.error); return; }
      if (r.data.aviso) window.alert(r.data.aviso);
      props.onLigada();
    } finally {
      setLigando(null);
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
        aria-labelledby="drawer-ligar-factura-title"
      >
        <header className={orto.cajonCabeza}>
          <h3 id="drawer-ligar-factura-title" className={orto.cajonTitulo}>Ligar una factura que ya existe</h3>
          <button type="button" onClick={props.onClose} aria-label="Cerrar" className={orto.botonIcono}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          <p className="text-xs text-[color:var(--pr-texto-3)]">
            Elige la factura de este paciente que ya es el tratamiento. Queda como el plan de pago del caso: no se crea ni se cobra nada, y así no quedan dos facturas del mismo tratamiento.
          </p>
          {error ? <p className={`text-xs ${orto.tonoPeligro}`} role="alert">{error}</p> : null}
          {facturas === null && !error ? <p className="text-xs text-[color:var(--pr-texto-3)]">Cargando facturas…</p> : null}
          {facturas !== null && facturas.length === 0 ? (
            <p className="text-xs text-[color:var(--pr-texto-3)]">Este paciente no tiene facturas libres para ligar (las de una cita, las canceladas y las que ya son el plan de otro caso no cuentan).</p>
          ) : null}
          {(facturas ?? []).map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] border border-[color:var(--pr-borde)] text-[13px]">
              <div className="min-w-0">
                <div className="font-medium">{f.invoiceNumber} · {fmtMoney(f.total)}</div>
                <div className="text-xs text-[color:var(--pr-texto-3)] truncate">{f.concepto} · {fmtDate(f.fecha)} · Pagado {fmtMoney(f.paid)}</div>
              </div>
              <Btn variant="secondary" size="sm" onClick={() => ligar(f)} disabled={ligando !== null}>
                {ligando === f.id ? "Ligando..." : "Ligar"}
              </Btn>
            </div>
          ))}
        </div>
        <footer className={orto.cajonPie}>
          <Btn variant="ghost" size="md" onClick={props.onClose}>Cancelar</Btn>
        </footer>
      </aside>
    </>
  );
}
