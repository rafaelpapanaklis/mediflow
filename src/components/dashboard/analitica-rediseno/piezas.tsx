"use client";

import type { CSSProperties, ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2, type LucideIcon } from "lucide-react";
import s from "./analitica.module.css";

/* ═══ Tonos compartidos ═══════════════════════════════════════════════ */

export type Tono = "marca" | "exito" | "alerta" | "peligro" | "neutro";

const CLASE_TONO: Record<Tono, string> = {
  marca: "",
  exito: s.tonoExito,
  alerta: s.tonoAlerta,
  peligro: s.tonoPeligro,
  neutro: s.tonoNeutro,
};

const CLASE_COLOR: Record<Tono, string> = {
  marca: s.marca,
  exito: s.exito,
  alerta: s.alerta,
  peligro: s.peligro,
  neutro: s.apagado,
};

/** Clase de texto para un tono (celdas, cifras sueltas). */
export function colorDe(tono: Tono): string {
  return CLASE_COLOR[tono];
}

export function unir(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(" ");
}

/* ═══ Tarjeta de indicador ════════════════════════════════════════════ */

export interface IndicadorProps {
  label: string;
  value: string;
  delta?: { pct: number; absolute?: string } | null;
  hint?: string;
  icon?: ReactNode;
  tone?: Tono;
  /** Colorea también la cifra (Costos: ingresos / costos / margen). */
  valorConTono?: boolean;
  className?: string;
}

