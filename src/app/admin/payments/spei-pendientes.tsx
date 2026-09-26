"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Landmark, X, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fechaHoraAdmin } from "@/lib/admin/zona-horaria";
import { centavosAMxn } from "@/lib/billing/spei-directo-core";
import type { PendienteAdminDTO } from "@/lib/billing/spei-directo";

/**
 * Transferencias SPEI (directas a la cuenta de la plataforma) que las clínicas
 * dicen haber hecho y que esperan tu confirmación. Cada fila trae lo que hace
 * falta para cotejarla con el banco: clínica, plan, periodo, importe EXACTO y
 * la referencia que la clínica puso en el concepto.
 *
 * «Confirmar pago» activa la clínica (misma lógica que un pago manual: factura
 * pagada, plan, periodo extendido); «Rechazar» pide un motivo, que la clínica
 * verá. Una vez resuelta, la fila desaparece de aquí; el cobro queda en la
 * pestaña «Todos los pagos» y la bitácora de la clínica.
 */
export function SpeiPendientes({ items }: { items: PendienteAdminDTO[] }) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const [filas, setFilas] = useState(items);
  // router.refresh() trae props nuevas (otra clínica declaró): se reflejan sin recargar la página.
  useEffect(() => setFilas(items), [items]);
  const [cargando, setCargando] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<PendienteAdminDTO | null>(null);
  const [motivo, setMotivo] = useState("");

  async function llamar(id: string, accion: "confirmar" | "rechazar", cuerpo?: object): Promise<boolean> {
    setCargando(id);
    try {
      const res = await fetch(`/api/admin/spei-transferencias/${id}/${accion}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo ?? {}),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo completar");
      setFilas((prev) => prev.filter((f) => f.id !== id));
      router.refresh();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setCargando(null);
    }
  }

  async function confirmar(f: PendienteAdminDTO) {
    const periodo = f.billing === "annual" ? "un año" : "un mes";
    const ok = await askConfirm({
      title: "Confirmar transferencia",
      description:
        `Confirma solo si ya ves ${centavosAMxn(f.amountCents)} MXN de ${f.clinicName} en tu banco ` +
        `(referencia ${f.reference}). Se activará su plan ${f.plan} por ${periodo}.` +
        (f.clinicaYaActiva ? " OJO: esta clínica ya está activa; se sumará otro periodo (verifica que no sea un doble pago)." : "") +
        (f.suscripcionTarjetaViva ? " OJO: tiene una suscripción de TARJETA viva en Stripe; confirmar NO la cancela y podría cobrarle también (cancélala en Stripe si va a pagar por transferencia)." : ""),
      confirmText: "Confirmar pago",
    });
    if (!ok) return;
    if (await llamar(f.id, "confirmar")) toast.success(`Pago confirmado: ${f.clinicName} quedó activa`);
  }

  async function rechazar() {
    if (!rechazando) return;
    if (await llamar(rechazando.id, "rechazar", { reason: motivo })) {
      toast.success("Transferencia rechazada");
      setRechazando(null);
      setMotivo("");
    }
  }

  const hay = filas.length > 0;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 0" }} id="transferencias-spei">
      <div
        style={{
          borderRadius: 14,
          border: hay ? "1.5px solid rgba(245,158,11,0.55)" : "1px solid var(--border-soft)",
          background: hay ? "rgba(245,158,11,0.06)" : "transparent",
          overflow: "hidden",
        }}
      >
        <CardNew
          noPad
          title={hay ? `Transferencias por confirmar (${filas.length})` : "Transferencias SPEI por confirmar"}
          sub={
            hay
              ? "Las clínicas de abajo dicen haber transferido y NO tienen acceso hasta que las confirmes."
              : "Ninguna pendiente. Aquí aparecen las transferencias que declaren las clínicas."
          }
          action={<Landmark size={18} style={{ color: hay ? "var(--warning)" : "var(--text-3)" }} aria-hidden />}
        >
          {hay ? (
            <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Plan</th>
                  <th>Periodo</th>
                  <th>Importe a recibir</th>
                  <th>Referencia</th>
                  <th>Declarada</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <div style={{ color: "var(--text-1)", fontWeight: 500 }}>{f.clinicName}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)" }}>{f.clinicEmail ?? "—"}</div>
                      {f.suscripcionTarjetaViva && (
                        <div style={{ fontSize: 11, color: "var(--warning)", display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}>
                          <AlertTriangle size={11} aria-hidden /> Tarjeta viva en Stripe (¿doble cobro?)
                        </div>
                      )}
                      {f.clinicaYaActiva && (
                        <div style={{ fontSize: 11, color: "var(--warning)", display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}>
                          <AlertTriangle size={11} aria-hidden /> Ya está activa (¿doble pago?)
                        </div>
                      )}
                    </td>
                    <td>
                      <BadgeNew tone={f.plan === "CLINIC" ? "brand" : f.plan === "PRO" ? "info" : "neutral"}>{f.plan}</BadgeNew>
                    </td>
                    <td style={{ color: "var(--text-2)" }}>{f.billing === "annual" ? "Anual" : "Mensual"}</td>
                    <td className="mono" style={{ color: "var(--success)", fontWeight: 600 }}>
                      {centavosAMxn(f.amountCents)}
                      {f.ivaCents > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 400 }}>
                          {centavosAMxn(f.subtotalCents)} + IVA
                        </div>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>{f.reference}</td>
                    <td style={{ fontSize: 11, color: "var(--text-3)" }}>{fechaHoraAdmin(f.createdAt) ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <ButtonNew size="sm" variant="primary" onClick={() => confirmar(f)} disabled={cargando === f.id}>
                          {cargando === f.id ? "…" : "Confirmar pago"}
                        </ButtonNew>
                        <ButtonNew size="sm" variant="danger" onClick={() => { setRechazando(f); setMotivo(""); }} disabled={cargando === f.id}>
                          Rechazar
                        </ButtonNew>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <div style={{ padding: "18px 0", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              <CheckCircle2 size={18} style={{ color: "var(--success)", margin: "0 auto 4px" }} aria-hidden />
              Nada por confirmar
            </div>
          )}
        </CardNew>
      </div>

      {rechazando && (
        <div className="modal-overlay" onClick={() => setRechazando(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">Rechazar transferencia</div>
              <button className="btn-new btn-new--ghost btn-new--sm" onClick={() => setRechazando(null)} aria-label="Cerrar">
                <X size={14} />
              </button>
            </div>
            <div className="modal__body">
              <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 0 }}>
                {rechazando.clinicName} · {centavosAMxn(rechazando.amountCents)} · {rechazando.reference}. La clínica verá este
                motivo y podrá intentarlo de nuevo o pagar con tarjeta.
              </p>
              <div className="field-new">
                <label className="field-new__label">Motivo del rechazo</label>
                <textarea
                  className="input-new"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="No encontramos el depósito, el importe no coincide, etc."
                />
              </div>
            </div>
            <div className="modal__footer">
              <ButtonNew variant="ghost" onClick={() => setRechazando(null)}>Cancelar</ButtonNew>
              <ButtonNew variant="danger" onClick={rechazar} disabled={!motivo.trim() || cargando === rechazando.id}>
                {cargando === rechazando.id ? "Rechazando…" : "Confirmar rechazo"}
              </ButtonNew>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
