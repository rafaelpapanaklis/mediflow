/**
 * Panel de afiliado — PRIMITIVAS COMPARTIDAS.
 *
 * Los patrones que el diseño (Panel-Afiliado-DaleControl.dc.html) repite en
 * todas las pantallas: encabezado de página, tarjeta, encabezado de sección,
 * chip, botón, estado vacío, barra de progreso, KPI y avisos.
 *
 * El estilo NO vive aquí: vive en src/app/afiliados/panel.css con el
 * namespace `dcafp`. Estos componentes solo ponen clases y estructura, así
 * que un cambio de color o de radio se hace en un archivo y llega a las
 * nueve páginas.
 *
 * SERVER-SAFE a propósito: sin "use client", sin hooks ni handlers. Las
 * páginas del panel son server components y tienen que poder importarlas
 * directo. Lo interactivo (copiar al portapapeles) vive en copy-button.tsx.
 */
import type { ReactNode } from "react";

/* ── Encabezado de página ─────────────────────────────────────────────── */

export function PageHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <h1 className="dcafp-pagehead__title">{title}</h1>
        {sub ? <p className="dcafp-pagehead__sub">{sub}</p> : null}
      </div>
      {action}
    </header>
  );
}

/* ── Tarjeta ──────────────────────────────────────────────────────────── */

