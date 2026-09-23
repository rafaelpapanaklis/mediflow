"use client";

import { forwardRef } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import s from "./configuracion.module.css";

/**
 * Las piezas que se repiten en Configuración, hechas UNA vez: sección,
 * campo, entrada, interruptor, botón, aviso, insignia, chip, fila de
 * datos. Los trece archivos de /dashboard/settings las aplican; ninguno
 * pinta una tarjeta o un botón por su cuenta.
 *
 * Solo visten: no saben qué se guarda, ni validan, ni deciden permisos.
 * Todo eso sigue en el archivo que las usa.
 */

export type Tono = "neutro" | "info" | "exito" | "alerta" | "peligro" | "violeta";

const cx = (...clases: Array<string | false | null | undefined>) =>
  clases.filter(Boolean).join(" ");

/* ── Encabezado de pantalla ───────────────────────────────────────── */

export function Encabezado({
  titulo,
  subtitulo,
  icono,
  acciones,
  volver,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  icono?: ReactNode;
  acciones?: ReactNode;
  /** Enlace «volver» encima del título (subpantallas de Configuración). */
  volver?: { href: string; texto: ReactNode };
}) {
  return (
    <>
      {volver && (
        <Link href={volver.href} className={s.volver}>
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
          {volver.texto}
        </Link>
      )}
      <header className={s.cabecera}>
        <div className={s.cabeceraTextos}>
          <h1 className={s.titulo}>
            {icono}
            {titulo}
          </h1>
          {subtitulo && <p className={s.subtitulo}>{subtitulo}</p>}
        </div>
        {acciones && <div className={s.cabeceraAcciones}>{acciones}</div>}
      </header>
    </>
  );
}

/* ── Navegación lateral (los apartados de Configuración) ──────────── */

