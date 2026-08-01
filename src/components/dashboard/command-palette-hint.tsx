"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

// Propiedad arbitraria, no la utilidad `shadow-[…]`: --ring es un box-shadow
// COMPLETO, y `shadow-[var(--ring)]` lo interpreta como color de sombra
// (--tw-shadow-color) y no pinta nada. Misma forma que el resto del repo.
const FOCUS_RING = "focus-visible:outline-none focus-visible:[box-shadow:var(--ring)]";

interface CommandPaletteHintProps {
  onClick: () => void;
  /** Fuerza el modo icono en cualquier ancho. Sin él, la caja se expande a
   *  partir de `md` (768px) y por debajo colapsa SOLA a la lupa — el colapso
   *  es puro CSS, no hay medición de viewport en JS (evita el salto de
   *  hidratación de un useState + resize listener). */
  compact?: boolean;
}

export function CommandPaletteHint({ onClick, compact }: CommandPaletteHintProps) {
  const t = useT();
  const [isMac, setIsMac] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setIsMac(/mac|iphone|ipad|ipod/i.test(navigator.platform));
  }, []);

  // Bajo md el botón es un cuadrado de 32px con la lupa centrada; de md hacia
  // arriba ocupa TODO el ancho que le da el slot del topbar (w-full) y alinea
  // su contenido a la izquierda como una caja de búsqueda de verdad.
  // Medidas en px arbitrarios, NO en las utilidades rem de Tailwind: la raíz
  // del panel es de 13px, así que `w-8` daría 26px y el botón dejaría de ser
  // cuadrado contra sus 32px de alto (y contra el botón del menú).
  const layout = compact
    ? "w-[32px] justify-center px-0"
    : "w-[32px] justify-center px-0 md:w-full md:justify-start md:pl-[12px] md:pr-[10px]";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={t("shell.cmdHint.ariaOpen", { key: isMac ? "⌘" : "Ctrl" })}
      aria-keyshortcuts="Control+K Meta+K"
      className={`${layout} ${FOCUS_RING} inline-flex items-center`}
      style={{
        height: 32,
        gap: 8,
        background: hovered ? "var(--bg-elev-2)" : "var(--bg-hover)",
        border: `1px solid ${hovered ? "var(--border-strong)" : "var(--border-soft)"}`,
        borderRadius: "var(--radius)",
        color: "var(--text-2)",
        fontSize: 12,
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        fontFamily: "inherit",
      }}
    >
      <Search size={14} style={{ flexShrink: 0 }} aria-hidden />
      {!compact && (
        <>
          {/* Dos textos, uno por rango de ancho: el largo solo entra cómodo a
              partir de xl (la caja mide ≥320px); entre md y lg va el corto. */}
          <span
            className="hidden md:block xl:hidden"
            style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {t("shell.cmdHint.searchShort")}
          </span>
          <span
            className="hidden xl:block"
            style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {t("shell.cmdHint.searchOrRun")}
          </span>
          <kbd
            className="hidden md:inline-flex"
            style={{
              alignItems: "center",
              gap: 1,
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-elev)",
              border: "1px solid var(--border-soft)",
              color: "var(--text-2)",
              fontFamily: "var(--font-mono, monospace)",
              fontWeight: 500,
              flexShrink: 0,
            }}
          >
            {isMac ? "⌘" : "Ctrl"}K
          </kbd>
        </>
      )}
    </button>
  );
}