export function PanelCard({
  title,
  sub,
  action,
  children,
  /** Sin padding: para tarjetas que envuelven una tabla a sangre. */
  flush,
  tight,
  /** Variante destacada (borde morado + sombra) del bloque "EMPIEZA AQUÍ". */
  accent,
  /** Etiqueta flotante sobre el borde superior. Requiere `accent`. */
  tag,
  className,
  style,
}: {
  title?: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  tight?: boolean;
  accent?: boolean;
  tag?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const cls = [
    "dcafp-card",
    flush ? "dcafp-card--flush" : "",
    tight ? "dcafp-card--tight" : "",
    accent ? "dcafp-card--accent" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  // Con `flush` el encabezado necesita su propio padding: la tarjeta no pone
  // ninguno para que la tabla llegue hasta el borde.
  const headStyle: React.CSSProperties | undefined = flush
    ? { padding: "20px 24px 4px" }
    : undefined;

  return (
    <section className={cls} style={style}>
      {tag ? <span className="dcafp-card__tag">{tag}</span> : null}
      {title || action ? (
        <div className="dcafp-cardhead" style={{ ...headStyle, marginBottom: title && !flush ? 14 : undefined }}>
          <div style={{ minWidth: 0 }}>
            {title ? <h2 className="dcafp-h2">{title}</h2> : null}
            {sub ? <p className="dcafp-sub">{sub}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Encabezado de sección suelto (fuera de PanelCard). */
export function SectionHead({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="dcafp-cardhead" style={{ marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}>
        <h2 className="dcafp-h2">{title}</h2>
        {sub ? <p className="dcafp-sub">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** El "COMISIÓN MENSUAL" / "TUS ENLACES" del diseño. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="dcafp-eyebrow">{children}</span>;
}

/**
 * Encabezado de un bloque DENTRO de una tarjeta: icono de marca + eyebrow.
 * Separa las secciones del kit de marketing sin abrir otra `PanelCard`.
 */
export function SectionEyebrow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--dcafp-brand)" }}>
      {icon}
      <Eyebrow>{text}</Eyebrow>
    </div>
  );
}

/* ── Chip de estado ───────────────────────────────────────────────────── */

export type ChipTone = "neutral" | "brand" | "amber" | "ok" | "danger" | "solid";

export function Chip({
  children,
  tone = "neutral",
  dot,
  sm,
}: {
  children: ReactNode;
  tone?: ChipTone;
  /** Punto de color a la izquierda (el "Nivel Bronce" del diseño). */
  dot?: boolean;
  sm?: boolean;
}) {
  const cls = [
    "dcafp-chip",
    tone !== "neutral" ? `dcafp-chip--${tone}` : "",
    sm ? "dcafp-chip--sm" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls}>
      {dot ? <span className="dcafp-chip__dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ── Estado vacío ─────────────────────────────────────────────────────────
   El estado vacío del diseño no es una pared de ceros: es icono, una frase
   que explica QUÉ va a pasar, y la acción que lo desbloquea. Se pide `icon`
   y `title` porque un vacío sin ninguno de los dos vuelve a ser una pared. */

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="dcafp-empty">
      <div className="dcafp-empty__ico" aria-hidden>
        {icon}
      </div>
      <div className="dcafp-empty__title">{title}</div>
      {children ? <p className="dcafp-empty__text">{children}</p> : null}
      {action ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  );
}

/* ── Barra de progreso ────────────────────────────────────────────────────
   `value`/`max` en las unidades reales (clínicas, no porcentaje): la barra
   calcula el ancho y de paso publica los valores accesibles correctos.
   `ticks` parte la pista en tramos iguales — el diseño usa 5. */

export function ProgressBar({
  value,
  max,
  label,
  ticks = 0,
  markers,
}: {
  value: number;
  max: number;
  label: string;
  /** Muescas repartidas: parte la pista en `ticks` tramos iguales. */
  ticks?: number;
  /**
   * Muescas en posiciones CONCRETAS, en las mismas unidades que `value`.
   * Gana sobre `ticks`: una marca sobre un umbral real dice algo ("aquí
   * cobraste el bono anterior"); un reparto en quintos solo da escala.
   */
  markers?: number[];
}) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.min(safeMax, Math.max(0, Number(value) || 0));
  const pct = (safeValue / safeMax) * 100;

  const marks: number[] = [];
  if (markers && markers.length > 0) {
    for (const m of markers) {
      const at = (Number(m) / safeMax) * 100;
      // Fuera de rango o pegada a los bordes: la muesca se confundiría con
      // el borde de la pista.
      if (at > 1 && at < 99) marks.push(at);
    }
  } else {
    // Reparto en `ticks` tramos: por eso van en i/ticks y se salta la del
    // 100% (caería sobre el borde derecho).
    for (let i = 1; i < ticks; i += 1) marks.push((i / ticks) * 100);
  }

  return (
    <div
      className="dcafp-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
      aria-label={label}
    >
      {pct > 0 ? <span className="dcafp-bar__fill" style={{ width: `${pct}%` }} /> : null}
      {marks.map((left) => (
        <span key={left} className="dcafp-bar__tick" style={{ left: `${left}%` }} aria-hidden />
      ))}
    </div>
  );
}

/* ── Cifras ───────────────────────────────────────────────────────────── */

/** Fila de cifras clave bajo una separación. `idle` las apaga a gris. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="dcafp-statrow">{children}</div>;
}

export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "idle" | "ok";
}) {
  const cls = [
    "dcafp-stat__v",
    tone === "idle" ? "dcafp-stat__v--idle" : "",
    tone === "ok" ? "dcafp-stat__v--ok" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <div className="dcafp-stat__k">{label}</div>
      <div className={cls}>{value}</div>
    </div>
  );
}

/** Tarjeta KPI suelta, para las rejillas de estadísticas y equipo. */
export function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="dcafp-kpi">
      <div className="dcafp-kpi__k">{label}</div>
      <div className="dcafp-kpi__v">{value}</div>
      {sub ? <div className="dcafp-kpi__sub">{sub}</div> : null}
    </div>
  );
}

/* ── Avisos ───────────────────────────────────────────────────────────── */

export function Note({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "brand" | "danger" | "ok";
}) {
  const cls = ["dcafp-note", tone !== "neutral" ? `dcafp-note--${tone}` : ""].filter(Boolean).join(" ");
  return <div className={cls}>{children}</div>;
}

/** Pie de nota con icono — el "El conteo debe sostenerse 3 meses…". */
export function Footnote({ children }: { children: ReactNode }) {
  return (
    <p className="dcafp-footnote">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden style={{ color: "var(--dcafp-ink-4)" }}>
        <circle cx="12" cy="12" r="8.6" />
        <path d="M12 11.2v4.6" />
        <path d="M12 7.8h.01" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/* ── Tabla de rejilla ─────────────────────────────────────────────────────
   `cols` son las columnas en ancho completo y `colsSm` las que quedan
   cuando el bloque se estrecha (el @container de panel.css conmuta solas).
   Las celdas prescindibles se marcan con className="dcafp-col-opt" y
   desaparecen en el mismo punto — así no queda una columna vacía. */

export function GridTable({
  cols,
  colsSm,
  head,
  children,
  foot,
}: {
  cols: string;
  colsSm?: string;
  head: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
}) {
  const vars = {
    "--dcafp-cols": cols,
    ...(colsSm ? { "--dcafp-cols-sm": colsSm } : {}),
  } as React.CSSProperties;

  return (
    <div style={vars}>
      <div className="dcafp-thead" role="row">
        {head}
      </div>
      {children}
      {foot ? <div className="dcafp-tfoot">{foot}</div> : null}
    </div>
  );
}

export function GridRow({ children }: { children: ReactNode }) {
  return (
    <div className="dcafp-trow" role="row">
      {children}
    </div>
  );
}
