"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Trash2, X, FileText, ListChecks, Wallet } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/utils";
import { fmtMXNdec } from "@/lib/format";
import { sumInvoiceItems, itemLineTotal } from "@/lib/invoice-totals";
import { useT } from "@/i18n/i18n-provider";
import styles from "./patient-detail.module.css";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { rotuloCara } from "@/components/dashboard/odontogram-v2/adapter";
import { emparejarConElPlan, filaTomable, soloLoDeFuera, type FilaParaEmparejar } from "@/lib/treatments/sin-doble-cobro";
import { marcarHecho } from "@/lib/treatments/marcar-hecho-cliente";
import type { FilaDto } from "@/lib/treatments/items";

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
  /**
   * ws1-t12 · fase 2 («Hoy en el sillón»): el paciente, para leer sus planes. Lo que es de un plan
   * NO se factura aquí: se marca hecho (la acción de B) y se cobra como abono a la nota del plan.
   * Sin `patientId` la ventana es la de siempre.
   */
  patientId?: string;
  /** `treatments.edit`: sin él se ven las filas del plan pero no se marcan. */
  puedeMarcarHecho?: boolean;
  /** «Abonar al plan»: abre «Cobrar hoy» (abona a la nota del plan). */
  onCobrarHoy?: () => void;
  /** Se marcó algo hecho: la ficha refresca planes y cuentas. */
  onHechos?: () => void;
}

/** Un plan del paciente tal como lo contesta GET /api/treatments. */
interface PlanConFilas { id: string; name: string; status: string; items?: FilaDto[] }

/**
 * Las filas que pueden ser lo de hoy: de planes vivos, por hacer (o recién hechas). De un plan
 * cancelado, solo las que siguen en su nota (`cancelado: true`): cuentan para no facturarlas aparte,
 * pero no se ofrecen para marcar.
 */
