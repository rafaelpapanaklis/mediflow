"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import s from "./whatsapp-rediseno.module.css";

/**
 * Piezas compartidas por las cuatro pantallas del rediseño de WhatsApp.
 * Todas leen los tokens `--m2-*` del menú a través de la hoja del módulo;
 * ninguna trae color propio.
 */

// ── Cabecera de pantalla ──────────────────────────────────────────────────────

export function Cabecera({
  icono,
  titulo,
  sub,
  acciones,
}: {
  icono: ReactNode;
  titulo: ReactNode;
  sub?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className={s.cabecera}>
      <div className={s.cabeceraId}>
        <div className={s.cabeceraIcono}>{icono}</div>
        <div>
          <h1 className={s.titulo}>{titulo}</h1>
          {sub && <p className={s.subtitulo}>{sub}</p>}
        </div>
      </div>
      {acciones && <div className={s.acciones}>{acciones}</div>}
    </div>
  );
}

// ── Tarjeta ───────────────────────────────────────────────────────────────────

export function Tarjeta({
  titulo,
  sub,
  accion,
  children,
  id,
  tabla,
}: {
  titulo?: ReactNode;
  sub?: ReactNode;
  accion?: ReactNode;
  children: ReactNode;
  id?: string;
  /** El cuerpo es una tabla: sin aire lateral. */
  tabla?: boolean;
}) {
  const conCabeza = Boolean(titulo || accion);
  return (
    <section className={s.tarjeta} id={id}>
      {conCabeza && (
        <div className={s.tarjetaCabeza}>
          <div className={s.tarjetaTextos}>
            {titulo && <h2 className={s.tarjetaTitulo}>{titulo}</h2>}
            {sub && <p className={s.tarjetaSub}>{sub}</p>}
          </div>
          {accion && <div className={s.tarjetaAccion}>{accion}</div>}
        </div>
      )}
      <div
        className={[
          tabla ? s.tarjetaTabla : s.tarjetaCuerpo,
          !conCabeza && !tabla ? s.tarjetaCuerpoSolo : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </section>
  );
}

// ── Botones ───────────────────────────────────────────────────────────────────

type Variante = "principal" | "secundario" | "suave" | "peligro";

const CLASE_VARIANTE: Record<Variante, string> = {
  principal: s.botonPrincipal,
  secundario: "",
  suave: s.botonSuave,
  peligro: s.botonPeligro,
};

function claseBoton(variante: Variante, peq?: boolean, grande?: boolean, extra?: string) {
  return [s.boton, CLASE_VARIANTE[variante], peq ? s.botonPeq : "", grande ? s.botonGrande : "", extra ?? ""]
    .filter(Boolean)
    .join(" ");
}

export function Boton({
  variante = "secundario",
  peq,
  grande,
  icono,
  children,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  peq?: boolean;
  grande?: boolean;
  icono?: ReactNode;
}) {
  return (
    <button type={type} className={claseBoton(variante, peq, grande, className)} {...rest}>
      {icono}
      {children}
    </button>
  );
}

export function BotonEnlace({
  href,
  variante = "secundario",
  peq,
  icono,
  children,
  className,
  externo,
}: {
  href: string;
  variante?: Variante;
  peq?: boolean;
  icono?: ReactNode;
  children: ReactNode;
  className?: string;
  externo?: boolean;
}) {
  const clase = claseBoton(variante, peq, false, className);
  if (externo) {
    return (
      <a href={href} className={clase} target="_blank" rel="noopener noreferrer">
        {icono}
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={clase}>
      {icono}
      {children}
    </Link>
  );
}

// ── Etiqueta de estado ────────────────────────────────────────────────────────

export type Tono = "success" | "danger" | "warning" | "neutral" | "brand";

const CLASE_TONO: Record<Tono, string> = {
  success: s.etiquetaExito,
  danger: s.etiquetaPeligro,
  warning: s.etiquetaAmbar,
  neutral: s.etiquetaNeutra,
  brand: s.etiquetaVioleta,
};

export function Etiqueta({
  tono,
  punto,
  larga,
  children,
  className,
}: {
  tono: Tono;
  punto?: boolean;
  /** Lleva una frase, no una palabra: se deja partir. */
  larga?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={[s.etiqueta, CLASE_TONO[tono], punto ? s.etiquetaPunto : "", larga ? s.etiquetaLarga : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}

// ── Interruptor ───────────────────────────────────────────────────────────────

export function Interruptor({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={[s.interruptor, on ? s.interruptorActivo : ""].filter(Boolean).join(" ")}
    >
      <span className={s.interruptorPerilla} />
    </button>
  );
}

/** Fila con interruptor + título + descripción (mismo patrón en las cuatro pantallas). */
export function FilaInterruptor({
  on,
  onToggle,
  titulo,
  desc,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  titulo: string;
  desc?: string;
  disabled?: boolean;
}) {
  return (
    <div className={[s.filaInterruptor, on ? s.filaInterruptorActiva : ""].filter(Boolean).join(" ")}>
      <Interruptor on={on} onClick={onToggle} label={titulo} disabled={disabled} />
      <div className={s.filaTextos}>
        <div className={s.filaTitulo}>{titulo}</div>
        {desc && <div className={s.filaDesc}>{desc}</div>}
      </div>
    </div>
  );
}

// ── Nota (información, aviso, bloqueo) ────────────────────────────────────────

export function Nota({
  icono,
  titulo,
  children,
  tono = "info",
  className,
}: {
  icono?: ReactNode;
  titulo?: ReactNode;
  children?: ReactNode;
  tono?: "info" | "alerta" | "peligro";
  className?: string;
}) {
  return (
    <div
      className={[s.nota, tono === "alerta" ? s.notaAlerta : "", tono === "peligro" ? s.notaPeligro : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {icono && <span className={s.notaIcono}>{icono}</span>}
      <div className={s.notaTextos}>
        {titulo && <div className={s.notaTitulo}>{titulo}</div>}
        {children}
      </div>
    </div>
  );
}

// ── Campo de formulario ───────────────────────────────────────────────────────

export function Campo({
  etiqueta,
  obligatorio,
  children,
  pista,
}: {
  etiqueta: ReactNode;
  obligatorio?: boolean;
  children: ReactNode;
  pista?: ReactNode;
}) {
  return (
    <div className={s.campo}>
      <label className={s.campoEtiqueta}>
        {etiqueta}
        {obligatorio && <span className={s.obligatorio}>*</span>}
      </label>
      {children}
      {pista && <p className={s.pista}>{pista}</p>}
    </div>
  );
}

// ── Cargando ──────────────────────────────────────────────────────────────────

export function Cargando({ children }: { children: ReactNode }) {
  return <div className={s.cargando}>{children}</div>;
}
