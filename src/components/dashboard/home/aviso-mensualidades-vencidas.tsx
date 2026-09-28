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
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { listarMensualidadesPorCobrar } from "@/app/actions/orthodontics/recepcion/listarMensualidadesPorCobrar";

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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        marginBottom: 16,
        borderRadius: 10,
        border: "1px solid var(--danger-strong, #b91c1c)",
        background: "var(--danger-bg, #fef2f2)",
        color: "var(--danger-strong, #b91c1c)",
        fontWeight: 600,
        fontSize: 13,
        textDecoration: "none",
      }}
      role="alert"
    >
      <AlertTriangle size={16} strokeWidth={2} aria-hidden />
      {vencidas.count === 1 ? "1 mensualidad vencida" : `${vencidas.count} mensualidades vencidas`}
      {" · "}
      {fmt.format(vencidas.total)}
    </Link>
  );
}
