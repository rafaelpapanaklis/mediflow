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
  const [enviando, setEnviando] = useState<"a_favor" | "reembolso" | null>(null);
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
        toast.error(out?.error ?? "No se pudo guardar la decisión.", { duration: 9000 });
        return;
      }
      toast.success(decision === "a_favor" ? "Quedó a favor del paciente; la factura se canceló." : "Marcado para reembolso.");
      onListo?.();
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div role="status" className="mt-3 rounded-lg border border-[color:var(--warning-strong,#b45309)] px-3 py-2 text-xs space-y-2">
      <p className="font-semibold">
        La cita de esta factura se canceló. {avisoDeDinero(pagado)}{" "}
        {marca === "reembolso" ? "Está marcado POR REEMBOLSAR." : "Falta decidir qué pasa con ese dinero."}
      </p>
      {marca === "reembolso" ? (
        <p>DaleControl no mueve dinero: devuélvelo por Mercado Pago o en efectivo y después regístralo aquí con «Reembolsar».</p>
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