export function Navegacion<T extends string>({
  items,
  activo,
  onCambiar,
}: {
  items: { id: T; label: string; icono?: ReactNode }[];
  activo: T;
  onCambiar: (id: T) => void;
}) {
  return (
    <div className={s.navCaja}>
      <nav className={s.nav} aria-label="Apartados">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onCambiar(item.id)}
            className={cx(s.navItem, activo === item.id && s.navItemActivo)}
            aria-current={activo === item.id ? "page" : undefined}
          >
            {item.icono}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Cuerpo({ children }: { children: ReactNode }) {
  return <div className={s.cuerpo}>{children}</div>;
}

export function Contenido({ children }: { children: ReactNode }) {
  return <div className={s.contenido}>{children}</div>;
}

export function Columna({ children }: { children: ReactNode }) {
  return <div className={s.columna}>{children}</div>;
}

export function Rejilla({ children }: { children: ReactNode }) {
  return <div className={s.rejilla}>{children}</div>;
}

/* ── Sección ──────────────────────────────────────────────────────── */

export function Seccion({
  titulo,
  subtitulo,
  icono,
  tonoIcono,
  extra,
  nota,
  pie,
  pieIzquierda,
  apagada = false,
  sinRelleno = false,
  children,
}: {
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  /** Ícono a la izquierda del título (va dentro de una caja violeta). */
  icono?: ReactNode;
  /** Color de esa caja cuando no es violeta (éxito, alerta, peligro, info). */
  tonoIcono?: "exito" | "alerta" | "peligro" | "info";
  /** Lo que va a la derecha de la cabecera: una insignia, un botón. */
  extra?: ReactNode;
  /** Un aviso entre la cabecera y el cuerpo, que NO se atenúa con `apagada`. */
  nota?: ReactNode;
  /** Acciones del pie (normalmente el botón de guardar). */
  pie?: ReactNode;
  /** Lo que va a la izquierda del pie (una insignia de plan, un enlace). */
  pieIzquierda?: ReactNode;
  /** Solo lectura: el cuerpo se ve completo pero no se puede tocar. */
  apagada?: boolean;
  /** Para tablas: el cuerpo sin padding. */
  sinRelleno?: boolean;
  children?: ReactNode;
}) {
  return (
    <section className={s.seccion}>
      {(titulo || extra) && (
        <div className={s.seccionCabeza}>
          {icono && (
            <div
              className={cx(
                s.iconoCaja,
                tonoIcono === "exito" && s.iconoCajaExito,
                tonoIcono === "alerta" && s.iconoCajaAlerta,
                tonoIcono === "peligro" && s.iconoCajaPeligro,
                tonoIcono === "info" && s.iconoCajaInfo,
              )}
            >
              {icono}
            </div>
          )}
          <div className={s.seccionTextos}>
            {titulo && <h2 className={s.seccionTitulo}>{titulo}</h2>}
            {subtitulo && <p className={s.seccionSub}>{subtitulo}</p>}
          </div>
          {extra && <div className={s.seccionExtra}>{extra}</div>}
        </div>
      )}
      {nota && <div className={s.seccionNota}>{nota}</div>}
      {children !== undefined && (
        <div
          className={cx(s.seccionCuerpo, apagada && s.seccionCuerpoApagado)}
          style={sinRelleno ? { padding: 0, gap: 0 } : undefined}
        >
          {children}
        </div>
      )}
      {(pie || pieIzquierda) && (
        <div className={s.seccionPie}>
          {pieIzquierda && <div className={s.seccionPieIzquierda}>{pieIzquierda}</div>}
          {pie}
        </div>
      )}
    </section>
  );
}

export function SubtituloGrupo({ children }: { children: ReactNode }) {
  return <h3 className={s.subtituloGrupo}>{children}</h3>;
}

/* ── Campo ────────────────────────────────────────────────────────── */

export function Campo({
  etiqueta,
  ayuda,
  obligatorio = false,
  derecha,
  children,
}: {
  etiqueta?: ReactNode;
  /** Texto de ayuda debajo de la entrada. */
  ayuda?: ReactNode;
  obligatorio?: boolean;
  /** Algo a la derecha de la etiqueta (p. ej. «Restaurar predeterminado»). */
  derecha?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={s.campo}>
      {etiqueta && (
        <label className={s.campoEtiqueta}>
          <span>
            {etiqueta}
            {obligatorio && <span className={s.campoObligatorio}> *</span>}
          </span>
          {derecha}
        </label>
      )}
      {children}
      {ayuda && <p className={s.campoAyuda}>{ayuda}</p>}
    </div>
  );
}

export function Campos2({ children }: { children: ReactNode }) {
  return <div className={s.campos2}>{children}</div>;
}

export const Entrada = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { mayusculas?: boolean; corta?: boolean }
>(function Entrada({ className, mayusculas = false, corta = false, ...resto }, ref) {
  return (
    <input
      ref={ref}
      {...resto}
      className={cx(s.entrada, mayusculas && s.entradaMayusculas, corta && s.entradaCorta, className)}
    />
  );
});

export function Selector({ className, children, ...resto }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...resto} className={cx(s.entrada, className)}>
      {children}
    </select>
  );
}

export function Area({ className, ...resto }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...resto} className={cx(s.entrada, s.entradaArea, className)} />;
}

export const Archivo = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Archivo({ className, ...resto }, ref) {
    return <input ref={ref} type="file" {...resto} className={cx(s.archivo, className)} />;
  },
);

