"use client";

// "Historial de compras" (ws1-t4, ajuste 1) — lista de compras registradas,
// con su detalle de líneas y el comprobante (folio de texto y/o archivo).
// Componente propio y aislado, mismo criterio que LotesModal/CompraModal:
// inventory-client.tsx solo recibe un botón y un `useState` nuevos.

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { X, ChevronDown, ChevronRight, FileText, Image as ImageIcon, Upload, Loader2 } from "lucide-react";
import { fmtMXN } from "@/lib/format";

interface LineaCompra { itemId: string; itemName: string; quantity: number; unitCost: number; }

interface Compra {
  id: string;
  date: string;
  providerName: string | null;
  receiptRef: string | null;
  receiptFileUrl: string | null;
  receiptFileName: string | null;
  createdByName: string | null;
  total: number;
  expenseId: string | null;
  lines: LineaCompra[];
}

const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

function iconoComprobante(name: string | null) {
  if (name && /\.pdf$/i.test(name)) return <FileText size={14} strokeWidth={1.75} aria-hidden />;
  return <ImageIcon size={14} strokeWidth={1.75} aria-hidden />;
}

export function HistorialComprasModal({ onClose }: { onClose: () => void }) {
  const [compras, setCompras] = useState<Compra[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [subiendoId, setSubiendoId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let vivo = true;
    fetch("/api/inventory/purchases")
      .then((r) => (r.ok ? r.json() : { compras: [] }))
      .then((data) => { if (vivo) setCompras(data.compras ?? []); })
      .catch(() => { if (vivo) setCompras([]); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, []);

  async function subirComprobante(purchaseId: string, file: File) {
    setSubiendoId(purchaseId);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/inventory/purchases/${purchaseId}/comprobante`, { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) { toast.error(data?.error ?? "No se pudo subir el comprobante."); return; }
      setCompras((prev) => prev?.map((c) => c.id === purchaseId
        ? { ...c, receiptFileUrl: data.receiptFileUrl, receiptFileName: data.receiptFileName }
        : c) ?? null);
      toast.success("Comprobante guardado.");
    } catch {
      toast.error("No se pudo subir el comprobante.");
    } finally {
      setSubiendoId(null);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className="modal"
          aria-describedby={undefined}
          style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            maxWidth: 760, width: "calc(100vw - 32px)", maxHeight: "85vh", zIndex: 101,
            display: "flex", flexDirection: "column",
          }}
        >
          <div className="modal__header">
            <Dialog.Title className="modal__title">Historial de compras</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="modal__body" style={{ overflowY: "auto" }}>
            {cargando ? (
              <p style={{ color: "var(--text-3)", fontSize: 13.5, textAlign: "center", padding: "24px 0" }}>Cargando…</p>
            ) : !compras || compras.length === 0 ? (
              <p style={{ color: "var(--text-3)", fontSize: 13.5, textAlign: "center", padding: "24px 0" }}>
                Todavía no hay compras registradas.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {compras.map((c) => {
                  const expandida = abierta === c.id;
                  return (
                    <div key={c.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 8, overflow: "hidden" }}>
                      <button
                        type="button"
                        onClick={() => setAbierta(expandida ? null : c.id)}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", background: "var(--bg-elev)", border: "none", cursor: "pointer", textAlign: "left",
                        }}
                      >
                        {expandida ? <ChevronDown size={16} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={16} strokeWidth={1.75} aria-hidden />}
                        <span style={{ fontSize: 12.5, color: "var(--text-3)", minWidth: 78 }}>{fmtFecha(c.date)}</span>
                        <span style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500, flex: 1 }}>
                          {c.providerName ?? "Sin proveedor"}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{c.createdByName ?? "—"}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>
                          {fmtMXN(c.total)}
                        </span>
                      </button>
                      {expandida && (
                        <div style={{ padding: "12px 14px", background: "var(--bg-elev-2)" }}>
                          <table className="table-new" style={{ marginBottom: 12 }}>
                            <thead>
                              <tr><th>Artículo</th><th style={{ textAlign: "right" }}>Cantidad</th><th style={{ textAlign: "right" }}>Costo unit.</th></tr>
                            </thead>
                            <tbody>
                              {c.lines.map((l, i) => (
                                <tr key={i}>
                                  <td>{l.itemName}</td>
                                  <td style={{ textAlign: "right" }}>{l.quantity}</td>
                                  <td style={{ textAlign: "right" }}>{fmtMXN(l.unitCost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            {c.receiptRef && (
                              <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Folio: {c.receiptRef}</span>
                            )}
                            {c.receiptFileUrl ? (
                              <a
                                href={c.receiptFileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-new btn-new--ghost btn-new--sm"
                                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                              >
                                {iconoComprobante(c.receiptFileName)}
                                {c.receiptFileName ?? "Ver comprobante"}
                              </a>
                            ) : (
                              <span style={{ fontSize: 12, color: "var(--text-3)" }}>Sin comprobante de archivo</span>
                            )}
                            <input
                              ref={(el) => { fileInputRefs.current[c.id] = el; }}
                              type="file"
                              accept="image/jpeg,image/png,image/webp,application/pdf"
                              style={{ display: "none" }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file) subirComprobante(c.id, file);
                              }}
                            />
                            <button
                              type="button"
                              className="btn-new btn-new--ghost btn-new--sm"
                              disabled={subiendoId === c.id}
                              onClick={() => fileInputRefs.current[c.id]?.click()}
                              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                            >
                              {subiendoId === c.id
                                ? <Loader2 size={14} className="animate-spin" aria-hidden />
                                : <Upload size={14} strokeWidth={1.75} aria-hidden />}
                              {c.receiptFileUrl ? "Reemplazar comprobante" : "Subir comprobante"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
