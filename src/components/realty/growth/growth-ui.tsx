"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas de las pantallas de CRECIMIENTO del vertical.
//
// Estilo del vertical (mismo criterio que components/realty/calc/ui.tsx):
// estilos en línea con los tokens de realty-theme.css y medidas en PX — la
// raíz del panel mide 13px, así que un `rem` aquí no mide lo que uno cree.
// Nada de @media: el contenedor .realty-page declara container-type, así
// que las consultas son @container realty.
//
// 🔴 EL MODAL VA EN createPortal Y NO ES UN CAPRICHO. `.realty-page` declara
// `container-type: inline-size`, y un contenedor de consulta ATRAPA
// cualquier `position: fixed` de dentro: el modal se posicionaría contra la
// tarjeta en vez de contra la ventana y saldría cortado a la mitad. El
// portal lo saca al <body>, fuera del contenedor.
//
// Tokens disponibles: --bg, --bg-elev, --bg-elev-2, --bg-hover, --text-1..4,
// --border-soft/strong/brand, --brand*, --danger, --shadow-1..3, --ring.
// NO existe un token de "éxito": el verde de este archivo es explícito.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Copy, Info, X } from "lucide-react";

/* ── Contenedores ───────────────────────────────────────────────────── */

export function Tarjeta({
  children,
  titulo,
  sub,
  accion,
  padded = true,
}: {
  children: ReactNode;
  titulo?: string;
  sub?: string;
  accion?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {(titulo || accion) && (
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid var(--border-soft)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            {titulo && (
              <h2
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--text-1)",
                  letterSpacing: "-0.01em",
                }}
              >
                {titulo}
              </h2>
            )}
            {sub && (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 12.5,
                  color: "var(--text-3)",
                  lineHeight: 1.55,
                  maxWidth: 640,
                }}
              >
                {sub}
              </p>
            )}
          </div>
          {accion}
        </header>
      )}
      <div style={padded ? { padding: 18 } : undefined}>{children}</div>
    </section>
  );
}

export function Rejilla({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

export function Encabezado({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <header>
      <h1
        style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 800,
          color: "var(--text-1)",
          letterSpacing: "-0.02em",
        }}
      >
        {titulo}
      </h1>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: 13,
          color: "var(--text-3)",
          lineHeight: 1.6,
          maxWidth: 720,
        }}
      >
        {sub}
      </p>
    </header>
  );
}

/* ── Avisos ─────────────────────────────────────────────────────────── */

export type AvisoTono = "info" | "alerta" | "malo" | "bueno";

const TONO: Record<AvisoTono, { fondo: string; borde: string; texto: string }> = {
  info: { fondo: "var(--bg-elev-2)", borde: "var(--border-soft)", texto: "var(--text-2)" },
  alerta: { fondo: "rgba(217, 119, 6, 0.10)", borde: "rgba(217, 119, 6, 0.35)", texto: "#b45309" },
  malo: { fondo: "rgba(220, 38, 38, 0.10)", borde: "rgba(220, 38, 38, 0.35)", texto: "var(--danger)" },
  bueno: { fondo: "rgba(22, 163, 74, 0.10)", borde: "rgba(22, 163, 74, 0.32)", texto: "#15803d" },
};

export function Aviso({
  children,
  tono = "info",
  icono = true,
}: {
  children: ReactNode;
  tono?: AvisoTono;
  icono?: boolean;
}) {
  const c = TONO[tono];
  const Icon = tono === "info" ? Info : tono === "bueno" ? Check : AlertTriangle;
  return (
    <div
      role={tono === "malo" ? "alert" : undefined}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "11px 13px",
        borderRadius: 12,
        background: c.fondo,
        border: `1px solid ${c.borde}`,
        color: c.texto,
        fontSize: 12.5,
        lineHeight: 1.6,
      }}
    >
      {icono && <Icon size={15} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Pantalla completa de "no puedes ver esto" — la usan las tres páginas. */
export function PaginaAviso({ texto }: { texto: string }) {
  return (
    <div className="realty-page">
      <div
        style={{
          padding: 20,
          borderRadius: 14,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-2)",
          fontSize: 13.5,
          lineHeight: 1.6,
          maxWidth: 620,
        }}
      >
        {texto}
      </div>
    </div>
  );
}

