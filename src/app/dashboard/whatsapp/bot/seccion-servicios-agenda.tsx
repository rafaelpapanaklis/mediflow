"use client";

import Link from "next/link";
import { MAX_MARCADOS_EN_MENU, opcionesPedidas, TIPOS_GENERICOS, type GenericasBot } from "@/lib/whatsapp/bot/menu-agenda-core";
import { useTextosServiciosAgenda } from "./textos-servicios-agenda";

/** ws1-t9 — «Servicios al agendar»: casillas genéricas + enlace al catálogo + lista de solo lectura. Las dos vistas de Configurar bot la comparten. */
export function SeccionServiciosAgenda({
  genericas,
  onChange,
  disponible,
  disabled,
  procedimientos,
}: {
  genericas: GenericasBot;
  onChange: (g: GenericasBot) => void;
  /** false = falta pegar el SQL. */
  disponible: boolean;
  disabled?: boolean;
  procedimientos: string[];
}) {
  const tx = useTextosServiciosAgenda();
  const pedidas = opcionesPedidas(genericas, procedimientos.length);
  const pasa = pedidas > MAX_MARCADOS_EN_MENU;
  const nada = pedidas === 0;
  const muted = { color: "var(--text-3)", fontSize: 12.5, lineHeight: 1.5, margin: 0 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="servicios-al-agendar">
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-1)" }}>{tx.titulo}</div>
        <p style={muted}>{tx.intro}</p>
        {!disponible && <p style={muted}>{tx.sqlPendiente}</p>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {TIPOS_GENERICOS.map((t) => (
          <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: disabled || !disponible ? "default" : "pointer" }}>
            <input
              type="checkbox"
              checked={genericas[t]}
              disabled={disabled || !disponible}
              onChange={(e) => onChange({ ...genericas, [t]: e.target.checked })}
            />
            {tx[t]}
          </label>
        ))}
      </div>
      <p style={muted}>
        {tx.catalogoPregunta}{" "}
        <Link href="/dashboard/procedures" style={{ fontWeight: 600, textDecoration: "underline" }}>
          {tx.irCatalogo}
        </Link>
      </p>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-2)", marginBottom: 4 }}>{tx.marcadosTitulo}</div>
        {procedimientos.length === 0 ? (
          <p style={muted}>{tx.sinMarcados}</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text-2)" }}>
            {procedimientos.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
      {pasa && (
        <p role="alert" style={{ ...muted, color: "var(--danger, #b45309)" }}>
          {tx.pasaDelTope(pedidas, MAX_MARCADOS_EN_MENU)}
        </p>
      )}
      {nada && <p style={muted}>{tx.nadaMarcado}</p>}
    </div>
  );
}
