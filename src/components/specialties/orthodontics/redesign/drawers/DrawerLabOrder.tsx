"use client";
// Drawer G18 — Lab order wizard.
// 480px lateral con catalog ampliado por categorías + form de detalles.

import { useState } from "react";
import { Send, X } from "lucide-react";
import { Btn } from "../atoms/Btn";
import { DateField } from "@/components/ui/date-field";
import orto from "../orto.module.css";

const CATALOG: ReadonlyArray<{ group: string; items: string[] }> = [
  { group: "Aligners", items: ["Alineadores serie 1-30", "Refinement 1-5"] },
  {
    group: "Retención",
    items: [
      "Retenedor Hawley sup",
      "Retenedor Hawley inf",
      "Retenedor Essix sup",
      "Retenedor Essix inf",
      "Retenedor fijo lingual 3-3",
    ],
  },
  {
    group: "Aparatología",
    items: ["Expansor RPE Hyrax", "Expansor Quad-Helix", "Expansor McNamara"],
  },
  {
    group: "Registros",
    items: ["Modelos estudio digital", "Modelos impresos sup+inf"],
  },
];

const LABS = ["Lab Cendres MX", "Lab Guzmán Ortho", "Lab interno"];

export interface DrawerLabOrderProps {
  onClose: () => void;
  onSend?: (payload: {
    catalog: string;
    description: string;
    lab: string;
    expectedDate: string | null;
  }) => Promise<void> | void;
}

export function DrawerLabOrder(props: DrawerLabOrderProps) {
  const [cat, setCat] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [lab, setLab] = useState(LABS[0]);
  const [expectedDate, setExpectedDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!cat || !props.onSend) return;
    setSubmitting(true);
    try {
      await props.onSend({
        catalog: cat,
        description,
        lab,
        expectedDate: expectedDate || null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-laborder-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>
              Laboratorio
            </div>
            <h3
              id="drawer-laborder-title"
              className={orto.cajonTitulo}
            >
              Nueva orden de laboratorio
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className={orto.botonIcono}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className={`${orto.ceja} mb-1`}>
            1. Elige del catálogo
          </div>
          {CATALOG.map((g) => (
            <div key={g.group}>
              <div className="text-xs font-medium text-[color:var(--pr-texto-2)] mb-1.5">
                {g.group}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.items.map((it) => (
                  <button
                    key={it}
                    type="button"
                    onClick={() => setCat(it)}
                    className={`text-left text-xs px-3 py-2 rounded-[8px] border transition-colors ${
                      cat === it
                        ? "border-[color:var(--pr-activo)] bg-[color:var(--pr-activo-suave)] text-[color:var(--orto-violeta)] font-medium"
                        : "border-[color:var(--pr-borde)] bg-[color:var(--pr-tarjeta)] text-[color:var(--pr-texto-2)] hover:border-[color:var(--pr-borde)]"
                    }`}
                  >
                    {it}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {cat ? (
            <div className="pt-3 border-t border-[color:var(--pr-borde)] space-y-3">
              <div>
                <div className={`${orto.ceja} mb-1`}>
                  2. Detalles
                </div>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={`${orto.entrada} w-full`}
                  placeholder="Descripción específica (ej. 'Hawley sup arco vestibular')"
                  aria-label="Descripción"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className={`${orto.ceja} mb-1`}>
                    Lab
                  </div>
                  <select
                    value={lab}
                    onChange={(e) => setLab(e.target.value)}
                    className={`${orto.entrada} w-full`}
                    aria-label="Laboratorio"
                  >
                    {LABS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className={`${orto.ceja} mb-1`}>
                    Fecha entrega
                  </div>
                  <DateField
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full text-[13px] border border-[color:var(--pr-borde)] rounded-[8px] px-3 py-2"
                    aria-label="Fecha entrega"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <footer className={orto.cajonPie}>
          <Btn variant="secondary" size="md" onClick={props.onClose}>
            Cancelar
          </Btn>
          <Btn
            variant="primary"
            size="md"
            disabled={!cat || submitting}
            icon={<Send className="w-4 h-4" aria-hidden />}
            onClick={() => void submit()}
          >
            {submitting ? "Enviando…" : "Enviar al lab"}
          </Btn>
        </footer>
      </aside>
    </>
  );
}