/* ── Etiquetas ──────────────────────────────────────────────────────── */

export function Pastilla({
  children,
  tono = "info",
}: {
  children: ReactNode;
  tono?: AvisoTono;
}) {
  const c = TONO[tono];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: 999,
        background: c.fondo,
        border: `1px solid ${c.borde}`,
        color: c.texto,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* ── Campos ─────────────────────────────────────────────────────────── */

export const inputBase: CSSProperties = {
  width: "100%",
  height: 38,
  background: "var(--bg)",
  color: "var(--text-1)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  padding: "0 11px",
  fontSize: 13.5,
  outline: "none",
  fontFamily: "inherit",
};

export const areaBase: CSSProperties = {
  ...inputBase,
  height: "auto",
  minHeight: 92,
  padding: "10px 11px",
  lineHeight: 1.55,
  resize: "vertical",
};

export function Campo({
  label,
  hint,
  htmlFor,
  children,
  error,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.01em" }}
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.5 }}>{hint}</p>
      )}
      {error && (
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--danger)", lineHeight: 1.5 }}>{error}</p>
      )}
    </div>
  );
}

/** Interruptor accesible. Nace del valor que le pasen: no guarda estado. */
export function Interruptor({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start", minWidth: 0 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        style={{
          flexShrink: 0,
          width: 40,
          height: 23,
          borderRadius: 999,
          border: "1px solid var(--border-strong)",
          background: checked ? "var(--brand)" : "var(--bg-elev-2)",
          position: "relative",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          transition: "background 140ms ease",
          padding: 0,
          marginTop: 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 19 : 2,
            width: 17,
            height: 17,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,.25)",
            transition: "left 140ms ease",
          }}
        />
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", lineHeight: 1.4 }}>
          {label}
        </div>
        {hint && (
          <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.55 }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Botones ────────────────────────────────────────────────────────── */

export type BotonTono = "primario" | "normal" | "peligro" | "fantasma";

export function Boton({
  children,
  onClick,
  tono = "normal",
  disabled = false,
  type = "button",
  pequeno = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tono?: BotonTono;
  disabled?: boolean;
  type?: "button" | "submit";
  pequeno?: boolean;
  title?: string;
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: pequeno ? 30 : 36,
    padding: pequeno ? "0 11px" : "0 15px",
    borderRadius: 10,
    fontSize: pequeno ? 12 : 13,
    fontWeight: 650,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    whiteSpace: "nowrap",
    transition: "filter 120ms ease",
  };
  const tonos: Record<BotonTono, CSSProperties> = {
    primario: { ...base, background: "var(--brand)", color: "#fff", border: "1px solid var(--brand)" },
    normal: {
      ...base,
      background: "var(--bg-elev-2)",
      color: "var(--text-1)",
      border: "1px solid var(--border-soft)",
    },
    peligro: {
      ...base,
      background: "transparent",
      color: "var(--danger)",
      border: "1px solid rgba(220,38,38,.4)",
    },
    fantasma: {
      ...base,
      background: "transparent",
      color: "var(--text-2)",
      border: "1px solid transparent",
    },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} style={tonos[tono]}>
      {children}
    </button>
  );
}

