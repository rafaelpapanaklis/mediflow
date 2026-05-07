"use client";
// Drawer M1 — lista de últimos CFDI timbrados.

import { FileText, X } from "lucide-react";
import { fmtDate, fmtMoney } from "../atoms/format";
import type { CFDIRecordDTO } from "../types-finance";

export interface DrawerCFDIListProps {
  cfdiRecords: CFDIRecordDTO[];
  onClose: () => void;
  onDownloadPdf?: (uuid: string) => void;
  onDownloadXml?: (uuid: string) => void;
}

export function DrawerCFDIList(props: DrawerCFDIListProps) {
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
        aria-labelledby="drawer-cfdi-title"
      >
        <header className="px-6 py-4 border-b border-slate-100 bg-violet-50/40 flex items-center justify-between dark:border-slate-800 dark:bg-violet-900/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-violet-700 font-medium dark:text-violet-300">
              M1 · CFDI 4.0 nativo
            </div>
            <h3
              id="drawer-cfdi-title"
              className="text-base font-semibold text-slate-900 mt-0.5 dark:text-slate-100"
            >
              Últimas facturas
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
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {props.cfdiRecords.length === 0 ? (
            <div className="text-sm text-slate-500 italic px-3 py-6 dark:text-slate-400">
              Aún no hay facturas timbradas.
            </div>
          ) : (
            props.cfdiRecords.map((c) => (
              <div
                key={c.uuid}
                className="border border-slate-200 rounded-lg p-3 flex items-center gap-3 dark:border-slate-700"
              >
                <div
                  className="w-9 h-9 rounded bg-violet-50 flex items-center justify-center flex-shrink-0 dark:bg-violet-900/30"
                  aria-hidden
                >
                  <FileText
                    className="w-4 h-4 text-violet-700 dark:text-violet-300"
                    aria-hidden
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-slate-700 truncate dark:text-slate-300">
                    {c.uuid}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {fmtDate(c.date)} · {c.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {fmtMoney(c.amount)}
                  </div>
                  <div className="flex gap-2 mt-0.5">
                    {props.onDownloadPdf ? (
                      <button
                        type="button"
                        onClick={() => props.onDownloadPdf!(c.uuid)}
                        className="text-[10px] text-violet-700 hover:underline dark:text-violet-300"
                      >
                        PDF
                      </button>
                    ) : null}
                    {props.onDownloadXml ? (
                      <button
                        type="button"
                        onClick={() => props.onDownloadXml!(c.uuid)}
                        className="text-[10px] text-violet-700 hover:underline dark:text-violet-300"
                      >
                        XML
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
          <div className="text-[10px] text-slate-400 italic px-3 mt-2 dark:text-slate-500">
            TODO Facturapi API key para timbrado real · stub muestra UUIDs placeholder.
          </div>
        </div>
      </aside>
    </>
  );
}
