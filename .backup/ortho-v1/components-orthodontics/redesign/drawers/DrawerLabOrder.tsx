"use client";
// Drawer G18 — Lab order wizard.
// 480px lateral con catalog ampliado por categorías + form de detalles.

import { useState } from "react";
import { Send, X } from "lucide-react";
import { Btn } from "../atoms/Btn";

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
    group: "Records",
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
        className="fixed inset-0 bg-slate-900/30 z-40 dark:bg-slate-950/60"
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white border-l border-slate-200 z-50 shadow-2xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-laborder-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-violet-50/40 flex items-center justify-between dark:border-slate-800 dark:bg-violet-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
              G18 · Lab order wizard
            </div>
            <h3
              id="drawer-laborder-title"
              className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100"
            >
              Nueva orden de laboratorio
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1 dark:text-slate-400">
            1. Selecciona del catalog
          </div>
          {CATALOG.map((g) => (
            <div key={g.group}>
              <div className="text-xs font-medium text-slate-700 mb-1.5 dark:text-slate-300">
                {g.group}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.items.map((it) => (
                  <button
                    key={it}
                    type="button"
                    onClick={() => setCat(it)}
                    className={`text-left text-xs px-3 py-2 rounded border transition-colors focus:outline-none ${
                      cat === it
                        ? "border-violet-500 bg-violet-50 text-violet-900 font-medium dark:bg-violet-900/20 dark:border-violet-500 dark:text-violet-200"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {it}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {cat ? (
            <div className="pt-3 border-t border-slate-200 space-y-3 dark:border-slate-700">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1 dark:text-slate-400">
                  2. Detalles
                </div>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                  placeholder="Descripción específica (ej. 'Hawley sup arco vestibular')"
                  aria-label="Descripción"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1 dark:text-slate-400">
                    Lab
                  </div>
                  <select
                    value={lab}
                    onChange={(e) => setLab(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
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
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1 dark:text-slate-400">
                    Fecha entrega
                  </div>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded px-3 py-2 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                    aria-label="Fecha entrega"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <footer className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 dark:border-slate-800 dark:bg-slate-900/40">
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