/** Una opción de radio con su texto. */
export function Opcion({
  children,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  return (
    <label className={s.opcion}>
      <input {...resto} />
      <span>{children}</span>
    </label>
  );
}

export function Opciones({ children }: { children: ReactNode }) {
  return <div className={s.opciones}>{children}</div>;
}

/* ── Interruptor ──────────────────────────────────────────────────── */

export function Interruptor({
  activo,
  onCambiar,
  etiqueta,
  disabled = false,
}: {
  activo: boolean;
  onCambiar: (siguiente: boolean) => void;
  /** aria-label del botón. */
  etiqueta: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={() => onCambiar(!activo)}
      className={s.interruptor}
    >
      <span className={s.interruptorBola} />
    </button>
  );
}

/** Fila con título, descripción y el interruptor a la derecha. */
export function FilaInterruptor({
  titulo,
  descripcion,
  activo,
  onCambiar,
  disabled = false,
}: {
  titulo: string;
  descripcion?: ReactNode;
  activo: boolean;
  onCambiar: (siguiente: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={s.interruptorFila} data-activo={activo ? "true" : "false"}>
      <div className={s.interruptorTextos}>
        <div className={s.interruptorTitulo}>{titulo}</div>
        {descripcion && <div className={s.interruptorDesc}>{descripcion}</div>}
      </div>
      <Interruptor activo={activo} onCambiar={onCambiar} etiqueta={titulo} disabled={disabled} />
    </div>
  );
}

export function Casilla(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" {...props} className={cx(s.casilla, props.className)} />;
}

/** Casilla con su texto al lado (sucursales: «Compartir pacientes»). */
export function CasillaEtiqueta({
  children,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { children: ReactNode }) {
  return (
    <label className={s.casillaEtiqueta} data-ocupado={resto.disabled ? "true" : undefined}>
      <Casilla {...resto} />
      {children}
    </label>
  );
}

/* ── Botones ──────────────────────────────────────────────────────── */

type VarianteBoton = "principal" | "secundario" | "peligro";

export function Boton({
  variante = "secundario",
  corto = false,
  ancho = false,
  className,
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBoton;
  corto?: boolean;
  ancho?: boolean;
}) {
  return (
    <button
      type="button"
      {...resto}
      className={cx(
        s.boton,
        variante === "principal" && s.botonPrincipal,
        variante === "peligro" && s.botonPeligro,
        corto && s.botonCorto,
        ancho && s.botonAncho,
        className,
      )}
    >
      {children}
    </button>
  );
}

/** El botón de guardar: uno solo para todas las secciones. */
export function BotonGuardar({
  guardando,
  texto,
  textoGuardando,
  ...resto
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  guardando: boolean;
  texto: ReactNode;
  textoGuardando: ReactNode;
}) {
  return (
    <Boton variante="principal" {...resto} disabled={guardando || resto.disabled}>
      {guardando ? textoGuardando : texto}
    </Boton>
  );
}

/** Un `<a>` con la pinta de un botón (enlaces externos, OAuth). */
export function EnlaceBoton({
  href,
  variante = "secundario",
  externo = false,
  recto = false,
  children,
}: {
  href: string;
  variante?: VarianteBoton;
  externo?: boolean;
  /** Esquinas rectas, sin redondeo (Rafael, «Configurar anticipos»). */
  recto?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target={externo ? "_blank" : undefined}
      rel={externo ? "noopener noreferrer" : undefined}
      className={cx(s.boton, variante === "principal" && s.botonPrincipal, variante === "peligro" && s.botonPeligro, recto && s.botonRecto)}
    >
      {children}
    </a>
  );
}

/** Enlace de texto violeta (o suave, o de peligro). */
export function Enlace({
  href,
  onClick,
  suave = false,
  peligro = false,
  externo = false,
  disabled = false,
  title,
  children,
}: {
  href?: string;
  onClick?: () => void;
  suave?: boolean;
  peligro?: boolean;
  externo?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const clase = cx(s.enlace, suave && s.enlaceSuave, peligro && s.enlacePeligro);
  if (href) {
    return (
      <a
        href={href}
        className={clase}
        target={externo ? "_blank" : undefined}
        rel={externo ? "noopener noreferrer" : undefined}
        title={title}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={clase} title={title}>
      {children}
    </button>
  );
}

export function Acciones({ children }: { children: ReactNode }) {
  return <div className={s.acciones}>{children}</div>;
}

/* ── Aviso ────────────────────────────────────────────────────────── */

export function Aviso({
  tono = "neutro",
  icono,
  punteado = false,
  children,
}: {
  tono?: Tono;
  icono?: ReactNode;
  punteado?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx(s.aviso, punteado && s.avisoPunteado)} data-tono={tono}>
      {icono}
      <div>{children}</div>
    </div>
  );
}

/* ── Insignia ─────────────────────────────────────────────────────── */

export function Insignia({
  tono = "neutro",
  punto = false,
  children,
}: {
  tono?: Tono;
  punto?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={s.insignia} data-tono={tono}>
      {punto && <span className={s.insigniaPunto} />}
      {children}
    </span>
  );
}

/* ── Chip ─────────────────────────────────────────────────────────── */

export function Chips({ children }: { children: ReactNode }) {
  return <div className={s.chips}>{children}</div>;
}

export function Chip({
  activo = false,
  onQuitar,
  tituloQuitar,
  className,
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  activo?: boolean;
  /** Si viene, el chip trae una «×» para quitarlo (servicios por doctor). */
  onQuitar?: () => void;
  tituloQuitar?: string;
}) {
  if (onQuitar) {
    return (
      <span className={cx(s.chip, s.chipActivo, className)}>
        {children}
        <button type="button" onClick={onQuitar} className={s.chipQuitar} title={tituloQuitar} aria-label={tituloQuitar}>
          ×
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      {...resto}
      aria-pressed={activo}
      className={cx(s.chip, activo && s.chipActivo, className)}
    >
      {children}
    </button>
  );
}

/* ── Filas etiqueta / valor ───────────────────────────────────────── */

export function Filas({ children }: { children: ReactNode }) {
  return <div className={s.filas}>{children}</div>;
}

export function Fila({ etiqueta, children }: { etiqueta: ReactNode; children: ReactNode }) {
  return (
    <div className={s.fila}>
      <span className={s.filaEtiqueta}>{etiqueta}</span>
      <span className={s.filaValor}>{children}</span>
    </div>
  );
}

/* ── Medidor y estadísticas ───────────────────────────────────────── */

export function Barra({ porcentaje, nivel }: { porcentaje: number; nivel?: "alto" | "critico" }) {
  return (
    <div className={s.barra}>
      <div className={s.barraRelleno} data-nivel={nivel} style={{ width: `${Math.max(0, Math.min(100, porcentaje))}%` }} />
    </div>
  );
}

export function Estadisticas({ children }: { children: ReactNode }) {
  return <div className={s.estadisticas}>{children}</div>;
}

export function Estadistica({ valor, etiqueta, tono }: { valor: ReactNode; etiqueta: ReactNode; tono?: Tono }) {
  return (
    <div className={s.estadistica}>
      <div className={s.estadisticaValor} data-tono={tono}>{valor}</div>
      <div className={s.estadisticaEtiqueta}>{etiqueta}</div>
    </div>
  );
}

/* ── Persona ──────────────────────────────────────────────────────── */

export function Persona({ iniciales, nombre, sub }: { iniciales: string; nombre: ReactNode; sub?: ReactNode }) {
  return (
    <div className={s.persona}>
      <div className={s.avatar}>{iniciales}</div>
      <div>
        <div className={s.personaNombre}>{nombre}</div>
        {sub && <div className={s.personaSub}>{sub}</div>}
      </div>
    </div>
  );
}

/* ── Bloques y filas dentro de una sección ────────────────────────── */

export function Bloque({ children }: { children: ReactNode }) {
  return <div className={s.bloque}>{children}</div>;
}

export function BloqueFila({
  activo,
  icono,
  titulo,
  sub,
  derecha,
  children,
}: {
  activo?: boolean;
  icono?: ReactNode;
  titulo?: ReactNode;
  sub?: ReactNode;
  derecha?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={s.bloqueFila} data-activo={activo === undefined ? undefined : activo ? "true" : "false"}>
      {icono}
      {(titulo || sub) && (
        <div className={s.bloqueFilaTexto}>
          {titulo && <div className={s.bloqueFilaTitulo}>{titulo}</div>}
          {sub && <div className={s.bloqueFilaSub}>{sub}</div>}
        </div>
      )}
      {children}
      {derecha}
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className={s.vacio}>{children}</div>;
}

export function Burbuja({ children }: { children: ReactNode }) {
  return <div className={s.burbuja}>{children}</div>;
}
