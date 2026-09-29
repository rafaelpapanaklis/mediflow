// Piezas del rediseño de /admin. Server-safe a propósito (sin hooks ni
// handlers): las montan tanto server components (Dashboard) como client
// components (Clínicas, Clientes). Los estilos viven en admin-rediseno.css y
// los tokens los pone el layout de /admin.
import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, type LucideIcon } from "lucide-react";
import { nivelCupo, pctCupo, type NivelCupo } from "@/lib/admin/uso-core";

export type TonoChip = "success" | "warning" | "danger" | "info" | "brand" | "neutral";

export function Chip({ tono = "neutral", punto, children, title, sm }: {
  tono?: TonoChip; punto?: boolean; children: ReactNode; title?: string; sm?: boolean;
}) {
  return (
    <span className={`dcp-chip dcp-chip--${tono}${sm ? " dcp-chip--sm" : ""}`} title={title}>
      {punto && <span className="dcp-chip__punto" aria-hidden />}
      {children}
    </span>
  );
}

export type TonoTile = "brand" | "success" | "warning" | "danger" | "info" | "quieto";

/** Tarjeta grande de color con UN número: lo accionable del Dashboard. */
export function Tile({ href, tono, icono: Icono, n, label, title }: {
  href: string; tono: TonoTile; icono: LucideIcon; n: number | string; label: string; title?: string;
}) {
  return (
    <Link href={href} className={`dcp-tile dcp-tile--${tono}`} title={title}>
      <span className="dcp-tile__icono" aria-hidden><Icono size={24} strokeWidth={2} /></span>
      <span className="dcp-tile__texto">
        <span className="dcp-tile__n dcp-num">{n}</span>
        <span className="dcp-tile__label">{label}</span>
      </span>
    </Link>
  );
}

export function Tarjeta({ title, sub, action, children, sinPadding, pie, className }: {
  title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; sinPadding?: boolean; pie?: ReactNode; className?: string;
}) {
  return (
    <section className={`dcp-card${className ? ` ${className}` : ""}`}>
      {(title || action) && (
        <header className="dcp-card__head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="dcp-card__title">{title}</h2>}
            {sub && <div className="dcp-card__sub">{sub}</div>}
          </div>
          {action}
        </header>
      )}
      <div className={`dcp-card__body${sinPadding ? " dcp-card__body--sin" : ""}`}>{children}</div>
      {pie && <div className="dcp-card__pie">{pie}</div>}
    </section>
  );
}

const CLASE_NIVEL: Record<NivelCupo, string> = { ok: "", aviso: " dcp-barra--aviso", lleno: " dcp-barra--lleno" };

/**
 * Barra de consumo. `usado` null = no se pudo medir y se dice; `tope` null =
 * sin límite: se enseña sólo el usado, sin barra que mienta.
 */
export function BarraUso({ label, usado, tope, fmt, compacta, title }: {
  label?: string; usado: number | null; tope: number | null; fmt: (n: number) => string; compacta?: boolean; title?: string;
}) {
  if (usado === null) return <span className="dcp-uso--sin" title={title}>{label ? `${label}: ` : ""}sin dato</span>;
  const pct = pctCupo(usado, tope);
  const nivel = nivelCupo(usado, tope);
  return (
    <div className="dcp-uso" title={title}>
      <div className="dcp-uso__linea">
        {label && <span className="dcp-uso__label">{label}</span>}
        <span className="dcp-num">
          <strong>{fmt(usado)}</strong>
          {tope !== null && tope > 0 ? <span className="dcp-suave"> / {fmt(tope)}</span> : <span className="dcp-suave"> · sin tope</span>}
          {!compacta && pct !== null && <span className="dcp-suave"> · {pct}%</span>}
        </span>
      </div>
      {pct !== null && (
        <div className={`dcp-barra${CLASE_NIVEL[nivel]}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div className="dcp-barra__relleno" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Sparkline en SVG inline, sin librería: 6–12 puntos, área suave. */
export function Sparkline({ valores, tono = "brand", label, n }: {
  valores: number[]; tono?: "brand" | "success" | "warning" | "danger" | "info" | "neutro"; label: string; n: string | number;
}) {
  const W = 120, H = 34, P = 2;
  const max = Math.max(...valores, 0);
  const pts = valores.map((v, i) => {
    const x = valores.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (valores.length - 1);
    const y = max > 0 ? H - P - (v / max) * (H - 2 * P) : H - P;
    return [x, y] as const;
  });
  const linea = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linea} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  const ultimo = pts[pts.length - 1];
  return (
    <div className={`dcp-spark dcp-spark--${tono}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${valores.join(", ")}`}>
        <path d={area} fill="currentColor" opacity={0.12} style={{ color: "var(--dcp-spark)" }} />
        <path d={linea} fill="none" stroke="var(--dcp-spark)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={ultimo[0]} cy={ultimo[1]} r={2.4} fill="var(--dcp-spark)" />
      </svg>
      <span className="dcp-spark__label">{label}</span>
      <span className="dcp-spark__n dcp-num">{n}</span>
    </div>
  );
}

export function Cifra({ label, n, pie, tono }: { label: string; n: string; pie?: ReactNode; tono?: "success" | "brand" | "warning" }) {
  return (
    <div className="dcp-cifra">
      <div className="dcp-cifra__label">{label}</div>
      <div className={`dcp-cifra__n dcp-num${tono ? ` dcp-cifra__n--${tono}` : ""}`}>{n}</div>
      {pie && <div className="dcp-cifra__pie">{pie}</div>}
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return (
    <div className="dcp-vacio">
      <CheckCircle2 size={18} strokeWidth={2} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** Caja de un dato de la ficha (número grande + pie + barra opcional). */
export function DatoCaja({ label, icono: Icono, n, pie, nivel, barra }: {
  label: string; icono?: LucideIcon; n: ReactNode; pie?: ReactNode; nivel?: NivelCupo; barra?: number | null;
}) {
  return (
    <div className="dcp-dato-caja">
      <div className="dcp-dato-caja__label">{Icono && <Icono size={13} aria-hidden />}{label}</div>
      <div className={`dcp-dato-caja__n dcp-num${nivel && nivel !== "ok" ? ` dcp-dato-caja__n--${nivel}` : ""}`}>{n}</div>
      {pie && <div className="dcp-dato-caja__pie">{pie}</div>}
      {barra !== undefined && barra !== null && (
        <div className={`dcp-barra${nivel ? CLASE_NIVEL[nivel] : ""}`} aria-hidden>
          <div className="dcp-barra__relleno" style={{ width: `${barra}%` }} />
        </div>
      )}
    </div>
  );
}
