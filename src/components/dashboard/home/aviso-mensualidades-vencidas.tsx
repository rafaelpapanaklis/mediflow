"use client";

// Ortodoncia — Recepción (ws1-t5, Ola 1): R3, aviso en la pantalla Hoy de
// mensualidades vencidas. Mismo patrón que
// `@/components/dashboard/billing/aviso-anticipos-por-revisar.tsx`: se calla
// sola si no hay ninguna, y no manda nada al paciente (solo para el equipo).
// Reusa la MISMA lectura que Caja (`listarMensualidadesPorCobrar`, R2) para
// que Hoy y Caja nunca digan un número distinto — no hace falta un endpoint
// nuevo bajo `api/dashboard/home/receptionist/`: se llama la action
// directamente, igual que ya hace `SectionFinance` con `cargarPanelDeCobro`.
//
// El CTA lleva a Caja → Facturas, con el ancla de `ListaMensualidades`
// (`#mensualidades-ortodoncia`, montado por esta misma parte en
// `caja-client.tsx`) para no dejar a recepción buscando la fila a mano.

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import Link from "next/link";
import { listarMensualidadesPorCobrar } from "@/app/actions/orthodontics/recepcion/listarMensualidadesPorCobrar";
// Diseño (ws1-t5): antes pedía `--danger-bg`, que no existe, y caía en un rosa
// fijo (en oscuro, una mancha clara). La ropa solo lee tokens del panel.
import s from "@/components/dashboard/cobros-inventario-rediseno/avisos.module.css";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function AvisoMensualidadesVencidas() {
  const [vencidas, setVencidas] = useState<{ count: number; total: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    listarMensualidadesPorCobrar()
      .then((r) => {
        if (!vivo) return;
        if (!r.ok) {
          setVencidas({ count: 0, total: 0 });
          return;
        }
        const vencidasItems = r.data.items.filter((it) => it.estado === "vencida");
        setVencidas({
          count: vencidasItems.length,
          total: vencidasItems.reduce((s, it) => s + it.monto, 0),
        });
      })
      .catch(() => {
        if (vivo) setVencidas({ count: 0, total: 0 });
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (!vencidas || vencidas.count === 0) return null;

  return (
    <Link
      href="/dashboard/caja?tab=facturas#mensualidades-ortodoncia"
      className={`${s.aviso} ${s.avisoEnlace}`}
      role="alert"
    >
      <span className={`${s.icono} ${s.iconoPeligro}`}>
        <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={s.textos}>
        <span className={s.titulo}>
          {vencidas.count === 1 ? "1 mensualidad vencida" : `${vencidas.count} mensualidades vencidas`}
        </span>
        <span className={s.sub}>Ortodoncia · cobrar en Caja</span>
      </span>
      <span className={`${s.importe} ${s.importePeligro}`}>{fmt.format(vencidas.total)}</span>
      <ChevronRight size={16} strokeWidth={1.75} className={s.flecha} aria-hidden />
    </Link>
  );
}
