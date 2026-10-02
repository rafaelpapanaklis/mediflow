"use client";

// Aviso en el detalle de la factura cuya CITA se canceló con dinero pagado
// (H15, opción A — ws1-t4). Lee la marca de las notas:
//   · «pendiente de decidir» → lo dice y, a quien tiene permiso de cobro, le
//     deja elegir aquí: saldo a favor o marcar para reembolso.
//   · «por reembolsar» → recuerda que el reembolso real se hace fuera y se
//     registra con «Reembolsar».
// Sin marca (o factura cancelada / sin dinero) no pinta nada.

import { useState } from "react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { avisoDeDinero, ultimaMarca } from "@/lib/anticipos/cita-cancelada-core";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { useT } from "@/i18n/i18n-provider";

export function AvisoDineroCitaCancelada({
  invoiceId,
  notas,
  pagado,
  estado,
  puedeCobrar,
  onListo,
}: {
  invoiceId: string;
  notas: string | null | undefined;
  pagado: number;
  estado: string;
  puedeCobrar: boolean;
  onListo?: () => void;
}) {
  const t = useT();
  const [enviando, setEnviando] = useState<"a_favor" | "reembolso" | "devuelto" | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const marca = ultimaMarca(notas);
  if (!marca || marca === "a_favor" || estado === "CANCELLED" || !(pagado > 0)) return null;

  async function decidir(decision: "a_favor" | "reembolso") {
    if (enviando) return;
    setEnviando(decision);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/dinero-cita`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(mensajeDeError(out, t, { porDefecto: "No se pudo guardar la decisión." }), { duration: 9000 });
        return;
      }
      toast.success(decision === "a_favor" ? "Quedó a favor del paciente; la factura se canceló." : "Marcado para reembolso.");
      onListo?.();
    } finally {
      setEnviando(null);
    }
  }

  // «Ya lo devolví»: el servidor registra el reembolso y cancela la factura en
  // UNA sola operación (o no hace nada). DaleControl no mueve dinero: esto
  // solo anota que ya se devolvió. Si falla, el mensaje del servidor dice qué
  // hacer y la factura queda tal cual.
  async function registrarDevuelto() {
    if (enviando) return;
    setEnviando("devuelto");
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/dinero-cita`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "devuelto" }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`No se registró nada: la factura sigue igual. ${out?.error ?? "Vuelve a intentarlo."}`, { duration: 12000 });
        return;
      }
      toast.success("Reembolso registrado y factura cancelada.");
      onListo?.();
    } finally {
      setEnviando(null);
      setConfirmando(false);
    }
  }

  return (
    <div role="status" className="mt-3 rounded-lg border border-[color:var(--warning-strong,#b45309)] px-3 py-2 text-xs space-y-2">
      <p className="font-semibold">
        La cita de esta factura se canceló. {avisoDeDinero(pagado)}{" "}
        {marca === "reembolso" ? "Está marcado POR REEMBOLSAR." : "Falta decidir qué pasa con ese dinero."}
      </p>
      {marca === "reembolso" ? (
        <>
          <p>DaleControl no mueve dinero: devuélvelo por Mercado Pago o en efectivo y después regístralo aquí.</p>
          {puedeCobrar &&
            (confirmando ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>¿Ya se lo devolviste al paciente?</span>
                <ButtonNew variant="danger" size="sm" disabled={enviando !== null} onClick={registrarDevuelto}>
                  {enviando === "devuelto" ? "Registrando…" : "Sí, registrar reembolso"}
                </ButtonNew>
                <ButtonNew variant="ghost" size="sm" disabled={enviando !== null} onClick={() => setConfirmando(false)}>
                  No
                </ButtonNew>
              </div>
            ) : (
              <ButtonNew variant="secondary" size="sm" onClick={() => setConfirmando(true)}>
                Ya lo devolví: registrar reembolso
              </ButtonNew>
            ))}
        </>
      ) : puedeCobrar ? (
        <div className="flex flex-wrap gap-2">
          <ButtonNew variant="secondary" size="sm" disabled={enviando !== null} onClick={() => decidir("a_favor")}>
            {enviando === "a_favor" ? "Guardando…" : "Dejar a favor del paciente"}
          </ButtonNew>
          <ButtonNew variant="secondary" size="sm" disabled={enviando !== null} onClick={() => decidir("reembolso")}>
            {enviando === "reembolso" ? "Guardando…" : "Marcar para reembolso"}
          </ButtonNew>
        </div>
      ) : (
        <p>Lo decide quien tiene permiso de cobro.</p>
      )}
    </div>
  );
}
