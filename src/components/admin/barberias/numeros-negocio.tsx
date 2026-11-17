"use client";

// ═══════════════════════════════════════════════════════════════════════
// /admin/barberias/[id] — «Números del negocio» (ws6-t1, 16-nov-2026).
// Rafael: «en admin en cada barbería debo poder ver cuántos clientes tiene,
// facturas pagadas, dinero etc. así como en dental».
//
// Lo de la barbería con SUS clientes (no lo que nos paga a nosotros: eso es
// «Lo que esta barbería te ha pagado»). Por mes, con el selector de
// «Actividad del panel», y con desglose por sede. Solo conteos y sumas:
// ningún nombre ni teléfono de un cliente final.
//
// Datos: GET /api/admin/barberias/[id]/numeros?mes=YYYY-MM (solo admin). Se
// pide desde el navegador, como la actividad: la ficha no espera por esto.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Package,
  Receipt,
  Scissors,
  Sparkles,
  TrendingDown,
  Star,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import type { DineroMes, NumerosNegocio, NumerosSede } from "@/lib/barber/admin-numeros";
import type { ResumenIncomeMethod } from "@/lib/barber/caja-resumen";
import { formatInt, formatMoney } from "./shared";

const METODO: Record<ResumenIncomeMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  SPEI: "Transferencia",
  ONLINE: "En línea",
};
const METODOS: ResumenIncomeMethod[] = ["CASH", "CARD", "SPEI", "ONLINE"];

const dinero = (d: DineroMes | null | undefined, k: keyof Pick<DineroMes, "cobrado" | "ingresos" | "propinas" | "gastos" | "promedio">) =>
  d ? formatMoney(d[k]) : "—";

function delta(pct: number | null, etiquetaAnterior: string) {
  if (pct === null) return undefined;
  return {
    value: `${pct > 0 ? "+" : ""}${pct.toLocaleString("es-MX")}%`,
    direction: (pct >= 0 ? "up" : "down") as "up" | "down",
    sub: `vs ${etiquetaAnterior}`,
  };
}

function FilaSede({ s }: { s: NumerosSede }) {
  return (
    <tr>
      <td>
        <span style={{ fontSize: 12.5, color: "var(--text-1)" }}>{s.nombre}</span>
        <div className="dcba-note">
          {s.esMatriz ? "Matriz" : "Sucursal"}
          {s.activa ? "" : " · cerrada"}
        </div>
      </td>
      <td className="mono" style={{ textAlign: "right" }}>
        {formatInt(s.clientes)}
        <div className="dcba-note">+{formatInt(s.clientesNuevos)} nuevos</div>
      </td>
      <td className="mono" style={{ textAlign: "right" }}>
        {formatInt(s.citas.hechas)}
        <div className="dcba-note">de {formatInt(s.citas.total)}</div>
      </td>
      <td className="mono" style={{ textAlign: "right" }}>{s.dinero ? formatInt(s.dinero.tickets) : "—"}</td>
      <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>
        {dinero(s.dinero, "cobrado")}
        {s.dinero && s.dinero.propinas > 0 && <div className="dcba-note">{formatMoney(s.dinero.propinas)} propinas</div>}
      </td>
      <td className="mono dcba-col-wide" style={{ textAlign: "right" }}>{dinero(s.dinero, "gastos")}</td>
      <td className="mono dcba-col-wide" style={{ textAlign: "right" }}>{formatInt(s.membresiasActivas)}</td>
      <td className="mono dcba-col-wide" style={{ textAlign: "right" }}>{formatInt(s.barberosActivos)}</td>
    </tr>
  );
}

