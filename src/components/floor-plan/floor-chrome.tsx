"use client";

import type { CSSProperties, MouseEventHandler, ReactNode, Ref } from "react";
import { X } from "lucide-react";
import s from "./floor-plan.module.css";

/**
 * LA CÁSCARA VISUAL DE UNA PANTALLA DE PISO — NEUTRAL.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 AQUÍ NO SE ESCRIBE NI UNA PALABRA DEL NEGOCIO
 *
 * Ni "doctor" ni "estudiante", ni "sucursal" ni "sede", ni "paciente".
 * Cada pieza recibe sus textos ya resueltos por quien la monta: el dental
 * los saca de su `useT()` (es/en) y el instituto los escribe en su
 * castellano. Un literal de negocio metido aquí obliga a los dos
 * productos a llamar igual a cosas que no lo son —que es justo lo que el
 * vertical institucional lleva una ola entera corrigiendo— y no hay
 * `t()` que valga: esta carpeta no puede saber de qué producto cuelga.
 *
 * Lo que SÍ sabe: qué forma tiene un contador, cuánto respira una
 * tarjeta, de qué color va el borde de un sillón ocupado y dónde queda
 * la etiqueta de un mueble en el lienzo. Eso es "la capa visual", y vive
 * en un solo sitio para que se arregle una sola vez.
 *
 * ── CERO ESTADO, CERO RED ──────────────────────────────────────────────
 * Ninguna pieza de este archivo pide nada, guarda nada ni decide nada:
 * son funciones de props a JSX. El día que una necesite un `useEffect`
 * probablemente es que pertenece a uno de los dos productos y no aquí.
 *
 * ── EL TONO ────────────────────────────────────────────────────────────
 * Los tres estados de un sillón (libre · próximo · ocupado) son los
 * MISMOS en los dos productos —es el piso, no el vocabulario—, así que el
 * `FloorTone` sí viaja. Lo que cambia es cómo se llaman en pantalla, y
 * eso llega como `label`.
 */

export type FloorTone = "libre" | "proximo" | "ocupado" | "neutral" | "accent";

const TONE_CLASS: Record<FloorTone, string> = {
  libre: s.toneLibre,
  proximo: s.toneProximo,
  ocupado: s.toneOcupado,
  neutral: s.toneNeutral,
  accent: s.toneAccent,
};

/** La clase del tono, para las piezas que componen su propia raíz. */
export function floorToneClass(tone: FloorTone | undefined): string {
  return TONE_CLASS[tone ?? "neutral"];
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LA BARRA
// ═══════════════════════════════════════════════════════════════════════

export function FloorBar({
  children,
  bare = false,
  className,
  style,
}: {
  children: ReactNode;
  /** true = ya vive dentro de una caja (el topbar del dental es una fila
   *  de la rejilla de su página): sin fondo, sin borde y sin sombra. */
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cx(s.fp, s.bar, bare && s.barBare, className)} style={style}>
      {children}
    </div>
  );
}

/** El hueco elástico que empuja lo que sigue al otro extremo de la barra. */
export function FloorBarSpacer() {
  return <span className={s.barSpacer} aria-hidden="true" />;
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · LOS CONTADORES
// ═══════════════════════════════════════════════════════════════════════

export interface FloorCountItem {
  key: string;
  /** Cómo se llama este estado en la pantalla que lo monta. */
  label: string;
  count: number;
  tone: FloorTone;
  /** Texto largo del `title` (qué significa el estado). Opcional. */
  detail?: string;
}

/**
 * Cuántos sillones hay en cada estado.
 *
 * 🔴 `aria-live="polite"` y no `assertive`: esto cambia cada veinte
 * segundos y un lector de pantalla que interrumpa cada vez es inusable.
 * El número también se lee entero (`3 libres`) porque un `<b>` suelto no
 * dice de qué.
 */
export function FloorCounters({
  items,
  ariaLabel,
}: {
  items: FloorCountItem[];
  ariaLabel?: string;
}) {
  return (
    <ul className={cx(s.fp, s.counts)} role="status" aria-live="polite" aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.key} className={cx(s.count, floorToneClass(it.tone))} title={it.detail}>
          <span className={s.countValue}>{it.count}</span> {it.label}
        </li>
      ))}
    </ul>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL PULSO
// ═══════════════════════════════════════════════════════════════════════

