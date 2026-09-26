"use client";

/**
 * Resumen de la ficha de clínica (rediseño ws1-t2): lo que Rafael tiene que
 * ver de un vistazo antes de bajar a las pestañas. Sólo PRESENTACIÓN: recibe
 * datos ya calculados y no llama a nada. Vive en su propio archivo para no
 * mover la lógica de `clinic-detail-client.tsx`, que comparte con el PR #425.
 *
 * De dónde sale cada dato: ver `@/lib/admin/uso-core` (almacenamiento con el
 * criterio de storage-quota, CFDI de cfdi_usage, usuarios activos, sedes por
 * dueño, saldo de ai_wallets) y `@/lib/admin/salud-clinica` (estado).
 */
import { CalendarClock, Coins, FileCheck2, HardDrive, Sparkles, Users, Building2, Clock } from "lucide-react";
import { DatoCaja } from "@/components/admin/rediseno/piezas";
import { bytesCortos, metodoDePago, nivelCupo, pctCupo, tokensCortos, type DatosMetodoPago, type UsoClinica } from "@/lib/admin/uso-core";
import { fechaAdmin, fechaHoraAdmin } from "@/lib/admin/zona-horaria";
import { fmtMXNdec } from "@/lib/format";
import { estadoMonedero, ETIQUETA_ESTADO_MONEDERO } from "@/lib/ai-billing/saldo-estado";

export interface ResumenClinicaProps {
  uso: UsoClinica | null;
  pacientes: number;
  /** Tope de pacientes del plan; null = ilimitado. */
  pacientesTope: number | null;
  nextBillingDate: string | Date | null;
  /** Fin del periodo con acceso (plan-status.periodEnd). */
  periodoHasta: string | Date | null;
  metodo: DatosMetodoPago;
  ultimoAccesoAt: string | Date | null;
  enLinea: boolean;
  ultimoPagoAt: string | null;
  ultimoPagoMonto: number | null;
}

function pie(usado: number | null, tope: number | null, fmt: (n: number) => string): string {
  if (usado === null) return "sin dato";
  if (tope === null || tope <= 0) return `${fmt(usado)} · sin tope`;
  return `${fmt(usado)} de ${fmt(tope)}`;
}

export function ResumenClinica(p: ResumenClinicaProps) {
  const u = p.uso;
  const pago = metodoDePago(p.metodo);
  const saldo = u && u.saldoIaCents !== null
    ? { hasWallet: true, status: u.saldoIaStatus, balanceCents: u.saldoIaCents }
    : { hasWallet: false, status: null, balanceCents: null };
  const estadoSaldo = estadoMonedero(saldo);

  return (
    <div className="ad-resumen">
      <DatoCaja
        label="Almacenamiento" icono={HardDrive}
        n={u && u.storageUsado !== null ? `${pctCupo(u.storageUsado, u.storageTope) ?? "—"}%` : "—"}
        pie={u ? pie(u.storageUsado, u.storageTope, bytesCortos) : "sin medir"}
        nivel={u && u.storageUsado !== null ? nivelCupo(u.storageUsado, u.storageTope) : undefined}
        barra={u && u.storageUsado !== null ? pctCupo(u.storageUsado, u.storageTope) : null}
      />
      <DatoCaja
        label="Tokens IA del mes" icono={Sparkles}
        n={u ? (u.tokensTope > 0 ? `${pctCupo(u.tokensUsados, u.tokensTope)}%` : tokensCortos(u.tokensUsados)) : "—"}
        pie={u ? (u.tokensTope > 0 ? `${tokensCortos(u.tokensUsados)} de ${tokensCortos(u.tokensTope)}` : "el plan no incluye cupo de IA") : "sin medir"}
        nivel={u && u.tokensTope > 0 ? nivelCupo(u.tokensUsados, u.tokensTope) : undefined}
        barra={u && u.tokensTope > 0 ? pctCupo(u.tokensUsados, u.tokensTope) : null}
      />
      <DatoCaja
        label="Saldo IA" icono={Coins}
        n={saldo.hasWallet ? fmtMXNdec((saldo.balanceCents ?? 0) / 100) : "—"}
        pie={saldo.hasWallet ? ETIQUETA_ESTADO_MONEDERO[estadoSaldo] : "sin monedero (no aplica)"}
        nivel={estadoSaldo === "negativo" || estadoSaldo === "pausado" ? "lleno" : estadoSaldo === "saldo-bajo" ? "aviso" : "ok"}
      />
      <DatoCaja
        label="CFDI del mes" icono={FileCheck2}
        n={u && u.cfdiUsados !== null ? `${u.cfdiUsados}` : "—"}
        pie={u && u.cfdiUsados !== null ? `${u.cfdiIncluidos} incluidos${u.cfdiUsados > u.cfdiIncluidos ? ` · ${u.cfdiUsados - u.cfdiIncluidos} extra` : ""}` : "sin dato"}
        nivel={u && u.cfdiUsados !== null && u.cfdiIncluidos > 0 ? (u.cfdiUsados > u.cfdiIncluidos ? "lleno" : nivelCupo(u.cfdiUsados, u.cfdiIncluidos)) : undefined}
        barra={u && u.cfdiUsados !== null && u.cfdiIncluidos > 0 ? pctCupo(u.cfdiUsados, u.cfdiIncluidos) : null}
      />
      <DatoCaja
        label="Usuarios y sedes" icono={Users}
        n={u && u.usuarios !== null ? `${u.usuarios}${u.usuariosTope !== null ? ` / ${u.usuariosTope}` : ""}` : "—"}
        pie={u && u.sedes !== null ? `${u.sedes}${u.sedesTope !== null ? ` de ${u.sedesTope}` : ""} sede${u.sedes === 1 ? "" : "s"} del dueño` : "sedes: sin dato"}
        nivel={u && u.usuarios !== null ? nivelCupo(u.usuarios, u.usuariosTope) : undefined}
      />
      <DatoCaja
        label="Pacientes" icono={Building2}
        n={p.pacientes.toLocaleString("es-MX")}
        pie={p.pacientesTope === null ? "sin tope de plan" : `de ${p.pacientesTope.toLocaleString("es-MX")} del plan`}
        nivel={nivelCupo(p.pacientes, p.pacientesTope)}
        barra={pctCupo(p.pacientes, p.pacientesTope)}
      />
      <DatoCaja
        label="Próxima renovación" icono={CalendarClock}
        n={p.nextBillingDate ? fechaAdmin(p.nextBillingDate) ?? "—" : "—"}
        pie={`${pago.etiqueta}${p.periodoHasta ? ` · acceso hasta ${fechaAdmin(p.periodoHasta)}` : ""}`}
      />
      <DatoCaja
        label="Último acceso" icono={Clock}
        n={p.enLinea ? "Ahora" : p.ultimoAccesoAt ? fechaAdmin(p.ultimoAccesoAt) ?? "—" : "—"}
        pie={p.ultimoAccesoAt
          ? `${fechaHoraAdmin(p.ultimoAccesoAt)} · último pago ${p.ultimoPagoAt ? fechaAdmin(p.ultimoPagoAt) : "—"}`
          : `sin sesión registrada · último pago ${p.ultimoPagoAt ? fechaAdmin(p.ultimoPagoAt) : "—"}`}
      />
    </div>
  );
}
