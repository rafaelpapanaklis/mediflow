"use client";

// «Usar una plantilla» dentro del editor de un documento del paciente: un botón
// discreto en la barra de herramientas de la hoja, con la lista de plantillas de
// la clínica. Lo usan la nota de evolución y el consentimiento informado.
//
// Sin plantillas NO se pinta (el editor lo explica con una línea bajo la hoja):
// nunca manda a ninguna parte. La plantilla es una comodidad, no un peaje: ahí
// estaba el callejón del ticket del 19-sep-2026 («me envía a Plantillas»).
//
// Solo ELIGE. Qué se hace con la plantilla elegida —y la regla de no pisar lo ya
// escrito (`combinarConPlantilla`)— es del editor que lo monta.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import estilos from "./menu-plantillas.module.css";

export interface PlantillaDeMenu {
  id: string;
  name: string;
}

export function MenuPlantillas({
  plantillas, ocupado, etiqueta, titulo, onUsar,
}: {
  plantillas: PlantillaDeMenu[];
  ocupado: boolean;
  /** El texto del botón: «Usar una plantilla», «Cargar plantilla»… */
  etiqueta: string;
  /** El nombre accesible de la lista. */
  titulo: string;
  onUsar: (p: PlantillaDeMenu) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAbierto(false);
    };
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setAbierto(false);
    };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  if (plantillas.length === 0) return null;
  return (
    <div ref={raiz} className={estilos.plantilla}>
      <button
        type="button"
        className={estilos.plantillaBoton}
        disabled={ocupado}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
      >
        <FileText size={15} aria-hidden /> {etiqueta} <ChevronDown size={13} aria-hidden />
      </button>
      {abierto ? (
        <ul className={estilos.menu} role="menu" aria-label={titulo}>
          {plantillas.map((p) => (
            <li key={p.id} role="none">
              <button
                type="button"
                role="menuitem"
                className={estilos.opcion}
                onClick={() => {
                  setAbierto(false);
                  onUsar(p);
                }}
              >
                <FileText size={15} aria-hidden style={{ color: "var(--doc-tinta-3)", flex: "none" }} />
                <span>{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
