"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trash2, X, FileText } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import styles from "./patient-detail.module.css";

export interface SuggestedTreatment {
  code?: string;
  name: string;
  toothNumber?: number;
  surface?: string | null;
  unitPrice: number;
  quantity?: number;
  procedureCatalogId?: string | null;
}

interface TreatmentsModalProps {
  open: boolean;
  appointmentId: string;
  initialTreatments: SuggestedTreatment[];
  onClose: () => void;
  /** Llamado cuando la factura se crea con éxito. */
  onInvoiced?: (invoice: { id: string; invoiceNumber: string; total: number }) => void;
}

const SURFACE_LABEL: Record<string, string> = {
  V: "Vestibular", L: "Lingual", M: "Mesial", D: "Distal", O: "Oclusal",
};

interface Row extends SuggestedTreatment {
  _key: string;
  quantity: number;
}

function buildRows(treatments: SuggestedTreatment[]): Row[] {
  return treatments.map((t, i) => ({
    ...t,
    quantity: t.quantity ?? 1,
    _key: `${t.code ?? "x"}-${t.toothNumber ?? "x"}-${t.surface ?? "x"}-${i}`,
  }));
}

export function TreatmentsModal({
  open, appointmentId, initialTreatments, onClose, onInvoiced,
}: TreatmentsModalProps) {
  const [rows, setRows] = useState<Row[]>(() => buildRows(initialTreatments));
  const [discount, setDiscount] = useState(0);
  const [creating, setCreating] = useState(false);

  // Re-hidrata cuando cambian las treatments propuestas (e.g. otra cita).
  useEffect(() => {
    if (open) setRows(buildRows(initialTreatments));
  }, [open, initialTreatments]);

  const subtotal = useMemo(
    () => rows.reduce((s, r) => s + r.unitPrice * r.quantity, 0),
    [rows],
  );
  const total = Math.max(0, subtotal - discount);

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }

  async function createInvoice() {
    if (rows.length === 0 || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/invoices/from-appointment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId,
          discount,
          lineItems: rows.map((r) => ({
            code: r.code,
            name: r.name,
            toothNumber: r.toothNumber,
            surface: r.surface,
            unitPrice: r.unitPrice,
            quantity: r.quantity,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(`Factura ${data.invoice.invoiceNumber} creada`);
      onInvoiced?.(data.invoice);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo crear la factura");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={styles.treatmentsModal}>
        <div className={styles.treatmentsHead}>
          <div>
            <h2 className={styles.treatmentsTitle}>
              <FileText size={14} aria-hidden /> Tratamientos detectados
            </h2>
            <p className={styles.treatmentsSub}>
              {rows.length === 0
                ? "No se detectaron cambios en el odontograma."
                : `${rows.length} cambio${rows.length === 1 ? "" : "s"} respecto al snapshot anterior. Edita o elimina antes de facturar.`}
            </p>
          </div>
        </div>

        {rows.length > 0 && (
          <div className={styles.treatmentsBody}>
            <table className={styles.treatmentsTable}>
              <thead>
                <tr>
                  <th>Tratamiento</th>
                  <th style={{ width: 60 }}>Pieza</th>
                  <th style={{ width: 90 }}>Superficie</th>
                  <th style={{ width: 50 }}>Cant.</th>
                  <th style={{ width: 110 }}>Precio</th>
                  <th style={{ width: 110, textAlign: "right" }}>Subtotal</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r._key}>
                    <td className={styles.treatmentsName}>{r.name}</td>
                    <td className={styles.mono}>{r.toothNumber ?? "—"}</td>
                    <td>{r.surface ? SURFACE_LABEL[r.surface] ?? r.surface : "—"}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        value={r.quantity}
                        onChange={(e) => updateRow(idx, {
                          quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                        })}
                        className={styles.treatmentsInput}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.unitPrice}
                        onChange={(e) => updateRow(idx, {
                          unitPrice: Math.max(0, parseFloat(e.target.value) || 0),
                        })}
                        className={`${styles.treatmentsInput} ${styles.mono}`}
                      />
                    </td>
                    <td className={`${styles.mono} ${styles.treatmentsSubtotalCell}`}>
                      {formatCurrency(r.unitPrice * r.quantity)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.treatmentsRemove}
                        onClick={() => removeRow(idx)}
                        aria-label="Quitar"
                      >
                        <Trash2 size={11} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.treatmentsTotals}>
              <div className={styles.treatmentsTotalsRow}>
                <span>Subtotal</span>
                <strong className={styles.mono}>{formatCurrency(subtotal)}</strong>
              </div>
              <div className={styles.treatmentsTotalsRow}>
                <span>Descuento</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                  className={`${styles.treatmentsInput} ${styles.mono}`}
                  style={{ width: 100, textAlign: "right" }}
                />
              </div>
              <div className={`${styles.treatmentsTotalsRow} ${styles.treatmentsTotalRow}`}>
                <span>Total</span>
                <strong className={styles.mono}>{formatCurrency(total)}</strong>
              </div>
            </div>
          </div>
        )}

        <footer className={styles.treatmentsFoot}>
          <button
            type="button"
            className={styles.treatmentsCancel}
            onClick={onClose}
          >
            <X size={12} aria-hidden /> Cancelar factura
          </button>
          <button
            type="button"
            className={styles.treatmentsCreate}
            onClick={() => void createInvoice()}
            disabled={rows.length === 0 || creating}
          >
            {creating ? "Creando…" : `Crear factura ${formatCurrency(total)}`}
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