function filasDeHoy(planes: PlanConFilas[]): Array<FilaParaEmparejar & { plan: string; dto: FilaDto; cancelado: boolean }> {
  return planes
    .flatMap((p) => (p.items ?? []).map((f) => ({ ...f, planId: p.id, plan: p.name, dto: f, cancelado: p.status === "ABANDONED" })))
    .filter((f) => f.estado !== "cancelado" && filaTomable(f) && (!f.cancelado || !!f.invoiceId));
}

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
  open, appointmentId, initialTreatments, onClose, onInvoiced, patientId, puedeMarcarHecho = false, onCobrarHoy, onHechos,
}: TreatmentsModalProps) {
  const t = useT();
  const [rows, setRows] = useState<Row[]>(() => buildRows(initialTreatments));
  const [discount, setDiscount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [creatingQuote, setCreatingQuote] = useState(false);
  // «Hoy en el sillón»: los planes del paciente (null = cargando o sin paciente).
  const [planes, setPlanes] = useState<PlanConFilas[] | null>(patientId ? null : []);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [hechasHoy, setHechasHoy] = useState<Set<string>>(new Set());
  const [marcando, setMarcando] = useState(false);

  useEffect(() => {
    if (!open || !patientId) { setPlanes(patientId ? null : []); return; }
    let vivo = true;
    setPlanes(null);
    setHechasHoy(new Set());
    fetch(`/api/treatments?patientId=${encodeURIComponent(patientId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (vivo) setPlanes(Array.isArray(d) ? d : []); })
      .catch(() => { if (vivo) setPlanes([]); });
    return () => { vivo = false; };
  }, [open, patientId]);

  const filasPlan = useMemo(() => filasDeHoy(planes ?? []), [planes]);
  const detectados = useMemo(() => buildRows(initialTreatments), [initialTreatments]);
  // Lo detectado que ya es una fila del plan: no se factura aquí (nunca dos veces).
  const emparejado = useMemo(
    () => emparejarConElPlan(detectados.map((r) => ({ nombre: r.name, codigo: r.code ?? null, procedureId: r.procedureCatalogId ?? null, diente: r.toothNumber ?? null, cantidad: r.quantity })), filasPlan),
    [detectados, filasPlan],
  );

  // Re-hidrata cuando cambian las treatments propuestas (e.g. otra cita) o cuando llegan los planes:
  // en la factura solo queda lo de fuera de todo plan, con sus unidades.
  useEffect(() => {
    if (!open) return;
    const fuera = soloLoDeFuera(detectados.map((r) => ({ ...r, nombre: r.name, cantidad: r.quantity })), emparejado);
    setRows(fuera.map((r) => ({ ...r, quantity: r.cantidad ?? r.quantity })));
    // Por hacer y reconocido en lo detectado = lo que se hizo hoy: nace marcado.
    const reconocidas = new Set(emparejado.delPlan.map((m) => m.filaId));
    setMarcadas(new Set(filasPlan.filter((f) => f.estado !== "hecho" && reconocidas.has(f.id)).map((f) => f.id)));
  }, [open, detectados, emparejado, filasPlan]);

  const porHacer = filasPlan.filter((f) => !f.cancelado && f.estado !== "hecho" && !hechasHoy.has(f.id));
  const yaHechas = filasPlan.filter((f) => !f.cancelado && (f.estado === "hecho" || hechasHoy.has(f.id)));
  const hayPlan = filasPlan.some((f) => !f.cancelado);
  // Presupuesto y factura, solo con lo que NO es de un plan (lo del plan ya tiene su nota).
  const ofreceFactura = rows.length > 0 || !hayPlan;

  // Nada del plan y nada detectado: no hay qué decidir (la ficha la abre por si el plan tenía algo).
  useEffect(() => {
    if (open && planes !== null && !hayPlan && initialTreatments.length === 0) onClose();
  }, [open, planes, hayPlan, initialTreatments.length, onClose]);

  function alternar(id: string) {
    setMarcadas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function marcarHechas() {
    const elegidas = porHacer.filter((f) => marcadas.has(f.id));
    if (elegidas.length === 0 || marcando) return;
    setMarcando(true);
    const hechas: string[] = [];
    let noDisponible = false;
    let error: string | null = null;
    try {
      // Una llamada por plan, con todas sus filas (una transacción y una fila de bitácora).
      const porPlan = new Map<string, string[]>();
      for (const f of elegidas) porPlan.set(f.planId, [...(porPlan.get(f.planId) ?? []), f.id]);
      for (const [planId, ids] of Array.from(porPlan.entries())) {
        const r = await marcarHecho(planId, ids, appointmentId || null);
        if (r.ok) { hechas.push(...ids); continue; }
        if (r.noDisponible) { noDisponible = true; break; }
        error = r.error ?? t("planTratamiento.cobro.hoyMarcarFallo");
        break;
      }
    } finally {
      setMarcando(false);
    }
    if (hechas.length) {
      setHechasHoy((prev) => new Set([...Array.from(prev), ...hechas]));
      setMarcadas((prev) => new Set(Array.from(prev).filter((id) => hechas.indexOf(id) === -1)));
      toast.success(t("planTratamiento.cobro.hoyMarcadas", { count: hechas.length }));
      onHechos?.();
    }
    if (noDisponible) toast(t("planTratamiento.cobro.hoyMarcarPronto"), { duration: 9000 });
    else if (error) toast.error(error);
  }

  // Misma aritmética que el servidor (invoice-totals): Σ round2(qty × precio),
  // no round2(Σ …). Con precios sub-centavo los dos difieren en centavos y el
  // botón anunciaría un total distinto al que se guarda.
  const subtotal = useMemo(() => sumInvoiceItems(rows), [rows]);
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
            procedureCatalogId: r.procedureCatalogId ?? null,
          })),
          // Las filas del plan que ya cubren lo apartado de esta cita: el servidor no las vuelve a contar.
          filasApartadas: Array.from(new Set(emparejado.delPlan.map((m) => m.filaId))),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(t("patients.treatmentsModal.invoiceCreated", { number: data.invoice.invoiceNumber }));
      // Nació con el saldo a favor del paciente (anticipo) ya descontado.
      if (data.anticipoAplicado > 0) {
        toast(t("billing.invoiceEditor.anticipoAplicadoToast", {
          monto: formatCurrency(data.anticipoAplicado),
          resta: formatCurrency(data.invoice.balance ?? 0),
        }), { duration: 10000 });
      }
      onInvoiced?.(data.invoice);
      onClose();
    } catch (err) {
      toast.error(mensajeDeError(err, t, { porDefecto: t("patients.treatmentsModal.invoiceFailed") }));
    } finally {
      setCreating(false);
    }
  }

  // Crea un presupuesto DRAFT con las mismas sugerencias (queda en la pestaña
  // "Presupuestos" del paciente para presentarlo/aceptarlo después).
  async function createQuote() {
    if (rows.length === 0 || creatingQuote) return;
    setCreatingQuote(true);
    try {
      const res = await fetch(`/api/quotes/from-appointment`, {
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
            procedureCatalogId: r.procedureCatalogId,
          })),
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(t("patients.treatmentsModal.quoteCreated", { folio: data.folio }));
      onClose();
    } catch (err) {
      toast.error(mensajeDeError(err, t, { porDefecto: t("patients.treatmentsModal.quoteFailed") }));
    } finally {
      setCreatingQuote(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={styles.treatmentsModal}>
        <div className={styles.treatmentsHead}>
          <div>
            <h2 className={styles.treatmentsTitle}>
              <FileText size={14} aria-hidden /> {t("patients.treatmentsModal.title")}
            </h2>
            <p className={styles.treatmentsSub}>
              {rows.length === 0
                ? (emparejado.delPlan.length > 0 ? t("planTratamiento.cobro.hoyNadaFuera") : t("patients.treatmentsModal.noChanges"))
                : t("patients.treatmentsModal.changesDetected", { count: rows.length })}
            </p>
          </div>
        </div>

        {patientId && planes === null && (
          <div className={styles.treatmentsBody}><p className={styles.treatmentsSub}>{t("common.loading")}</p></div>
        )}

        {hayPlan && (
          <section className={`${styles.treatmentsBody} ${styles.hoyPlan}`} data-hoy-plan aria-labelledby="hoy-plan-titulo">
            <h3 id="hoy-plan-titulo" className={styles.hoyPlanTitulo}>
              <ListChecks size={13} aria-hidden /> {t("planTratamiento.cobro.hoyTitulo")}
            </h3>
            <p className={styles.treatmentsSub}>{t("planTratamiento.cobro.hoyAyuda")}</p>
            {porHacer.length > 0 && (
              <ul className={styles.hoyPlanLista}>
                {porHacer.map((f) => (
                  <li key={f.id}>
                    <label className={styles.hoyPlanFila}>
                      <input type="checkbox" checked={marcadas.has(f.id)} onChange={() => alternar(f.id)} disabled={!puedeMarcarHecho || marcando} data-hoy-fila={f.id} />
                      <span className={styles.treatmentsName}>{f.nombre}</span>
                      {f.dientes.length > 0 && <span className={styles.hoyPlanDato}>{f.dientes.join(", ")}</span>}
                      <span className={styles.hoyPlanDato}>{f.plan}</span>
                      <span className={`${styles.hoyPlanDato} ${styles.hoyPlanImporte}`}>{fmtMXNdec(f.dto.importe)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {yaHechas.length > 0 && (
              <p className={styles.treatmentsSub}>
                {t("planTratamiento.cobro.hoyYaHechas", { lista: yaHechas.map((f) => f.nombre).join(", ") })}
              </p>
            )}
            {!puedeMarcarHecho && porHacer.length > 0 && <p className={styles.treatmentsSub}>{t("planTratamiento.cobro.hoySinPermiso")}</p>}
            <div className={styles.hoyPlanAcciones}>
              {puedeMarcarHecho && porHacer.length > 0 && (
                <button type="button" className={styles.treatmentsCreate} onClick={() => void marcarHechas()} disabled={marcando || porHacer.every((f) => !marcadas.has(f.id))} data-hoy-marcar>
                  {marcando ? t("patients.treatmentsModal.creating") : t("planTratamiento.cobro.hoyMarcar", { count: porHacer.filter((f) => marcadas.has(f.id)).length })}
                </button>
              )}
              {onCobrarHoy && (
                <button type="button" className={styles.treatmentsCancel} onClick={() => { onClose(); onCobrarHoy(); }} data-hoy-abonar>
                  <Wallet size={12} aria-hidden /> {t("planTratamiento.cobro.abonar")}
                </button>
              )}
            </div>
          </section>
        )}

        {rows.length > 0 && hayPlan && (
          <p className={`${styles.treatmentsSub} ${styles.hoyFuera}`}>{t("planTratamiento.cobro.hoyFuera")}</p>
        )}

        {rows.length > 0 && (
          <div className={styles.treatmentsBody}>
            {/* En un teléfono la tabla se desliza sola, sin mover la ventana. */}
            <div className={styles.treatmentsTablaCaja}>
            <table className={styles.treatmentsTable}>
              <thead>
                <tr>
                  <th>{t("patients.treatmentsModal.colTreatment")}</th>
                  <th style={{ width: 60 }}>{t("patients.treatmentsModal.colTooth")}</th>
                  <th style={{ width: 90 }}>{t("patients.treatmentsModal.colSurface")}</th>
                  <th style={{ width: 50 }}>{t("patients.treatmentsModal.colQty")}</th>
                  <th style={{ width: 110 }}>{t("patients.treatmentsModal.colPrice")}</th>
                  <th style={{ width: 110, textAlign: "right" }}>{t("patients.treatmentsModal.colSubtotal")}</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r._key}>
                    <td className={styles.treatmentsName}>{r.name}</td>
                    <td className={styles.mono}>{r.toothNumber ?? "—"}</td>
                    {/* la base guarda la incisal de un anterior como «O»: rotuloCara dice «Incisal» */}
                    <td>{rotuloCara(r.toothNumber, r.surface) ?? "—"}</td>
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
                      {formatCurrency(itemLineTotal(r))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.treatmentsRemove}
                        onClick={() => removeRow(idx)}
                        aria-label={t("patients.treatmentsModal.remove")}
                      >
                        <Trash2 size={11} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className={styles.treatmentsTotals}>
              <div className={styles.treatmentsTotalsRow}>
                <span>{t("patients.treatmentsModal.subtotal")}</span>
                <strong className={styles.mono}>{formatCurrency(subtotal)}</strong>
              </div>
              <div className={styles.treatmentsTotalsRow}>
                <span>{t("patients.treatmentsModal.discount")}</span>
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
                <span>{t("common.total")}</span>
                <strong className={styles.mono}>{formatCurrency(total)}</strong>
              </div>
            </div>
          </div>
        )}

        <footer className={styles.treatmentsFoot}>
          {/* v14 (QA de Claude): no hay factura que cancelar. Si la ventana no ofrece factura (todo es de un
              plan: ya está en su nota y se cobra con «Cobrar hoy»), el botón dice «Cerrar»; si la ofrece
              (algo de fuera de todo plan), «No facturar». Antes decía «Cancelar factura» en los dos casos. */}
          <button
            type="button"
            className={styles.treatmentsCancel}
            onClick={onClose}
            data-hoy-salir={ofreceFactura ? "no-facturar" : "cerrar"}
          >
            <X size={12} aria-hidden /> {ofreceFactura ? t("patients.treatmentsModal.noFacturar") : t("common.close")}
          </button>
          {/* Presupuesto y factura, solo con lo que NO es de un plan (lo del plan ya tiene su nota). */}
          {ofreceFactura && (
            <>
              <button
                type="button"
                className={styles.treatmentsCancel}
                onClick={() => void createQuote()}
                disabled={rows.length === 0 || creatingQuote || planes === null}
              >
                <FileText size={12} aria-hidden /> {creatingQuote ? t("patients.treatmentsModal.creating") : t("patients.treatmentsModal.createQuote")}
              </button>
              <button
                type="button"
                className={styles.treatmentsCreate}
                onClick={() => void createInvoice()}
                disabled={rows.length === 0 || creating || planes === null}
                data-hoy-factura
              >
                {creating ? t("patients.treatmentsModal.creating") : t("patients.treatmentsModal.createInvoice", { total: formatCurrency(total) })}
              </button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
