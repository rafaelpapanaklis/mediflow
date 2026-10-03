"use client";
// El aviso del cobro automático con tarjeta DENTRO de los modales de cobro
// (ws1-t6, F1 de la auditoría de dinero: el cobro doble). Se usa en
// «Registrar pago» (billing/payment-modal.tsx) y en el cobro dentro del detalle
// de la factura (factura-un-popup/use-cobro.ts), con la MISMA pieza.
//
// Antes de cobrar, recepción ve qué pasará con el cargo de Mercado Pago:
// «el cargo del 5 de octubre se pausará y se reanuda para el del 5 de noviembre»,
// «con este cobro la factura queda pagada: se cancela», o —el caso inverso—
// «la mensualidad del 5 de octubre ya se cobró con tarjeta: esto sería un
// adelanto», que no deja cobrar sin marcar la casilla (el servidor también lo frena).
//
// Se calla sola (no pinta nada, no bloquea) si la factura no tiene cobro
// automático, falta el SQL, el usuario no puede cobrar o la ruta falla.

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { textoAvisoDeCobro, useTextosCobroAutomatico, type AvisoDeCobroVista } from "./textos";
import s from "./aviso-en-cobro.module.css";

export interface EstadoAvisoCobroAutomatico {
  aviso: AvisoDeCobroVista | null;
  confirmado: boolean;
  setConfirmado: (v: boolean) => void;
  /** Hay que confirmar y no se ha confirmado: el botón de cobrar no debe ir. */
  bloquea: boolean;
}

export function useAvisoCobroAutomatico(invoiceId: string | null, monto: number, activo: boolean): EstadoAvisoCobroAutomatico {
  const [aviso, setAviso] = useState<AvisoDeCobroVista | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    if (!activo || !invoiceId || !(monto > 0)) {
      setAviso(null);
      return;
    }
    let vivo = true;
    // Mientras se teclea el monto, una sola pregunta al dejar de teclear.
    const espera = setTimeout(() => {
      fetch(`/api/cobro-automatico/factura/${encodeURIComponent(invoiceId)}/aviso?monto=${encodeURIComponent(String(monto))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (vivo) setAviso(d?.aviso ?? null);
        })
        .catch(() => {
          if (vivo) setAviso(null);
        });
    }, 350);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [invoiceId, monto, activo]);

  // Otra factura u otro tipo de aviso: la confirmación no se arrastra.
  useEffect(() => {
    setConfirmado(false);
  }, [invoiceId, activo, aviso?.tipo]);

  return { aviso, confirmado, setConfirmado, bloquea: !!aviso?.requiereConfirmar && !confirmado };
}

export function AvisoCobroAutomaticoEnCobro({ estado }: { estado: EstadoAvisoCobroAutomatico }) {
  const t = useTextosCobroAutomatico();
  const a = estado.aviso;
  if (!a) return null;
  return (
    <div className={`${CLASES_MENU} ${s.aviso} ${a.requiereConfirmar ? s.alerta : ""}`} role={a.requiereConfirmar ? "alert" : "status"} data-aviso-cobro-automatico={a.tipo}>
      <span className={s.rotulo}>
        <CreditCard size={13} strokeWidth={2} aria-hidden />
        {t.avisoCobroRotulo}
      </span>
      <p className={s.texto}>{textoAvisoDeCobro(a, t.locale)}</p>
      {a.requiereConfirmar ? (
        <label className={s.confirmar}>
          <input type="checkbox" checked={estado.confirmado} onChange={(e) => estado.setConfirmado(e.target.checked)} />
          <span>{t.avisoCobroConfirmar}</span>
        </label>
      ) : null}
    </div>
  );
}