export function Indicador({ label, value, delta, hint, icon, tone = "marca", valorConTono, className }: IndicadorProps) {
  return (
    <div className={unir(s.indicador, className)}>
      <div className={s.indicadorCabeza}>
        <div className={s.indicadorEtiqueta}>{label}</div>
        {icon && (
          <div className={unir(s.indicadorIcono, CLASE_TONO[tone])} aria-hidden>
            {icon}
          </div>
        )}
      </div>
      <div
        className={unir(
          s.indicadorValor,
          valorConTono && s.indicadorValorTono,
          valorConTono && (tone === "marca" ? s.tonoMarca : CLASE_TONO[tone]),
        )}
      >
        {value}
      </div>
      {(delta || hint) && (
        <div className={s.indicadorPie}>
          {delta && <Delta pct={delta.pct} absolute={delta.absolute} />}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

function Delta({ pct, absolute }: { pct: number; absolute?: string }) {
  const sube = pct > 0;
  const plano = pct === 0;
  const Icono = plano ? Minus : sube ? TrendingUp : TrendingDown;
  return (
    <span className={unir(s.delta, !plano && (sube ? s.deltaSube : s.deltaBaja))}>
      <Icono size={14} strokeWidth={1.75} aria-hidden />
      {sube ? "+" : ""}
      {pct.toFixed(0)}%
      {absolute && <span className={s.apagado}>· {absolute}</span>}
    </span>
  );
}

/* ═══ Panel ═══════════════════════════════════════════════════════════ */

export function Panel({
  title,
  right,
  children,
  ajustado,
  className,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  /** Sin relleno: para tablas y listas de filas que van a ras del borde. */
  ajustado?: boolean;
  className?: string;
}) {
  return (
    <section className={unir(s.panel, className)}>
      {(title || right) && (
        <div className={s.panelCabeza}>
          {title && <span className={s.panelTitulo}>{title}</span>}
          {right && <div className={s.panelDerecha}>{right}</div>}
        </div>
      )}
      <div className={unir(s.panelCuerpo, ajustado && s.panelCuerpoAjustado)}>{children}</div>
    </section>
  );
}

/* ═══ Tabla ═══════════════════════════════════════════════════════════ */

export function Tabla({ children }: { children: ReactNode }) {
  return (
    <div className={s.tablaMarco}>
      <table className={s.tabla}>{children}</table>
    </div>
  );
}

export function Th({ children, align = "left" }: { children?: ReactNode; align?: "left" | "right" }) {
  return (
    <th scope="col" className={align === "right" ? s.derecha : undefined}>
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  cifra,
  tono,
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  /** Números: tabular-nums sobre Instrument Sans (nunca monoespaciada). */
  cifra?: boolean;
  tono?: Tono;
  className?: string;
}) {
  return (
    <td className={unir(align === "right" && s.derecha, cifra && s.cifra, tono && CLASE_COLOR[tono], className)}>
      {children}
    </td>
  );
}

/* ═══ Filas (lista corta con divisores) ═══════════════════════════════ */

export function Filas({ children }: { children: ReactNode }) {
  return <div className={s.filas}>{children}</div>;
}

export function Fila({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={unir(s.fila, className)} style={style}>
      {children}
    </div>
  );
}

/* ═══ Etiqueta ════════════════════════════════════════════════════════ */

export function Etiqueta({ children, tono = "neutro" }: { children: ReactNode; tono?: Tono }) {
  const clase = {
    marca: s.etiquetaVioleta,
    exito: s.etiquetaExito,
    alerta: s.etiquetaAlerta,
    peligro: s.etiquetaPeligro,
    neutro: s.etiquetaNeutra,
  }[tono];
  return <span className={unir(s.etiqueta, clase)}>{children}</span>;
}

/* ═══ Filtro de periodo (segmentado) ══════════════════════════════════ */

export function FiltroPeriodo<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ id: T; label: string }>;
}) {
  return (
    <div className={s.segmentado} role="group">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={unir(s.segmento, value === o.id && s.segmentoActivo)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ═══ Selector (etiqueta + select) ════════════════════════════════════ */

export function Selector({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <label className={s.selector}>
      <span className={s.selectorEtiqueta}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={s.campo}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ═══ Botón ═══════════════════════════════════════════════════════════ */

export function Boton({
  children,
  principal,
  chico,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { principal?: boolean; chico?: boolean }) {
  return (
    <button
      type="button"
      className={unir(s.boton, principal && s.botonPrincipal, chico && s.botonChico, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ═══ Aviso ═══════════════════════════════════════════════════════════ */

export function Aviso({
  tono = "info",
  icon: Icono,
  title,
  children,
  pie,
  progreso,
}: {
  tono?: "info" | "alerta" | "peligro" | "ia";
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  pie?: ReactNode;
  /** 0–100: pinta una barra bajo el texto (Resumen: recolectando datos). */
  progreso?: number;
}) {
  const clase = { info: "", alerta: s.avisoAlerta, peligro: s.avisoPeligro, ia: s.avisoIa }[tono];
  return (
    <div className={unir(s.aviso, clase)} role={tono === "peligro" ? "alert" : undefined}>
      <div className={s.avisoIcono} aria-hidden>
        <Icono size={16} strokeWidth={1.75} />
      </div>
      <div className={s.avisoCuerpo}>
        {title && <div className={s.avisoTitulo}>{title}</div>}
        {children && <div className={s.avisoTexto}>{children}</div>}
        {progreso != null && (
          <div className={s.barra} aria-hidden>
            <div className={s.barraRelleno} style={{ width: `${Math.max(0, Math.min(100, progreso))}%` }} />
          </div>
        )}
        {pie && <div className={s.avisoPie}>{pie}</div>}
      </div>
    </div>
  );
}

/* ═══ Estados ═════════════════════════════════════════════════════════ */

export function Vacio({
  icon: Icono,
  title,
  hint,
  peligro,
}: {
  icon: LucideIcon;
  title: ReactNode;
  hint?: ReactNode;
  /** Error de carga (no «sin datos»): mismo bloque, ícono en rojo. */
  peligro?: boolean;
}) {
  return (
    <div className={unir(s.vacio, peligro && s.vacioPeligro)} role={peligro ? "alert" : undefined}>
      <div className={s.vacioIcono} aria-hidden>
        <Icono size={18} strokeWidth={1.75} />
      </div>
      <div className={s.vacioTitulo}>{title}</div>
      {hint && <div className={s.vacioPista}>{hint}</div>}
    </div>
  );
}

export function Cargando({ children }: { children: ReactNode }) {
  return (
    <div className={s.cargando} aria-busy="true">
      <Loader2 size={16} strokeWidth={1.75} className={s.girando} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export function Nota({ children }: { children: ReactNode }) {
  return <div className={s.nota}>{children}</div>;
}