export function NumerosNegocioPanel({ barbershopId }: { barbershopId: string }) {
  const [mesPedido, setMesPedido] = useState<string | null>(null);
  const [data, setData] = useState<NumerosNegocio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    fetch(`/api/admin/barberias/${barbershopId}/numeros${mesPedido ? `?mes=${mesPedido}` : ""}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: NumerosNegocio) => {
        if (vivo) setData(j);
      })
      .catch(() => vivo && setError("No se pudieron cargar los números del negocio."))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [barbershopId, mesPedido]);

  const t = data?.total;
  const d = t?.dinero ?? null;
  const prev = data?.dineroAnterior ?? null;

  return (
    <CardNew>
      <div className="dcba-uso-head">
        <div className="dcba-cardtitle" style={{ marginBottom: 0 }}>
          <BarChart3 size={14} />
          Números del negocio
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label className="dcba-uso-mes">
            <span className="dcba-label" style={{ marginBottom: 0 }}>
              Mes
            </span>
            <select
              className="input-new"
              value={data?.mes.clave ?? ""}
              disabled={!data || cargando}
              onChange={(e) => setMesPedido(e.target.value)}
              aria-label="Mes de los números del negocio"
            >
              {(data?.meses ?? []).map((m) => (
                <option key={m.clave} value={m.clave}>
                  {m.etiqueta}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <p className="dcba-note" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : !data || !t ? (
        <div className="dcba-uso-esqueleto" aria-busy="true">
          Cargando los números…
        </div>
      ) : (
        <div style={{ opacity: cargando ? 0.6 : 1, transition: "opacity .15s" }}>
          <p className="dcba-note" style={{ marginTop: 0 }}>
            {data.esSucursal
              ? "Solo esta sucursal. La cadena completa se ve en la ficha de su matriz."
              : data.sedes.length > 1
                ? `Toda la cadena: la matriz y ${data.sedes.length - 1 === 1 ? "su sucursal" : `sus ${formatInt(data.sedes.length - 1)} sucursales`}. Abajo, sede por sede.`
                : "La matriz (no tiene sucursales)."}
          </p>

          <div className="dcba-kpis" style={{ marginBottom: 16 }}>
            <KpiCard
              label="Cobrado del mes"
              value={dinero(d, "cobrado")}
              icon={Wallet}
              hero
              delta={delta(data.cambioCobradoPct, data.anterior.etiqueta)}
              hint={d ? `${formatMoney(d.propinas)} de propinas · ${data.anterior.etiqueta}: ${dinero(prev, "cobrado")}` : "Falta sql/barber_caja_completa.sql"}
            />
            <KpiCard
              label="Tickets"
              value={d ? formatInt(d.tickets) : "—"}
              icon={Receipt}
              hint={d ? `promedio ${formatMoney(d.promedio)} · ${data.anterior.etiqueta}: ${prev ? formatInt(prev.tickets) : "—"}` : undefined}
            />
            <KpiCard
              label="Clientes"
              value={formatInt(t.clientes)}
              icon={Users}
              hint={`+${formatInt(t.clientesNuevos)} nuevos en el mes`}
            />
            <KpiCard
              label="Citas del mes"
              value={formatInt(t.citas.total)}
              icon={CalendarDays}
              hint={`${formatInt(t.citas.hechas)} hechas · ${formatInt(t.citas.canceladas)} canceladas · ${formatInt(t.citas.noLlego)} no llegó`}
            />
            <KpiCard
              label="Gastos del mes"
              value={dinero(d, "gastos")}
              icon={TrendingDown}
              hint={d ? `${formatInt(d.gastosCount)} ${d.gastosCount === 1 ? "gasto" : "gastos"} en Caja` : undefined}
            />
            <KpiCard label="Membresías activas" value={formatInt(t.membresiasActivas)} icon={Sparkles} hint="vigentes hoy" />
            <KpiCard
              label="Pedidos de la tienda"
              value={t.pedidos ? formatInt(t.pedidos.delMes) : "—"}
              icon={Package}
              hint={
                t.pedidos
                  ? `${formatInt(t.pedidos.pagadosEnLinea)} pagados en línea · ${formatMoney(t.pedidos.cobradoEnLinea)}`
                  : "Sin tienda (falta sql/barber_tienda.sql)"
              }
            />
            <KpiCard label="Barberos activos" value={formatInt(t.barberosActivos)} icon={Scissors} />
            <KpiCard label="Usuarios del panel" value={formatInt(t.usuariosPanel)} icon={UserPlus} hint="activos" />
            <KpiCard label="Estrellas dadas" value={formatInt(t.estrellasDadas)} icon={Star} hint="visitas del mes que dieron estrella" />
          </div>

          {d && (
            <>
              <div className="dcba-label">Cobrado por medio (propinas incluidas)</div>
              <div className="dcba-tablewrap" style={{ marginBottom: 16 }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Medio</th>
                      <th style={{ textAlign: "right" }}>{data.mes.etiqueta}</th>
                      <th style={{ textAlign: "right" }}>{data.anterior.etiqueta}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METODOS.map((m) => (
                      <tr key={m}>
                        <td>{METODO[m]}</td>
                        <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>
                          {formatMoney(d.porMetodo[m]?.total ?? 0)}
                          <div className="dcba-note">{formatInt(d.porMetodo[m]?.count ?? 0)} tickets</div>
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {prev ? formatMoney(prev.porMetodo[m]?.total ?? 0) : "—"}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>Total</strong>
                        <div className="dcba-note">de eso, propinas (son del barbero)</div>
                      </td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>
                        <strong>{formatMoney(d.cobrado)}</strong>
                        <div className="dcba-note">{formatMoney(d.propinas)}</div>
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        <strong>{dinero(prev, "cobrado")}</strong>
                        <div className="dcba-note">{dinero(prev, "propinas")}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {data.sedes.length > 1 && (
            <>
              <div className="dcba-label">Por sede</div>
              <div className="dcba-tablewrap">
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Sede</th>
                      <th style={{ textAlign: "right" }}>Clientes</th>
                      <th style={{ textAlign: "right" }}>Citas hechas</th>
                      <th style={{ textAlign: "right" }}>Tickets</th>
                      <th style={{ textAlign: "right" }}>Cobrado</th>
                      <th className="dcba-col-wide" style={{ textAlign: "right" }}>Gastos</th>
                      <th className="dcba-col-wide" style={{ textAlign: "right" }}>Membresías</th>
                      <th className="dcba-col-wide" style={{ textAlign: "right" }}>Barberos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sedes.map((s) => (
                      <FilaSede key={s.id} s={s} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="dcba-note" style={{ marginTop: 14 }}>
            Lo que la barbería cobra a SUS clientes, con la misma cuenta que su Caja, Inicio y Reportes
            (tickets vivos, devoluciones de anticipo restadas). Los pedidos pagados en línea entran a la Caja
            («En línea») cuando se entregan. Las estrellas cuentan las visitas del mes que dieron estrella
            (no las dadas o quitadas a mano). Meses cortados a la medianoche de Mérida.
            {data.truncado ? " ⚠ Alguna sede pasó del tope de movimientos: los gastos pueden estar incompletos." : ""}
          </p>
        </div>
      )}
    </CardNew>
  );
}
