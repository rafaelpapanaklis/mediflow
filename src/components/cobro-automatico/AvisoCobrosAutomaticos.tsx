"use client";
// Aviso a recepción en Caja (ws1-t6): cobros automáticos con tarjeta que
// Mercado Pago RECHAZÓ (la mensualidad sigue pendiente: se cobra a mano) y
// suscripciones que MP canceló por su lado. Nunca manda nada al paciente.
// Se calla sola si no hay ninguno, si la clínica no usa el cobro automático o si
// la ruta falla. Misma ropa que «Anticipos por revisar» (tokens del panel).

import { useEffect, useState } from "react";
import { CreditCard } from "lucide-react";
import s from "@/components/dashboard/cobros-inventario-rediseno/avisos.module.css";
import type { CobroPorRevisar } from "@/lib/cobro-automatico/servicio.server";
import { pesos, useTextosCobroAutomatico } from "./textos";

export function AvisoCobrosAutomaticos() {
  const t = useTextosCobroAutomatico();
  const [items, setItems] = useState<CobroPorRevisar[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/cobro-automatico/por-revisar")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => vivo && setItems(Array.isArray(d?.items) ? d.items : []))
      .catch(() => vivo && setItems([]));
    return () => {
      vivo = false;
    };
  }, []);

  async function revisado(id: string) {
    setItems((l) => (l ? l.filter((x) => x.id !== id) : l));
    await fetch("/api/cobro-automatico/por-revisar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  if (!items || items.length === 0) return null;

  return (
    <div className={s.aviso} role="alert" data-cobros-automaticos-por-revisar>
      <div className={s.cabeza}>
        <span className={`${s.icono} ${s.iconoPeligro}`}>
          <CreditCard size={16} strokeWidth={1.75} aria-hidden />
        </span>
        <p className={s.titulo}>{t.avisoTitulo(items.length)}</p>
      </div>
      <ul className={s.renglones}>
        {items.slice(0, 5).map((it) => (
          <li key={it.id} className={s.renglon}>
            <span className={s.renglonTextos}>
              <span className={s.renglonNombre}>
                {it.paciente}
                {it.folio ? ` · ${it.folio}` : ""}
              </span>
              <span className={s.renglonMotivo}>{it.motivo}</span>
            </span>
            <span className={s.renglonImporte}>
              {it.monto != null ? pesos(it.monto, t.locale) : ""}{" "}
              <button type="button" className={s.resto} style={{ background: "none", border: 0, cursor: "pointer", padding: 0, textDecoration: "underline" }} onClick={() => revisado(it.id)}>
                {t.revisado}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {items.length > 5 && <p className={s.resto}>+{items.length - 5}</p>}
    </div>
  );
}