/** Copia al portapapeles y avisa. Vuelve solo a su estado después de 2 s. */
export function BotonCopiar({ texto, label, labelOk }: { texto: string; label: string; labelOk: string }) {
  const [ok, setOk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Limpiar el temporizador al desmontar: sin esto, copiar y salir de la
  // pestaña deja un setState sobre un componente muerto.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <Boton
      pequeno
      onClick={() => {
        // navigator.clipboard no existe fuera de https ni en algunos WebViews.
        void navigator.clipboard
          ?.writeText(texto)
          .then(() => {
            setOk(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setOk(false), 2000);
          })
          .catch(() => undefined);
      }}
    >
      {ok ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {ok ? labelOk : label}
    </Boton>
  );
}

/* ── Cifras ─────────────────────────────────────────────────────────── */

export function Cifra({
  label,
  valor,
  hint,
  tono,
}: {
  label: string;
  valor: string;
  hint?: string;
  tono?: AvisoTono;
}) {
  return (
    <div
      style={{
        padding: "13px 15px",
        borderRadius: 13,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 650,
          color: "var(--text-4)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 21,
          fontWeight: 750,
          color: tono ? TONO[tono].texto : "var(--text-1)",
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
        }}
      >
        {valor}
      </div>
      {hint && (
        <p style={{ margin: "5px 0 0", fontSize: 11, color: "var(--text-4)", lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Barra de progreso con techo. `de` en 0 pinta la barra vacía, no NaN. */
export function Barra({ valor, de, tono = "info" }: { valor: number; de: number; tono?: AvisoTono }) {
  const pct = de > 0 ? Math.min(100, Math.max(0, (valor / de) * 100)) : 0;
  return (
    <div
      style={{
        height: 7,
        borderRadius: 999,
        background: "var(--bg-hover)",
        overflow: "hidden",
        marginTop: 9,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: TONO[tono].texto,
          transition: "width 200ms ease",
        }}
      />
    </div>
  );
}

/* ── Pestañas ───────────────────────────────────────────────────────── */

export function Pestanas<T extends string>({
  valor,
  onChange,
  opciones,
}: {
  valor: T;
  onChange: (v: T) => void;
  opciones: { key: T; label: string }[];
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 12,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
        overflowX: "auto",
      }}
    >
      {opciones.map((o) => {
        const activo = o.key === valor;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={activo}
            onClick={() => onChange(o.key)}
            style={{
              flex: "0 0 auto",
              height: 32,
              padding: "0 14px",
              borderRadius: 9,
              border: "1px solid transparent",
              background: activo ? "var(--bg-elev)" : "transparent",
              color: activo ? "var(--text-1)" : "var(--text-3)",
              fontSize: 12.5,
              fontWeight: activo ? 700 : 550,
              fontFamily: "inherit",
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: activo ? "var(--shadow-1)" : "none",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Modal ──────────────────────────────────────────────────────────── */

/**
 * Pila de modales abiertos.
 *
 * 🔴 POR QUÉ: los modales de este área SE ANIDAN de verdad — el botón
 * "Investigar a este prospecto" abre un modal que contiene el panel de
 * investigación, y ese panel abre los suyos. Como cada uno escucha Escape
 * en `document`, sin esta pila una sola tecla cerraba los DOS y el usuario
 * perdía lo que estaba capturando. Solo cierra el de arriba.
 *
 * Vive a nivel de módulo porque la relación entre modales es global: no hay
 * ningún ancestro común que pueda saberlo (están en portales hermanos del
 * <body>).
 */
let pilaModales: symbol[] = [];

/**
 * 🔴 VA EN PORTAL. Ver la nota de arriba: `.realty-page` es un contenedor de
 * consulta y atraparía el `position: fixed`. El portal se monta después del
 * primer render (`montado`) porque en SSR no hay `document`.
 */
export function Modal({
  abierto,
  onCerrar,
  titulo,
  children,
  pie,
  ancho = 620,
  cerrarLabel,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  children: ReactNode;
  pie?: ReactNode;
  ancho?: number;
  cerrarLabel: string;
}) {
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  // Escape cierra. `onCerrar` suele llegar como flecha en línea, o sea una
  // función NUEVA en cada render del padre: se guarda en una ref para que
  // el listener se registre UNA vez por apertura y no en cada tecleo.
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  // Identidad estable de ESTE modal dentro de la pila, para toda su vida.
  const yo = useRef<symbol>(Symbol("modal"));

  useEffect(() => {
    if (!abierto) return undefined;
    const id = yo.current;
    pilaModales.push(id);
    const onKey = (e: KeyboardEvent) => {
      // Solo el de más arriba responde a Escape.
      if (e.key === "Escape" && pilaModales[pilaModales.length - 1] === id) {
        cerrarRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      pilaModales = pilaModales.filter((x) => x !== id);
    };
  }, [abierto]);

  // El fondo no hace scroll mientras esté abierto. Va en SU PROPIO efecto y
  // con `abierto` como única dependencia: si compartiera el de arriba, cada
  // render del padre lo desmontaría y remontaría, y el valor "original" que
  // se guarda para restaurar sería el que puso la vuelta anterior.
  useEffect(() => {
    if (!abierto) return undefined;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [abierto]);

  if (!abierto || !montado) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15, 23, 42, .55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "clamp(12px, 4vh, 56px) 14px",
        overflowY: "auto",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        style={{
          width: "100%",
          maxWidth: ancho,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          borderRadius: 16,
          boxShadow: "var(--shadow-3)",
          // 🔴 El modal vive en el <body>, FUERA de .realty-shell: sin fijar
          // el color aquí hereda el del sitio y en oscuro sale texto blanco
          // sobre blanco. Mismo tropiezo que el modal del panel dental.
          color: "var(--text-1)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "15px 18px",
            borderBottom: "1px solid var(--border-soft)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 750, color: "var(--text-1)" }}>
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label={cerrarLabel}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: "1px solid var(--border-soft)",
              background: "var(--bg-elev-2)",
              color: "var(--text-2)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {children}
        </div>
        {pie && (
          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 9,
              padding: "13px 18px",
              borderTop: "1px solid var(--border-soft)",
              background: "var(--bg-elev-2)",
              flexWrap: "wrap",
            }}
          >
            {pie}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── Vacíos y tablas ────────────────────────────────────────────────── */

export function Vacio({ texto }: { texto: string }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "22px 4px",
        textAlign: "center",
        fontSize: 12.5,
        color: "var(--text-4)",
        lineHeight: 1.6,
      }}
    >
      {texto}
    </p>
  );
}

/**
 * Envoltorio de tabla con scroll PROPIO. Sin esto una tabla ancha empuja el
 * body y toda la página hace scroll horizontal.
 */
export function TablaScroll({ children }: { children: ReactNode }) {
  return <div style={{ overflowX: "auto", margin: "0 -18px", padding: "0 18px" }}>{children}</div>;
}

export const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-4)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid var(--border-soft)",
  whiteSpace: "nowrap",
};

export const td: CSSProperties = {
  padding: "10px",
  fontSize: 12.5,
  color: "var(--text-2)",
  borderBottom: "1px solid var(--border-soft)",
  verticalAlign: "top",
};

/* ── Formato ────────────────────────────────────────────────────────── */

/**
 * Pesos mexicanos. `Intl` se construye una vez: hacerlo dentro de un map de
 * 200 filas es medible.
 */
const MXN = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 2,
});

export function pesos(n: number | null | undefined): string {
  const v = Number(n);
  return MXN.format(Number.isFinite(v) ? v : 0);
}

/**
 * Fecha corta legible. Recibe el ISO que mandan las rutas.
 *
 * ⚠️ `timeZone` es OBLIGATORIO y viene de la cuenta: sin él, el navegador de
 * quien mire desde otro huso pinta un día distinto al que dice la base.
 */
export function fechaCorta(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(d);
}

export function fechaHora(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

/* ── Llamadas a la API ──────────────────────────────────────────────── */

export interface ApiError {
  error: string;
  code?: string;
  reason?: string;
  field?: string;
}

/**
 * fetch con JSON en los dos sentidos que NUNCA lanza por un status: devuelve
 * `{ ok, data, error }`. Las pantallas de este área enseñan el mensaje del
 * servidor tal cual — está escrito en español y dice qué pasó — y solo caen
 * al genérico cuando no hubo respuesta.
 */
export async function apiJson<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<{ ok: boolean; data: T | null; error: string | null; code?: string }> {
  try {
    const { json, ...rest } = init ?? {};
    const res = await fetch(url, {
      ...rest,
      headers:
        json === undefined
          ? rest.headers
          : { "Content-Type": "application/json", ...(rest.headers ?? {}) },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
    const texto = await res.text();
    let cuerpo: unknown = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = null;
    }
    if (!res.ok) {
      const e = (cuerpo ?? {}) as ApiError;
      return { ok: false, data: null, error: e.error || null, code: e.code };
    }
    return { ok: true, data: (cuerpo as T) ?? null, error: null };
  } catch {
    return { ok: false, data: null, error: null };
  }
}
