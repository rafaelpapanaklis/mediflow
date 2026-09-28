import Link from "next/link";
import { BellRing, Users, Wallet } from "lucide-react";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { OrthoModulePlaceholder } from "@/components/specialties/orthodontics/OrthoModulePlaceholder";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

// Ola 0 (ws1-t1) · dueñas en la Ola 1: «Cobro» (la cobranza de cada caso,
// vía cobranza-caso.ts) y «Recepción» (ListaMensualidades, la vista de
// Caja/Hoy) — comparten el contrato de la Ola 0, ninguna lo cambia sola.
//
// Diseño (ws1-t3): el cartel le habla a la clínica, no a quien programa, y
// dice dónde se ve HOY la cobranza.
export default async function OrthodonticsCobranzaPage() {
  await exigirModuloOrtodoncia();
  return (
    <OrthoModulePlaceholder
      icon={Wallet}
      title="Cobranza de mensualidades"
      description="Aquí vas a ver quién debe, cuánto y desde cuándo, caso por caso. Mientras tanto, las mensualidades vencidas están en Alertas, y el saldo y la próxima mensualidad de cada paciente en Pacientes en tratamiento."
    >
      <Link href="/dashboard/orthodontics/alertas" className={s.boton}>
        <BellRing size={15} strokeWidth={1.9} aria-hidden />
        Ver alertas
      </Link>
      <Link href="/dashboard/orthodontics/pacientes" className={s.boton}>
        <Users size={15} strokeWidth={1.9} aria-hidden />
        Pacientes en tratamiento
      </Link>
    </OrthoModulePlaceholder>
  );
}
