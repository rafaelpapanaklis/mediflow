import type { ReactNode } from "react";
import { instrumentSans, materialSymbols } from "@/fonts/menu";
import { BrandGlyph } from "../../primitives/logo";
import { IconoPanel } from "./icono-panel";

/**
 * El MARCO DEL PANEL REAL, reconstruido en código para la landing.
 *
 * Es una réplica fiel del menú de dos niveles (`src/components/dashboard/
 * menu-dos-niveles/`): mismos tokens de color (#f4f3f8 / #4d3fc6 / #1a1826),
 * misma tipografía (Instrument Sans, `src/fonts/menu.ts`) y los mismos íconos
 * (Material Symbols Rounded recortado a los nombres del menú). Las dos fuentes
 * van SIN precarga en su declaración, así que traerlas aquí no cuesta nada al
 * LCP: el navegador las pide cuando el marco entra en pantalla.
 *
 * Es decorativo: los botones del menú no navegan (son <span>), y el nombre
 * accesible lo pone quien lo monta (`aria-label` en la sección).
 *
 * En pantallas angostas (< 880 px) el menú lateral se recoge y aparece la
 * barra del teléfono (hamburguesa + marca), igual que hace el panel real.
 */

const ITEMS: { icon: string; label: string; active?: boolean }[] = [
  { icon: "home", label: "Hoy" },
  { icon: "calendar_month", label: "Agenda" },
  { icon: "group", label: "Pacientes" },
  { icon: "forum", label: "Mensajes" },
  { icon: "point_of_sale", label: "Caja" },
  { icon: "auto_awesome", label: "Sabina", active: true },
];

export function PanelMarco({
  clinica,
  miga,
  children,
}: {
  clinica: string;
  /** Sección actual en las migas de la barra superior. */
  miga: string;
  children: ReactNode;
}) {
  const iniciales = clinica
    .split(" ")
    .filter((w) => /^[A-ZÁÉÍÓÚ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

  return (
    <div className={`dcv4-panel ${instrumentSans.variable} ${materialSymbols.variable}`}>
      {/* ── Menú lateral (nivel 1) ─────────────────────────────────────── */}
      <aside className="dcv4-panel__side" aria-hidden="true">
        <div className="dcv4-panel__brand">
          <span className="dcv4-panel__logo"><BrandGlyph size={18} mono="#ffffff" /></span>
          <span className="dcv4-panel__brandtext"><b>Dale</b>Control</span>
          <IconoPanel nombre="left_panel_close" className="dcv4-panel__dim" />
        </div>

        <div className="dcv4-panel__card">
          <span className="dcv4-panel__ini">{iniciales}</span>
          <span className="dcv4-panel__cardtx">
            <span className="dcv4-panel__cardname">{clinica}</span>
            <span className="dcv4-panel__cardsub">Clínica</span>
          </span>
          <IconoPanel nombre="unfold_more" size={18} className="dcv4-panel__dim" />
        </div>

        <span className="dcv4-panel__cta"><IconoPanel nombre="add" size={18} /> Nueva cita</span>

        <nav className="dcv4-panel__nav">
          {ITEMS.map((it) => (
            <span key={it.label} className={`dcv4-panel__item${it.active ? " is-active" : ""}`}>
              <IconoPanel nombre={it.icon} />
              <span>{it.label}</span>
            </span>
          ))}
        </nav>

        <span className="dcv4-panel__sep" />

        <div className="dcv4-panel__card dcv4-panel__admin">
          <IconoPanel nombre="apps" className="dcv4-panel__apps" />
          <span className="dcv4-panel__cardname" style={{ flex: 1 }}>Administración</span>
          <IconoPanel nombre="chevron_right" size={18} className="dcv4-panel__dim" />
        </div>

        <div className="dcv4-panel__card dcv4-panel__user">
          <span className="dcv4-panel__avatar">DR</span>
          <span className="dcv4-panel__cardtx">
            <span className="dcv4-panel__cardname">Dra. Ruiz</span>
            <span className="dcv4-panel__cardsub">Dueña</span>
          </span>
          <IconoPanel nombre="unfold_more" size={18} className="dcv4-panel__dim" />
        </div>
      </aside>

      {/* ── Columna principal ──────────────────────────────────────────── */}
      <div className="dcv4-panel__main">
        <header className="dcv4-panel__top" aria-hidden="true">
          <span className="dcv4-panel__burger"><IconoPanel nombre="menu" size={22} /></span>
          <span className="dcv4-panel__toplogo">
            <span className="dcv4-panel__logo"><BrandGlyph size={16} mono="#ffffff" /></span>
            <span className="dcv4-panel__brandtext"><b>Dale</b>Control</span>
          </span>
          <span className="dcv4-panel__migas">
            <span>{clinica}</span>
            <IconoPanel nombre="chevron_right" size={16} className="dcv4-panel__dim" />
            <span className="dcv4-panel__miga-actual">{miga}</span>
          </span>
          <span className="dcv4-panel__search">
            <IconoPanel nombre="search" size={18} className="dcv4-panel__dim" />
            <span className="dcv4-panel__searchtx">Buscar paciente, factura o cita…</span>
            <kbd>Ctrl K</kbd>
          </span>
          <span className="dcv4-panel__topbtn">
            <IconoPanel nombre="support_agent" size={20} />
            <i className="dcv4-panel__count">1</i>
          </span>
          <span className="dcv4-panel__topbtn dcv4-panel__bell">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <i className="dcv4-panel__dot" />
          </span>
        </header>
        <div className="dcv4-panel__body">{children}</div>
      </div>
    </div>
  );
}
