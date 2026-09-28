"use client";

// Aviso a recepción (ws1-t3 fase 1): anticipos del panel que quedaron
// marcados para revisar — pago tardío con el hueco ya perdido (fue a saldo a
// favor), factura cancelada o ya saldada, segundo pago del mismo anticipo…
// Nunca manda nada al paciente: es SOLO para el equipo. Se queda en silencio
// (sin pintar nada) si no hay ninguno o si la ruta todavía no existe.
//
// Diseño (ws1-t5): la ropa vive en `cobros-inventario-rediseno/avisos.module.css`
// y solo lee tokens del panel. Antes pedía `--warning-bg`, que no existe, y
// caía en un crema fijo: en oscuro era una mancha clara con letra clara.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import s from "@/components/dashboard/cobros-inventario-rediseno/avisos.module.css";

interface Item {
  depositId: string;
  paciente: string;
  monto: number;
  motivo: string;
  creado: string;
}

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function AvisoAnticiposPorRevisar() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/anticipos/por-revisar")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (vivo) setItems(Array.isArray(d?.items) ? d.items : []);
      })
      .catch(() => {
        if (vivo) setItems([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div className={s.aviso} role="alert">
      <div className={s.cabeza}>
        <span className={`${s.icono} ${s.iconoAlerta}`}>
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
        </span>
        <p className={s.titulo}>
          {items.length === 1 ? "1 anticipo por revisar" : `${items.length} anticipos por revisar`}
        </p>
      </div>
      <ul className={s.renglones}>
        {items.slice(0, 5).map((it) => (
          <li key={it.depositId} className={s.renglon}>
            <span className={s.renglonTextos}>
              <span className={s.renglonNombre}>{it.paciente}</span>
              <span className={s.renglonMotivo}>{it.motivo}</span>
            </span>
            <span className={s.renglonImporte}>{fmt.format(it.monto)}</span>
          </li>
        ))}
      </ul>
      {items.length > 5 && <p className={s.resto}>y {items.length - 5} más…</p>}
    </div>
  );
}
