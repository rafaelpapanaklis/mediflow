"use client";
// Drawer M1 — lista de últimos CFDI timbrados.

import { FileText, X } from "lucide-react";
import { fmtDate, fmtMoney } from "../atoms/format";
import type { CFDIRecordDTO } from "../types-finance";
import { useCajon } from "../atoms/useCajon";
import orto from "../orto.module.css";

export interface DrawerCFDIListProps {
  cfdiRecords: CFDIRecordDTO[];
  onClose: () => void;
  onDownloadPdf?: (uuid: string) => void;
  onDownloadXml?: (uuid: string) => void;
}

export function DrawerCFDIList(props: DrawerCFDIListProps) {
  const cajonRef = useCajon<HTMLElement>(props.onClose);
  return (
    <>
      <div
        className={orto.velo}
        onClick={props.onClose}
        aria-hidden
      />
      <aside
        ref={cajonRef}
        tabIndex={-1}
        className={orto.cajon}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-cfdi-title"
      >
        <header className={orto.cajonCabeza}>
          <div>
            <div className={orto.cajonCeja}>
              M1 · CFDI 4.0 nativo
            </div>
            <h3
              id="drawer-cfdi-title"
              className={orto.cajonTitulo}
            >
              Últimas facturas
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
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {props.cfdiRecords.length === 0 ? (
            <div className="text-[13px] text-[color:var(--pr-texto-3)] italic px-3 py-6">
              Aún no hay facturas timbradas.
            </div>
          ) : (
            props.cfdiRecords.map((c) => (
              <div
                key={c.uuid}
                className="border border-[color:var(--pr-borde)] rounded-[10px] p-3 flex items-center gap-3"
              >
                <div
                  className="w-9 h-9 rounded-[8px] bg-[color:var(--pr-activo-suave)] flex items-center justify-center flex-shrink-0"
                  aria-hidden
                >
                  <FileText
                    className="w-4 h-4 text-[color:var(--orto-violeta)]"
                    aria-hidden
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="tabular-nums text-xs text-[color:var(--pr-texto-2)] truncate">
                    {c.uuid}
                  </div>
                  <div className="text-[11px] text-[color:var(--pr-texto-3)]">
                    {fmtDate(c.date)} · {c.label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular-nums text-[13px] font-semibold text-[color:var(--pr-texto)]">
                    {fmtMoney(c.amount)}
                  </div>
                  <div className="flex gap-2 mt-0.5">
                    {props.onDownloadPdf ? (
                      <button
                        type="button"
                        onClick={() => props.onDownloadPdf!(c.uuid)}
                        className="text-[11px] text-[color:var(--orto-violeta)] hover:underline"
                      >
                        PDF
                      </button>
                    ) : null}
                    {props.onDownloadXml ? (
                      <button
                        type="button"
                        onClick={() => props.onDownloadXml!(c.uuid)}
                        className="text-[11px] text-[color:var(--orto-violeta)] hover:underline"
                      >
                        XML
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
          <div className="text-[11px] text-[color:var(--pr-texto-3)] italic px-3 mt-2">
            TODO Facturapi API key para timbrado real · stub muestra UUIDs placeholder.
          </div>
        </div>
      </aside>
    </>
  );
}
