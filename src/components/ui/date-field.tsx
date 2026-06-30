"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Helpers puros                                                       */
/* ------------------------------------------------------------------ */

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
// La semana inicia en LUNES.
const WEEKDAYS_ES = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m0: number, d: number) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

/** ISO (yyyy-mm-dd) → dd/mm/aaaa para mostrar. */
function toDMY(value?: string): string {
  if (!value || typeof value !== "string") return "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** ISO (yyyy-mm-dd) → partes numéricas, o null si no es válido. */
function parseISO(value?: string): { y: number; m0: number; d: number } | null {
  if (!value || typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m0: mo - 1, d };
}

/**
 * Máscara tolerante de tecleo dd/mm/aaaa (día primero): acepta 1 o 2 dígitos
 * por segmento, autoinserta "/" y respeta los "/" que teclee el usuario.
 */
function maskDMY(raw: string): { text: string; d: string; m: string; y: string } {
  const maxes = [2, 2, 4];
  const seg = ["", "", ""];
  let i = 0;
  for (const ch of raw) {
    if (ch === "/") {
      if (i < 2 && seg[i].length > 0) i++;
      continue;
    }
    if (ch < "0" || ch > "9") continue;
    if (seg[i].length >= maxes[i]) {
      if (i < 2) i++;
      else break;
    }
    seg[i] += ch;
  }
  const [d, m, y] = seg;
  let text = d;
  if (d.length === 2 || m.length > 0 || y.length > 0) {
    text += "/" + m;
    if (m.length === 2 || y.length > 0) text += "/" + y;
  }
  return { text, d, m, y };
}

/** Segmentos d/m/y → ISO si forman una fecha válida dentro de [min,max]. */
function segmentsToISO(d: string, m: string, y: string, min?: string, max?: string): string | null {
  if (!d || !m || y.length !== 4) return null;
  const dd = +d, mm = +m, yy = +y;
  if (mm < 1 || mm > 12) return null;
  const dim = new Date(yy, mm, 0).getDate(); // último día del mes mm (1-based)
  if (dd < 1 || dd > dim) return null;
  const iso = `${y}-${pad2(mm)}-${pad2(dd)}`;
  if (min && iso < min) return null;
  if (max && iso > max) return null;
  return iso;
}

/* ------------------------------------------------------------------ */
/* Estilos del popover (se inyectan una sola vez)                      */
/* ------------------------------------------------------------------ */

const STYLE_ID = "datefield-popover-css";
function ensurePopoverStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
.df-pop, .df-pop * { box-sizing: border-box; }
.df-input::placeholder { color: var(--text-4); }
.df-cal { display:inline-flex; align-items:center; justify-content:center; background:transparent; border:0; padding:2px; margin:0; color:var(--text-3); cursor:pointer; flex-shrink:0; border-radius:6px; }
.df-cal:hover:not(:disabled) { color:var(--brand); }
.df-cal:disabled { cursor:default; opacity:.5; }
.df-cal:focus-visible { outline:2px solid var(--brand); outline-offset:1px; }
.df-nav { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:1px solid var(--border-soft); border-radius:8px; background:var(--bg-elev); color:var(--text-2); cursor:pointer; flex-shrink:0; }
.df-nav:hover:not(:disabled) { background:var(--bg-hover); color:var(--brand); }
.df-nav:disabled { opacity:.35; cursor:default; }
.df-sel { height:30px; border:1px solid var(--border-soft); border-radius:8px; background:var(--bg-elev); color:var(--text-1); font-size:12px; padding:0 6px; cursor:pointer; }
.df-sel:focus-visible, .df-nav:focus-visible { outline:2px solid var(--brand); outline-offset:1px; }
.df-day { height:32px; width:100%; display:grid; place-items:center; border:0; background:transparent; color:var(--text-1); font-size:12px; border-radius:8px; cursor:pointer; }
.df-day:hover:not(:disabled) { background:var(--bg-hover); }
.df-day:focus-visible { outline:2px solid var(--brand); outline-offset:1px; }
.df-day:disabled { color:var(--text-4); opacity:.4; cursor:default; }
.df-trigger { font-weight:600; text-align:center; }
.df-trigger:hover { background:var(--bg-hover); color:var(--brand); }
.df-list { position:absolute; top:34px; z-index:5; max-height:220px; overflow-y:auto; background:var(--bg-elev); border:1px solid var(--border-strong); border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.18); padding:4px; display:flex; flex-direction:column; gap:2px; }
.df-opt { width:100%; text-align:center; height:30px; border:0; background:transparent; color:var(--text-1); font-size:12px; border-radius:7px; cursor:pointer; white-space:nowrap; padding:0 10px; }
.df-opt:hover:not(:disabled) { background:var(--bg-hover); }
.df-opt[aria-selected="true"] { background:var(--brand); color:#fff; font-weight:700; }
.df-opt:disabled { opacity:.4; cursor:default; }
`;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/* Componente                                                          */
/* ------------------------------------------------------------------ */

type DateFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  placeholder?: string;
};

/**
 * Campo de fecha con date picker PROPIO (no usa el calendario nativo del
 * navegador). Muestra y acepta dd/mm/aaaa (día primero), con tecleo tolerante,
 * y un popover con selectores de mes/año para saltar a cualquier año en 1 clic
 * (clave para fecha de nacimiento).
 *
 * Drop-in de <input type="date">: el `value` se maneja como ISO `yyyy-mm-dd`
 * y `onChange` se llama con un evento cuyo `target.value` es el ISO. Reenvía y
 * respeta: min, max, required, disabled, name, id, className, style, ref y
 * placeholder. `className`/`style` se aplican al contenedor (para conservar el
 * "look" de .input-new y el borderColor de error, igual que antes).
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    className, style, value, placeholder = "dd/mm/aaaa", disabled,
    min, max, required, name, id,
    onChange, onClick, onFocus, onBlur, onKeyDown,
    ...rest
  },
  ref,
) {
  const isoValue = typeof value === "string" ? value : "";
  const minISO = typeof min === "string" && min ? min : undefined;
  const maxISO = typeof max === "string" && max ? max : undefined;

  const wrapperRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const calBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const yearListRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(false);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => toDMY(isoValue));
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const now = new Date();
  const [viewYear, setViewYear] = useState(() => now.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => now.getMonth());
  // Dropdowns PROPIOS de mes/año: los <select> nativos abren un menú del SO que
  // escapa el popover (en portal) y cerraba el calendario. null = ninguno abierto.
  const [picker, setPicker] = useState<null | "month" | "year">(null);

  useEffect(() => { setMounted(true); ensurePopoverStyles(); }, []);

  // Cierra los dropdowns al cerrar el calendario; al abrir el de año, lo centra.
  useEffect(() => { if (!open) setPicker(null); }, [open]);
  useEffect(() => {
    if (picker !== "year") return;
    const raf = requestAnimationFrame(() => {
      const sel = yearListRef.current?.querySelector('[aria-selected="true"]') as HTMLElement | null;
      sel?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [picker]);

  // Sincroniza el texto visible con el value externo cuando NO se está editando.
  useEffect(() => { if (!focused) setText(toDMY(isoValue)); }, [isoValue, focused]);

  // Ref combinada: la forwarded ref apunta al input tecleable.
  const setInputRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
  };

  // Emite el cambio respetando el contrato: target.value = ISO.
  function emit(iso: string) {
    onChange?.({
      target: { value: iso, name: name ?? "" },
      currentTarget: { value: iso, name: name ?? "" },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  }

  function handleType(e: React.ChangeEvent<HTMLInputElement>) {
    const { text: t, d, m, y } = maskDMY(e.target.value);
    setText(t);
    if (!d && !m && !y) { emit(""); return; }
    const iso = segmentsToISO(d, m, y, minISO, maxISO);
    if (iso) emit(iso);
  }

  /* --- rango de años / vista --- */
  const minDate = parseISO(minISO);
  const maxDate = parseISO(maxISO);
  const minYear = minDate ? minDate.y : 1900;
  const maxYear = maxDate ? maxDate.y : now.getFullYear();

  // Si el popover se abre por clic en el INPUT, no robamos el foco al grid (para
  // poder seguir tecleando); sí lo enfocamos al abrir por el botón o por teclado.
  const focusGridRef = useRef(true);
  function openPopover(focusGrid = true) {
    if (disabled) return;
    focusGridRef.current = focusGrid;
    const sel = parseISO(isoValue);
    let y: number, m0: number;
    if (sel) {
      y = sel.y; m0 = sel.m0;
    } else {
      y = now.getFullYear();
      if (y < minYear) y = minYear;
      if (y > maxYear) y = maxYear;
      m0 = now.getMonth();
      if (y === maxYear && maxDate && m0 > maxDate.m0) m0 = maxDate.m0;
      if (y === minYear && minDate && m0 < minDate.m0) m0 = minDate.m0;
    }
    setViewYear(y);
    setViewMonth(m0);
    setOpen(true);
  }

  // Cerrar al hacer click GENUINAMENTE afuera. pointerdown en BURBUJA con containment;
  // SIN stopPropagation (eso bloqueaba los onClick del popover → mes/año/día no
  // respondían). NO hace falta proteger de Radix: el popover, aunque vive en un portal
  // a <body>, es descendiente del Dialog en el ÁRBOL DE REACT, y Radix decide
  // "outside" por isPointerInsideReactTree (árbol React, no DOM) → NO cierra el modal.
  useEffect(() => {
    if (!open) return;
    function onDown(e: Event) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (wrapperRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Esc cierra el popover (captura, para no cerrar un modal padre).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        requestAnimationFrame(() => calBtnRef.current?.focus());
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);


  // Posiciona el popover (fixed → escapa overflow/transform del modal).
  useEffect(() => {
    if (!open) { setReady(false); return; }
    function place() {
      const r = wrapperRef.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 6;
      const popW = popoverRef.current?.offsetWidth ?? 300;
      const popH = popoverRef.current?.offsetHeight ?? 340;
      let left = r.left;
      if (left + popW > window.innerWidth - 8) left = window.innerWidth - 8 - popW;
      if (left < 8) left = 8;
      let top = r.bottom + margin;
      if (top + popH > window.innerHeight - 8 && r.top - margin - popH > 8) {
        top = r.top - margin - popH; // si no cabe abajo y sí arriba, va arriba
      }
      setCoords({ top, left });
      setReady(true);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, viewMonth, viewYear]);

  // Foco inicial dentro del calendario al abrir.
  useEffect(() => {
    if (!open) return;
    if (!focusGridRef.current) return; // abierto por clic en el input → no robar foco
    const raf = requestAnimationFrame(() => {
      const sel = parseISO(isoValue);
      let day = 1;
      if (sel && sel.y === viewYear && sel.m0 === viewMonth) day = sel.d;
      else if (now.getFullYear() === viewYear && now.getMonth() === viewMonth) day = now.getDate();
      const btn = gridRef.current?.querySelector(`[data-day="${day}"]`) as HTMLElement | null;
      btn?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(day: number) {
    const iso = isoOf(viewYear, viewMonth, day);
    if (minISO && iso < minISO) return;
    if (maxISO && iso > maxISO) return;
    setText(toDMY(iso));
    emit(iso);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  /* --- límites de mes para el año visible --- */
  const monthMin = viewYear === minYear && minDate ? minDate.m0 : 0;
  const monthMax = viewYear === maxYear && maxDate ? maxDate.m0 : 11;

  function changeYear(y: number) {
    let m0 = viewMonth;
    const lo = y === minYear && minDate ? minDate.m0 : 0;
    const hi = y === maxYear && maxDate ? maxDate.m0 : 11;
    if (m0 < lo) m0 = lo;
    if (m0 > hi) m0 = hi;
    setViewYear(y);
    setViewMonth(m0);
  }

  function shiftMonth(delta: number) {
    let y = viewYear, m0 = viewMonth + delta;
    if (m0 < 0) { m0 = 11; y--; }
    if (m0 > 11) { m0 = 0; y++; }
    if (y < minYear || y > maxYear) return;
    setViewYear(y);
    setViewMonth(m0);
  }

  const prevDisabled = viewYear < minYear || (viewYear === minYear && viewMonth <= monthMin);
  const nextDisabled = viewYear > maxYear || (viewYear === maxYear && viewMonth >= monthMax);

  // Navegación con flechas dentro de la grilla (roving focus, sin cruzar mes).
  function onGridKeyDown(e: React.KeyboardEvent) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const cur = active?.getAttribute?.("data-day");
    const dim = new Date(viewYear, viewMonth + 1, 0).getDate();
    let day = cur ? +cur : 1;
    if (e.key === "ArrowLeft") day -= 1;
    else if (e.key === "ArrowRight") day += 1;
    else if (e.key === "ArrowUp") day -= 7;
    else if (e.key === "ArrowDown") day += 7;
    else if (e.key === "Home") day = 1;
    else if (e.key === "End") day = dim;
    day = Math.max(1, Math.min(dim, day));
    const btn = gridRef.current?.querySelector(`[data-day="${day}"]`) as HTMLElement | null;
    btn?.focus();
  }

  /* --- construcción de la grilla --- */
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstOffset = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // lunes=0
  const todayISO = isoOf(now.getFullYear(), now.getMonth(), now.getDate());

  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) years.push(y); // descendente (años recientes arriba)

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const popover = open && mounted ? createPortal(
    <div
      ref={popoverRef}
      className="df-pop"
      data-datefield-popover=""
      role="dialog"
      aria-modal="false"
      aria-label="Selector de fecha"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        zIndex: 9999,
        width: "min(320px, calc(100vw - 16px))",
        background: "var(--bg-elev)",
        border: "1px solid var(--border-strong)",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)",
        padding: 12,
        color: "var(--text-1)",
        visibility: ready ? "visible" : "hidden",
      }}
    >
      {/* Encabezado: ‹ + mes + año + › (dropdowns PROPIOS, no <select> nativo). */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, position: "relative" }}>
        <button type="button" className="df-nav" aria-label="Mes anterior" disabled={prevDisabled} onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="df-sel df-trigger"
          aria-haspopup="listbox"
          aria-expanded={picker === "month"}
          onClick={() => setPicker((p) => (p === "month" ? null : "month"))}
          style={{ flex: 1, minWidth: 0 }}
        >
          {MONTHS_ES[viewMonth]}
        </button>
        <button
          type="button"
          className="df-sel df-trigger"
          aria-haspopup="listbox"
          aria-expanded={picker === "year"}
          onClick={() => setPicker((p) => (p === "year" ? null : "year"))}
        >
          {viewYear}
        </button>
        <button type="button" className="df-nav" aria-label="Mes siguiente" disabled={nextDisabled} onClick={() => shiftMonth(1)}>
          <ChevronRight size={16} />
        </button>

        {picker === "month" && (
          <div role="listbox" aria-label="Elegir mes" className="df-list" style={{ left: 36, right: 36 }}>
            {MONTHS_ES.map((mn, idx) => (
              <button
                key={mn}
                type="button"
                role="option"
                aria-selected={idx === viewMonth}
                className="df-opt"
                disabled={idx < monthMin || idx > monthMax}
                onClick={() => { setViewMonth(idx); setPicker(null); }}
              >
                {mn}
              </button>
            ))}
          </div>
        )}
        {picker === "year" && (
          <div ref={yearListRef} role="listbox" aria-label="Elegir año" className="df-list" style={{ right: 36, width: 92 }}>
            {years.map((y) => (
              <button
                key={y}
                type="button"
                role="option"
                aria-selected={y === viewYear}
                className="df-opt"
                onClick={() => { changeYear(y); setPicker(null); }}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Días de la semana */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
        {WEEKDAYS_ES.map((w, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{w}</div>
        ))}
      </div>

      {/* Grilla de días */}
      <div
        ref={gridRef}
        role="grid"
        aria-label="Días"
        onKeyDown={onGridKeyDown}
        style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}
      >
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} aria-hidden />;
          const iso = isoOf(viewYear, viewMonth, d);
          const isDisabled = Boolean((minISO && iso < minISO) || (maxISO && iso > maxISO));
          const isSel = isoValue === iso;
          const isToday = todayISO === iso;
          return (
            <button
              key={d}
              type="button"
              data-day={d}
              className="df-day"
              role="gridcell"
              aria-label={`${d} de ${MONTHS_ES[viewMonth]} de ${viewYear}`}
              aria-selected={isSel}
              aria-current={isToday ? "date" : undefined}
              tabIndex={-1}
              disabled={isDisabled}
              onClick={() => pick(d)}
              style={{
                background: isSel ? "var(--brand)" : undefined,
                color: isSel ? "#fff" : undefined,
                fontWeight: isSel || isToday ? 700 : 400,
                boxShadow: !isSel && isToday ? "inset 0 0 0 1.5px var(--brand)" : undefined,
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <span
      ref={wrapperRef}
      className={className}
      onClick={(e) => {
        // Click en el área del campo (no en el botón ni en el input) enfoca el input.
        if (e.target === wrapperRef.current) inputRef.current?.focus();
      }}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        justifyContent: "space-between",
        cursor: disabled ? "default" : "text",
        ...style,
      }}
    >
      <input
        ref={setInputRef}
        className="df-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        id={id}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Fecha (dd/mm/aaaa)"
        {...rest}
        value={text}
        onChange={handleType}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) { e.preventDefault(); openPopover(true); }
          onKeyDown?.(e);
        }}
        onClick={(e) => { if (!open) openPopover(false); onClick?.(e); }}
        style={{
          flex: 1,
          minWidth: 0,
          width: "100%",
          border: "none",
          outline: "none",
          background: "transparent",
          color: "inherit",
          font: "inherit",
          padding: 0,
          margin: 0,
        }}
      />
      <button
        ref={calBtnRef}
        type="button"
        className="df-cal"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Abrir calendario"
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else openPopover(); }}
      >
        <Calendar size={14} />
      </button>
      {/* Espejo oculto para serialización nativa de formularios (name → ISO). */}
      {name ? <input type="hidden" name={name} value={isoValue} readOnly /> : null}
      {popover}
    </span>
  );
});
