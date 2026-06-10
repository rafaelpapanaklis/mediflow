"use client";

import { useState } from "react";
import { CalendarDays, Users, FileImage, Lock } from "lucide-react";
import { AgendaMock, ExpedienteMock, XrayMock } from "./mockups";

const TABS = [
  { k: "agenda", label: "Agenda", icon: CalendarDays },
  { k: "pacientes", label: "Pacientes", icon: Users },
  { k: "xrays", label: "Radiografías", icon: FileImage },
] as const;

type TabKey = (typeof TABS)[number]["k"];

/**
 * Ventana interactiva del hero: pestañas que cambian el mockup mostrado.
 * Cliente (estado de pestaña). Los mockups en sí son presentacionales.
 */
export function ProductWindow() {
  const [tab, setTab] = useState<TabKey>("agenda");

  return (
    <div className="mfh-win mfh-win--float">
      <div className="mfh-win__bar">
        <div className="mfh-win__dots">
          <i style={{ background: "#ff5f57" }} />
          <i style={{ background: "#febc2e" }} />
          <i style={{ background: "#28c840" }} />
        </div>
        <div className="mfh-win__url"><Lock /> app.dalecontrol.mx/dashboard</div>
      </div>

      <div className="mfh-ptabs" role="tablist" aria-label="Vista del producto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const selected = tab === t.k;
          return (
            <button
              key={t.k}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`mfh-panel-${t.k}`}
              id={`mfh-tab-${t.k}`}
              className="mfh-ptab"
              onClick={() => setTab(t.k)}
            >
              <Icon /> {t.label}
            </button>
          );
        })}
      </div>

      <div
        className="mfh-win__screen mfh-ptab__panel"
        role="tabpanel"
        id={`mfh-panel-${tab}`}
        aria-labelledby={`mfh-tab-${tab}`}
        key={tab}
      >
        {tab === "agenda" && <AgendaMock />}
        {tab === "pacientes" && <ExpedienteMock />}
        {tab === "xrays" && <XrayMock />}
      </div>
    </div>
  );
}