/**
 * "En vivo · 14:32:05" con su puntito, o el mismo renglón en rojo cuando
 * el sondeo se cayó. Nunca se dice solo con color: el texto lo dice.
 */
export function FloorPulse({ live, text }: { live: boolean; text: string }) {
  return (
    <p className={cx(s.fp, s.pulse, !live && s.pulseBroken)}>
      <span className={s.pulseDot} aria-hidden="true" />
      {text}
    </p>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · NOTAS Y LEYENDA
// ═══════════════════════════════════════════════════════════════════════

export function FloorNote({
  children,
  tone = "accent",
  role,
}: {
  children: ReactNode;
  tone?: FloorTone;
  role?: "status" | "alert";
}) {
  return (
    <p className={cx(s.fp, s.note, floorToneClass(tone))} role={role}>
      {children}
    </p>
  );
}

export interface FloorLegendItem {
  key: string;
  label: string;
  detail?: string;
  tone: FloorTone;
}

export function FloorLegend({
  items,
  help,
  title,
}: {
  items: FloorLegendItem[];
  /** El renglón de ayuda que cierra la leyenda. Opcional. */
  help?: ReactNode;
  /** Encabezado de la leyenda ("Cómo se lee el piso"). Opcional: la
   *  pantalla que solo enseña tres puntos con su palabra no lo necesita. */
  title?: ReactNode;
}) {
  return (
    <ul className={cx(s.fp, s.legend)}>
      {title ? <li className={s.legendTitle}>{title}</li> : null}
      {items.map((it) => (
        <li key={it.key} className={floorToneClass(it.tone)}>
          <span className={s.legendDot} aria-hidden="true" />
          <span>
            <b>{it.label}</b>
            {it.detail ? ` — ${it.detail}` : ""}
          </span>
        </li>
      ))}
      {help ? <li className={s.legendHelp}>{help}</li> : null}
    </ul>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LOS PANELES
// ═══════════════════════════════════════════════════════════════════════

export function FloorPanel({
  children,
  scroll = false,
  flush = false,
  className,
  style,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  /** El panel se desplaza por dentro en vez de crecer. */
  scroll?: boolean;
  /** Sin caja: el anfitrión ya le puso una (columna de la página). */
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "aside" | "section";
  "aria-label"?: string;
}) {
  return (
    <Tag
      className={cx(s.fp, s.panel, scroll && s.panelScroll, flush && s.panelFlush, className)}
      style={style}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function FloorPanelTitle({ children }: { children: ReactNode }) {
  return <p className={s.panelTitle}>{children}</p>;
}

export function FloorPanelHelp({ children }: { children: ReactNode }) {
  return <p className={s.panelHelp}>{children}</p>;
}

export function FloorPanelGroup({
  label,
  children,
  divider = false,
}: {
  label?: ReactNode;
  children: ReactNode;
  divider?: boolean;
}) {
  return (
    <div className={cx(s.panelGroup, divider && s.panelDivider)}>
      {label ? <p className={s.panelGroupLabel}>{label}</p> : null}
      {children}
    </div>
  );
}

export function FloorPanelEmpty({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cx(s.fp, s.panelEmpty)}>
      {icon}
      {title ? <strong>{title}</strong> : null}
      {children ? <span>{children}</span> : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · LA PALETA DE ELEMENTOS
// ═══════════════════════════════════════════════════════════════════════

export function FloorPalette({ children }: { children: ReactNode }) {
  return <div className={s.palette}>{children}</div>;
}

/**
 * Un elemento del catálogo.
 *
 * ⚠️ `icon` del catálogo es un FRAGMENTO de SVG (rects y paths sueltos),
 * no un `<svg>` completo: hay que envolverlo con su viewBox 40×40 o el
 * navegador no pinta nada. Lo envuelve esta pieza, para que ninguno de
 * los dos productos tenga que acordarse.
 *
 * Es un `<button>` y no un `<div>` a propósito: los dos editores lo
 * arrastran con el ratón, pero así al menos se puede llegar con el
 * tabulador y se ve el foco.
 */
export function FloorPaletteItem({
  icon,
  label,
  badge,
  active = false,
  title,
  onMouseDown,
  onClick,
}: {
  /** Fragmento SVG del catálogo (sin `<svg>`). */
  icon: string;
  label: string;
  /** Contador opcional a pie de tarjeta ("2/5"). */
  badge?: ReactNode;
  active?: boolean;
  title?: string;
  onMouseDown?: MouseEventHandler<HTMLButtonElement>;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      className={cx(s.paletteItem, active && s.paletteItemOn)}
      title={title ?? label}
      aria-pressed={active}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <svg className={s.paletteIcon} viewBox="0 0 40 40" width={34} height={34} aria-hidden="true">
        <g dangerouslySetInnerHTML={{ __html: icon }} />
      </svg>
      <span className={s.paletteLabel}>{label}</span>
      {badge !== undefined && badge !== null ? (
        <span className={s.paletteBadge}>{badge}</span>
      ) : null}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · LAS TARJETAS POR SILLÓN
// ═══════════════════════════════════════════════════════════════════════

/** Rejilla que se acomoda sola: en una columna estrecha cae a una sola. */
export function FloorChairGrid({ children }: { children: ReactNode }) {
  return <div className={cx(s.fp, s.chairGrid)}>{children}</div>;
}

/** Una columna, para el panel lateral. */
export function FloorChairColumn({ children }: { children: ReactNode }) {
  return <div className={cx(s.fp, s.chairColumn)}>{children}</div>;
}

export function FloorChairCard({
  name,
  prefix,
  stateLabel,
  tone,
  onOpen,
  openTitle,
  highlighted = false,
  cardRef,
  children,
}: {
  name: string;
  /** Lo que va antes del nombre (el número del sillón, por ejemplo). */
  prefix?: ReactNode;
  /** El estado, ESCRITO. Nunca se dice solo con el punto de color. */
  stateLabel: string;
  tone: FloorTone;
  /** Si se pasa, el nombre es un botón. */
  onOpen?: () => void;
  openTitle?: string;
  /**
   * Señalada: se le pone un canto para que se distinga del resto de la
   * columna. La usa quien clica un sillón EN EL PISO y quiere que la
   * respuesta sea la tarjeta que este panel ya estaba pintando — no una
   * ficha nueva, así que no toca ningún dato.
   */
  highlighted?: boolean;
  /** Para traerla a la vista cuando se la señala desde fuera. */
  cardRef?: Ref<HTMLElement>;
  children?: ReactNode;
}) {
  const head = (
    <>
      {prefix}
      <span className={s.chairNameText}>{name}</span>
    </>
  );
  return (
    <article
      ref={cardRef}
      className={cx(s.fp, s.chairCard, floorToneClass(tone), highlighted && s.chairCardPicked)}
    >
      <header className={s.chairHead}>
        {onOpen ? (
          <button
            type="button"
            className={cx(s.chairName, s.chairNameButton)}
            onClick={onOpen}
            title={openTitle}
          >
            {head}
          </button>
        ) : (
          <span className={s.chairName}>{head}</span>
        )}
        <span className={s.chairBadge}>
          <span className={s.chairDot} aria-hidden="true" />
          {stateLabel}
        </span>
      </header>
      {children}
    </article>
  );
}

/** El número del sillón, para el `prefix` de la tarjeta. */
export function FloorChairNumber({ children }: { children: ReactNode }) {
  return <span className={s.chairNum}>{children}</span>;
}

export function FloorChairEmpty({ children }: { children: ReactNode }) {
  return <p className={s.chairEmpty}>{children}</p>;
}

export function FloorSlotList({ children }: { children: ReactNode }) {
  return <ol className={s.slotList}>{children}</ol>;
}

/** Un renglón del horario de un sillón. */
export function FloorSlot({
  start,
  end,
  primary,
  secondary,
  tag,
  active = false,
}: {
  start: string;
  end?: string;
  primary: ReactNode;
  secondary?: ReactNode;
  tag?: ReactNode;
  /** La cita en curso: se resalta con el tono de la tarjeta. */
  active?: boolean;
}) {
  return (
    <li className={cx(s.slot, active && s.slotActive)}>
      <span className={s.slotTime}>
        {start}
        {end ? <span className={s.slotEnd}>–{end}</span> : null}
      </span>
      <span className={s.slotWho}>
        <span className={s.slotPrimary}>{primary}</span>
        {secondary ? <span className={s.slotSecondary}>{secondary}</span> : null}
      </span>
      {tag ? <span className={s.slotTag}>{tag}</span> : <span />}
    </li>
  );
}

/** El cuerpo de una tarjeta de sillón. */
export function FloorCardBody({ children }: { children: ReactNode }) {
  return <div className={s.cardBody}>{children}</div>;
}

/** El dato principal de la tarjeta (el nombre de quien la ocupa). */
export function FloorCardStrong({ children }: { children: ReactNode }) {
  return <p className={s.cardStrong}>{children}</p>;
}

/** El dato de apoyo (tratamiento, hora, quién atiende). */
export function FloorCardMeta({ children }: { children: ReactNode }) {
  return <p className={s.cardMeta}>{children}</p>;
}

/**
 * Cuánto lleva la cita en curso. `value` va de 0 a 1.
 *
 * ⚠️ Toma el color del TONO de la tarjeta que la contiene, así que vive
 * dentro de un `FloorChairCard` o de un `FloorPopCard`. Suelta, cae en el
 * gris neutro de respaldo en vez de romperse.
 */
export function FloorProgress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div
      className={s.progress}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className={s.progressFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · LA TARJETA QUE SE ABRE
// ═══════════════════════════════════════════════════════════════════════

/**
 * La ficha de un sillón: flotando sobre el lienzo (`floating`), pegada al
 * ratón (`pointer`) o en su hueco.
 *
 * El anfitrión pone la posición por estilo en línea cuando flota: solo él
 * sabe qué más hay en esa esquina de SU pantalla.
 */
export function FloorPopCard({
  title,
  stateLabel,
  tone,
  onClose,
  closeLabel,
  variant = "inline",
  style,
  ariaLabel,
  children,
}: {
  title: ReactNode;
  stateLabel?: string;
  tone: FloorTone;
  onClose?: () => void;
  closeLabel?: string;
  variant?: "inline" | "floating" | "pointer";
  style?: CSSProperties;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className={cx(
        s.fp,
        s.pop,
        variant === "floating" && s.popFloating,
        variant === "pointer" && s.popPointer,
        floorToneClass(tone),
      )}
      style={style}
      role={variant === "pointer" ? undefined : "dialog"}
      aria-label={ariaLabel}
    >
      <header className={s.popHead}>
        <div>
          <p className={s.popTitle}>{title}</p>
          {stateLabel ? <span className={s.popState}>{stateLabel}</span> : null}
        </div>
        {onClose ? (
          <button type="button" className={s.popClose} onClick={onClose} aria-label={closeLabel}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div className={s.popBody}>{children}</div>
    </aside>
  );
}

export function FloorPopLabel({ children }: { children: ReactNode }) {
  return <p className={s.popLabel}>{children}</p>;
}

export function FloorPopName({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <p className={cx(s.popName, muted && s.popNameMuted)}>{children}</p>;
}

export function FloorPopData({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <p className={s.popData}>
      {label ? <span className={s.popKey}>{label}</span> : null}
      {label ? " " : null}
      {children}
    </p>
  );
}

export function FloorPopClock({
  children,
  strong = false,
}: {
  children: ReactNode;
  strong?: boolean;
}) {
  return <p className={cx(s.popClock, strong && s.popClockStrong)}>{children}</p>;
}

export function FloorPopList({ children }: { children: ReactNode }) {
  return <ul className={s.popList}>{children}</ul>;
}

// ═══════════════════════════════════════════════════════════════════════
// 9 · EL BANCO DE TRABAJO Y LA CAJA DEL MUNDO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Catálogo · lienzo · propiedades. Se estrecha con SU ancho y no con el de
 * la ventana (@container), porque la misma pieza vive a pantalla completa
 * y dentro de una columna.
 *
 * ⚠️ NADA de `position: fixed` aquí dentro: un contenedor de consulta se
 * vuelve su bloque contenedor y lo encierra.
 */
export function FloorWorkbench({ children }: { children: ReactNode }) {
  return <div className={cx(s.fp, s.workbench)}>{children}</div>;
}

/** El hueco con desplazamiento donde vive el SVG del lienzo. */
export function FloorCanvasBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx(s.fp, s.canvasBox, className)}>{children}</div>;
}

/**
 * El hueco del mundo 3D. Le impone el alto al visor del dental, que trae
 * `h-[100dvh]` en línea porque en su propia página ocupa la pantalla
 * entera (ver la nota de la hoja).
 */
export function FloorWorldBox({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx(s.fp, s.world, className)}>{children}</div>;
}

/** El "cargando…" del mundo, para el `loading` del `dynamic()`. */
export function FloorWorldLoading({ children }: { children: ReactNode }) {
  return (
    <div className={cx(s.fp, s.worldLoading)}>
      <span className={s.worldSpin} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
