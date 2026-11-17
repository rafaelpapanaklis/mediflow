"use client";

// ═══════════════════════════════════════════════════════════════════════
// /admin/barberias/[id] — «Actividad del panel» (ws6-t4, 16-nov-2026).
// Lo que pidió Rafael: «no puedo ver si el usuario dio clicks y cuántos en el
// mes». Por mes: días activos, sesiones, pantallas vistas, clics y usuarios;
// tabla por persona; pantallas y botones más usados; gráfica por día.
//
// Datos: GET /api/admin/barberias/[id]/actividad?mes=YYYY-MM (solo admin).
// Sin sql/barber_usage_events.sql pegado, lo dice y no truena.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarCheck, LogIn, Monitor, MousePointerClick, Users } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BARBER_ROLE_LABELS, type BarberRole } from "@/lib/barber/types";
import type { ActividadBarberia, UsoDia } from "@/lib/barber/uso/actividad";
import { formatInt, fullDate, relativeDate } from "./shared";

function diaCorto(dia: string): string {
  return String(Number(dia.slice(8, 10)));
}

function GraficaDias({ dias }: { dias: UsoDia[] }) {
  const [sobre, setSobre] = useState<UsoDia | null>(null);
  const max = Math.max(1, ...dias.map((d) => d.clics));
  const total = dias.reduce((s, d) => s + d.clics, 0);
  const detalle = sobre ?? null;
  return (
    <div>
      <div className="dcba-uso-chart__head">
        <div className="dcba-label" style={{ marginBottom: 0 }}>
          Clics por día
        </div>
        <div className="dcba-note" aria-live="polite">
          {detalle
            ? `${detalle.dia} · ${formatInt(detalle.clics)} clics · ${formatInt(detalle.vistas)} pantallas · ${formatInt(detalle.sesiones)} sesiones`
            : `${formatInt(total)} clics en ${formatInt(dias.length)} días · pasa el ratón por un día`}
        </div>
      </div>
      <div
        className="dcba-uso-chart"
        role="img"
        aria-label={`Clics por día: ${dias.map((d) => `${diaCorto(d.dia)}: ${d.clics}`).join(", ")}`}
        onMouseLeave={() => setSobre(null)}
      >
        {dias.map((d) => (
          <div
            key={d.dia}
            className={`dcba-uso-chart__col ${sobre?.dia === d.dia ? "dcba-uso-chart__col--on" : ""}`}
            onMouseEnter={() => setSobre(d)}
            onFocus={() => setSobre(d)}
            tabIndex={0}
            title={`${d.dia}: ${d.clics} clics · ${d.vistas} pantallas · ${d.sesiones} sesiones`}
          >
            <div
              className="dcba-uso-chart__bar"
              style={{ height: d.clics > 0 ? `${Math.max(3, Math.round((d.clics / max) * 100))}%` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="dcba-uso-chart__axis">
        <span>{dias[0] ? diaCorto(dias[0].dia) : ""}</span>
        <span>{dias.length > 1 ? diaCorto(dias[dias.length - 1].dia) : ""}</span>
      </div>
    </div>
  );
}

export function ActividadPanel({ barbershopId }: { barbershopId: string }) {
  // El mes PEDIDO (null = el que diga el servidor: el mes en curso). El que se
  // muestra sale de la respuesta: así la primera carga no pide dos veces.
  const [mesPedido, setMesPedido] = useState<string | null>(null);
  const [data, setData] = useState<ActividadBarberia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    fetch(`/api/admin/barberias/${barbershopId}/actividad${mesPedido ? `?mes=${mesPedido}` : ""}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: ActividadBarberia) => {
        if (vivo) setData(j);
      })
      .catch(() => vivo && setError("No se pudo cargar la actividad."))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [barbershopId, mesPedido]);

  const conUso = useMemo(() => (data ? data.usuarios.filter((u) => u.sesiones + u.clics + u.vistas > 0).length : 0), [data]);

  return (
    <CardNew>
      <div className="dcba-uso-head">
        <div className="dcba-cardtitle" style={{ marginBottom: 0 }}>
          <Activity size={14} />
          Actividad del panel
        </div>
        <label className="dcba-uso-mes">
          <span className="dcba-label" style={{ marginBottom: 0 }}>
            Mes
          </span>
          <select
            className="input-new"
            value={data?.mes.clave ?? ""}
            disabled={!data || cargando}
            onChange={(e) => setMesPedido(e.target.value)}
            aria-label="Mes de la actividad"
          >
            {(data?.meses ?? []).map((m) => (
              <option key={m.clave} value={m.clave}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="dcba-note" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : !data ? (
        <div className="dcba-uso-esqueleto" aria-busy="true">
          Cargando la actividad…
        </div>
      ) : !data.disponible ? (
        <div className="dcba-warn" style={{ marginBottom: 0 }}>
          <Activity size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Aún no se registra el uso del panel: falta pegar{" "}
            <span className="mono">sql/barber_usage_events.sql</span>. En cuanto se pegue, se empieza a
            contar solo (no hay datos de antes).
          </span>
        </div>
      ) : (
        <div style={{ opacity: cargando ? 0.6 : 1, transition: "opacity .15s" }}>
          {data.sedes > 1 && (
            <p className="dcba-note" style={{ marginTop: 0 }}>
              {data.sedes - 1 === 1
                ? "Cuenta la matriz y su sucursal."
                : `Cuenta la matriz y sus ${formatInt(data.sedes - 1)} sucursales.`}
            </p>
          )}
          <div className="dcba-kpis" style={{ marginBottom: 16 }}>
            <KpiCard label="Días activos" value={formatInt(data.totales.diasActivos)} icon={CalendarCheck} />
            <KpiCard label="Sesiones" value={formatInt(data.totales.sesiones)} icon={LogIn} hint="Entradas al panel" />
            <KpiCard label="Pantallas vistas" value={formatInt(data.totales.vistas)} icon={Monitor} />
            <KpiCard label="Clics" value={formatInt(data.totales.clics)} icon={MousePointerClick} hero />
            <KpiCard label="Usuarios activos" value={formatInt(data.totales.usuarios)} icon={Users} />
          </div>

          <GraficaDias dias={data.dias} />

          <div className="dcba-label" style={{ marginTop: 18 }}>
            Por persona ({formatInt(conUso)} con uso este mes)
          </div>
          <div className="dcba-tablewrap">
            <table className="table-new">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Rol</th>
                  <th>Último acceso</th>
                  <th style={{ textAlign: "right" }}>Sesiones</th>
                  <th className="dcba-col-wide" style={{ textAlign: "right" }}>
                    Pantallas
                  </th>
                  <th style={{ textAlign: "right" }}>Clics</th>
                </tr>
              </thead>
              <tbody>
                {data.usuarios.map((u) => (
                  <tr key={u.userId}>
                    <td>
                      <span style={{ fontSize: 12.5, color: "var(--text-1)" }}>{u.nombre}</span>
                      {u.enLinea && (
                        <span
                          className="dcba-online"
                          style={{ marginLeft: 6, verticalAlign: "1px" }}
                          title="En el panel ahora"
                          role="img"
                          aria-label="En el panel ahora"
                        />
                      )}
                      {!u.activo && (
                        <span style={{ marginLeft: 6 }}>
                          <BadgeNew tone="neutral">Desactivado</BadgeNew>
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                        {u.rol ? (BARBER_ROLE_LABELS[u.rol as BarberRole] ?? u.rol) : "—"}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: "var(--text-2)" }} title={fullDate(u.ultimoAcceso)}>
                        {u.ultimoAcceso ? relativeDate(u.ultimoAcceso) : "Sin uso registrado"}
                      </span>
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>{formatInt(u.sesiones)}</td>
                    <td className="mono dcba-col-wide" style={{ textAlign: "right" }}>{formatInt(u.vistas)}</td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>{formatInt(u.clics)}</td>
                  </tr>
                ))}
                {data.usuarios.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                      Nadie con acceso al panel todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="dcba-grid2" style={{ marginTop: 18 }}>
            <div>
              <div className="dcba-label">Pantallas más usadas</div>
              <Ranking
                filas={data.pantallas.map((p) => ({ k: p.pantalla, nombre: p.nombre, n: p.vistas, sub: `${formatInt(p.usuarios)} ${p.usuarios === 1 ? "persona" : "personas"}` }))}
                vacio="Sin pantallas vistas este mes."
                unidad="vistas"
              />
            </div>
            <div>
              <div className="dcba-label">Botones más usados</div>
              <Ranking
                filas={data.acciones.map((a) => ({ k: a.accion, nombre: a.accion, n: a.clics }))}
                vacio="Sin clics este mes."
                unidad="clics"
              />
            </div>
          </div>
          <p className="dcba-note" style={{ marginTop: 14 }}>
            Se cuenta lo que hace cada persona de la barbería en su panel: entradas, pantallas y botones.
            No se guarda nada de lo que escriben ni datos de sus clientes, y no cuenta lo que haga
            DaleControl desde «Ver como barbería».
          </p>
        </div>
      )}
    </CardNew>
  );
}

function Ranking({
  filas,
  vacio,
  unidad,
}: {
  filas: Array<{ k: string; nombre: string; n: number; sub?: string }>;
  vacio: string;
  unidad: string;
}) {
  if (filas.length === 0) return <p className="dcba-note">{vacio}</p>;
  const max = Math.max(1, ...filas.map((f) => f.n));
  return (
    <ol className="dcba-uso-rank">
      {filas.map((f) => (
        <li key={f.k} title={f.k}>
          <div className="dcba-uso-rank__fila">
            <span className="dcba-ellipsis" style={{ fontSize: 12.5, color: "var(--text-1)" }}>
              {f.nombre}
            </span>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }}>
              {formatInt(f.n)} {unidad}
              {f.sub ? ` · ${f.sub}` : ""}
            </span>
          </div>
          <div className="dcba-meter" style={{ marginTop: 3 }}>
            <div className="dcba-meter__fill" style={{ width: `${Math.round((f.n / max) * 100)}%`, background: "var(--brand)" }} />
          </div>
        </li>
      ))}
    </ol>
  );
}
