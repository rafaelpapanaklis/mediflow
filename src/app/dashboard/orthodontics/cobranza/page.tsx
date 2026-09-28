import { Wallet } from "lucide-react";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";

// Ola 0 (ws1-t1) · dueñas en la Ola 1: «Cobro» (la cobranza de cada caso,
// vía cobranza-caso.ts) y «Recepción» (ListaMensualidades, la vista de
// Caja/Hoy) — comparten el contrato de la Ola 0, ninguna lo cambia sola.
export default function OrthodonticsCobranzaPage() {
  return (
    <OrthoModulePlaceholder
      icon={Wallet}
      title="Cobranza de mensualidades"
      description="Quién debe, cuánto y desde cuándo, por caso. Lo arman «Cobro» y «Recepción» en la Ola 1, sobre el contrato de cobranza-caso.ts — ver REPORTE-ws1-t1.md."
    />
  );
}
