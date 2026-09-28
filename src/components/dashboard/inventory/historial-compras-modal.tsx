"use client";

// "Historial de compras" (ws1-t4, ajuste 1) — lista de compras registradas,
// con su detalle de líneas y el comprobante (folio de texto y/o archivo).
// Componente propio y aislado, mismo criterio que LotesModal/CompraModal:
// inventory-client.tsx solo recibe un botón y un `useState` nuevos.

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { X, ChevronDown, ChevronRight, FileText, Image as ImageIcon, Upload, Loader2, ReceiptText } from "lucide-react";
import { fmtMXN } from "@/lib/format";
// Diseño (ws1-t5): la ropa de la ventana y la maqueta de la lista.
import inv from "@/components/dashboard/cobros-inventario-rediseno/inventario.module.css";
import { ropaVentana } from "@/components/dashboard/cobros-inventario-rediseno/ventana";
// ws1-t5 (arreglo): el día de la compra se pinta en la zona de la CLÍNICA. Antes
// era la del navegador: visto desde otro huso, la compra salía un día antes.
import { formatearFechaDeCompra } from "@/lib/inventory/fecha-calendario";

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


function iconoComprobante(name: string | null) {
  if (name && /\.pdf$/i.test(name)) return <FileText size={14} strokeWidth={1.75} aria-hidden />;
  return <ImageIcon size={14} strokeWidth={1.75} aria-hidden />;
}

export function HistorialComprasModal({
  onClose, rediseno = false, timezone = null,
}: {
  onClose: () => void;
  /** ¿Diseño nuevo? Solo decide la ropa de la ventana. */
  rediseno?: boolean;
  /** Zona horaria de la clínica: en ella se lee el día de cada compra. */
  timezone?: string | null;
}) {
  const ropa = ropaVentana(rediseno, "ancha");
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
        <Dialog.Overlay className={ropa.velo} />
        <Dialog.Content className={ropa.caja} aria-describedby={undefined}>
          <div className="modal__header">
            <Dialog.Title className="modal__title">Historial de compras</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label="Cerrar">
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </Dialog.Close>
          </div>
          <div className="modal__body">
            {cargando ? (
              // Alto reservado: la ventana no crece de golpe al llegar la lista.
              <div className={inv.espera} role="status">
                <Loader2 size={20} className="animate-spin" aria-hidden />
                Cargando compras…
              </div>
            ) : !compras || compras.length === 0 ? (
              <div className={inv.espera}>
                <span className={inv.esperaIcono}><ReceiptText size={20} strokeWidth={1.75} aria-hidden /></span>
                <p className={inv.esperaTitulo}>Todavía no hay compras registradas</p>
                <p className={inv.esperaTexto}>
                  Cada compra que registres suma existencias, actualiza el costo y queda aquí con su comprobante.
                </p>
              </div>
            ) : (
              <div className={inv.compras}>
                {compras.map((c) => {
                  const expandida = abierta === c.id;
                  return (
                    <div key={c.id} className={inv.compra}>
                      <button
                        type="button"
                        onClick={() => setAbierta(expandida ? null : c.id)}
                        aria-expanded={expandida}
                        className={inv.compraCabeza}
                      >
                        {expandida
                          ? <ChevronDown size={16} strokeWidth={1.75} className={inv.compraFlecha} aria-hidden />
                          : <ChevronRight size={16} strokeWidth={1.75} className={inv.compraFlecha} aria-hidden />}
                        <span className={inv.compraFecha}>{formatearFechaDeCompra(c.date, timezone)}</span>
                        <span className={inv.compraProveedor}>{c.providerName ?? "Sin proveedor"}</span>
                        <span className={inv.compraQuien}>{c.createdByName ?? "—"}</span>
                        <span className={inv.compraTotal}>{fmtMXN(c.total)}</span>
                      </button>
                      {expandida && (
                        <div className={inv.compraDetalle}>
                          <table className="table-new">
                            <thead>
                              <tr><th>Artículo</th><th>Cantidad</th><th>Costo unit.</th></tr>
                            </thead>
                            <tbody>
                              {c.lines.map((l, i) => (
                                <tr key={i}>
                                  <td>{l.itemName}</td>
                                  <td>{l.quantity}</td>
                                  <td>{fmtMXN(l.unitCost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <div className={inv.comprobante}>
                            {c.receiptRef && (
                              <span className={inv.comprobanteDato}>Folio: {c.receiptRef}</span>
                            )}
                            {c.receiptFileUrl ? (
                              <a
                                href={c.receiptFileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={`btn-new btn-new--secondary btn-new--sm ${inv.comprobanteArchivo}`}
                              >
                                {iconoComprobante(c.receiptFileName)}
                                <span>{c.receiptFileName ?? "Ver comprobante"}</span>
                              </a>
                            ) : (
                              <span className={inv.comprobanteDato}>Sin comprobante de archivo</span>
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
                              className="btn-new btn-new--secondary btn-new--sm"
                              disabled={subiendoId === c.id}
                              onClick={() => fileInputRefs.current[c.id]?.click()}
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
