"use client";

/**
 * El bloque «Ortodoncia» de Finanzas (ws1-t5, ronda 6 — fila 90 de la revisión
 * de lógica de uso): cuánto entra por ortodoncia, cuántos casos lleva cada
 * doctor, cuántos se abandonan y qué tan vieja es la deuda.
 *
 * Se pinta SOLO si la clínica tiene el módulo (o casos de cuando lo tuvo): con
 * `activo: false` no deja ni un píxel. Es una petición aparte de las dos de
 * Finanzas (/api/finanzas/ortodoncia) con el MISMO periodo, así que si falla o
 * tarda, el resto de la pantalla ni se entera.
 *
 * No calcula nada: las cifras llegan hechas del servidor, con el mismo motor
 * que Cobranza y el Tablero del módulo.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Smile } from "lucide-react";
import { fmtMXN } from "@/lib/format";
import type { BloqueOrtodonciaFinanzas } from "@/lib/orthodontics/finanzas-ortodoncia";
import s from "./bloque-ortodoncia.module.css";

const fmtMXNSigned = (n: number) => (n < 0 ? "−" : "") + fmtMXN(Math.abs(n ?? 0));
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

type Estado =
  | { fase: "cargando" }
  | { fase: "error" }
  | { fase: "listo"; datos: BloqueOrtodonciaFinanzas };

export function BloqueOrtodoncia({ consulta, recarga = 0 }: {
  /** El mismo `period=…` que usa el resto de Finanzas. */
  consulta: string;
  /** Cambia cuando Finanzas se recarga (Reintentar, gasto guardado). */
  recarga?: number;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let vivo = true;
    setEstado((e) => (e.fase === "listo" ? e : { fase: "cargando" }));
    fetch(`/api/finanzas/ortodoncia?${consulta}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error("ortodoncia");
        return r.json();
      })
      .then((datos: BloqueOrtodonciaFinanzas) => {
        if (vivo) setEstado({ fase: "listo", datos });
      })
      .catch((e: { name?: string }) => {
        if (!vivo || e?.name === "AbortError") return;
        setEstado({ fase: "error" });
      });
    return () => { vivo = false; ctrl.abort(); };
  }, [consulta, recarga, intento]);

  // Mientras no se sepa si la clínica tiene ortodoncia, no se pinta nada: a
  // una clínica sin el módulo no se le enseña ni el hueco.
  if (estado.fase === "cargando") return null;
  if (estado.fase === "listo" && !estado.datos.activo) return null;

  return (
    <section className={s.bloque} aria-label="Ortodoncia">
      <header className={s.cabeza}>
        <span className={s.icono}>
          <Smile size={15} strokeWidth={1.75} aria-hidden />
        </span>
        <div className={s.textos}>
          <h2 className={s.titulo}>Ortodoncia</h2>
          <p className={s.sub}>Lo que entró en el periodo y lo que falta por cobrar de los casos de ortodoncia.</p>
        </div>
        {estado.fase === "listo" && estado.datos.moduloVigente && (
          <Link href="/dashboard/orthodontics/cobranza" className={s.enlace}>
            Ver Cobranza <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </Link>
        )}
      </header>

      {estado.fase === "error" ? (
        <p className={s.error}>
          No se pudo cargar el resumen de ortodoncia.
          <button type="button" className={s.reintentar} onClick={() => setIntento((n) => n + 1)}>
            Reintentar
          </button>
        </p>
      ) : (
        <Cuerpo datos={estado.datos} />
      )}
    </section>
  );
}

function Cuerpo({ datos }: { datos: BloqueOrtodonciaFinanzas }) {
  const { periodo, casos, cartera, porDoctor } = datos;
  const mayorTramo = cartera.tramos.reduce((m, t) => Math.max(m, t.importe), 0);
  const cerrados = casos.terminados + casos.abandonados;

  return (
    <>
      {!datos.moduloVigente && (
        <p className={s.aviso}>
          El módulo de Ortodoncia no está activo en esta sede. Estas cifras son de los casos que ya tenía: se pueden
          consultar, pero no abrir casos nuevos ni cobrar desde el módulo.
        </p>
      )}
      <div className={s.cuerpo}>
        <div className={s.cifras}>
          <div className={s.cifra}>
            <div className={s.cifraEtiqueta}>Cobrado en el periodo</div>
            <div className={s.cifraValor}>{fmtMXNSigned(periodo.neto)}</div>
            <p className={s.cifraPista}>
              {periodo.reembolsado > 0
                ? `${fmtMXN(periodo.cobrado)} cobrados, menos ${fmtMXN(periodo.reembolsado)} de reembolsos`
                : "Mensualidades, enganches, controles y extras"}
            </p>
          </div>
          <div className={s.cifra}>
            <div className={s.cifraEtiqueta}>Casos abiertos</div>
            <div className={s.cifraValor}>{casos.activos.toLocaleString("es-MX")}</div>
            <p className={s.cifraPista}>
              {casos.enPausa > 0 ? `${plural(casos.enPausa, "en pausa", "en pausa")} · ` : ""}
              {plural(casos.terminados, "terminado", "terminados")}
            </p>
          </div>
          <div className={s.cifra}>
            <div className={s.cifraEtiqueta}>Abandono</div>
            <div className={s.cifraValor}>{casos.tasaDeAbandono === null ? "—" : `${casos.tasaDeAbandono} %`}</div>
            <p className={s.cifraPista}>
              {casos.tasaDeAbandono === null
                ? "Aún no ha cerrado ningún caso"
                : `${plural(casos.abandonados, "abandonado", "abandonados")} de ${plural(cerrados, "caso cerrado", "casos cerrados")}`}
            </p>
          </div>
          <div className={s.cifra}>
            <div className={s.cifraEtiqueta}>Vencido</div>
            <div className={`${s.cifraValor} ${cartera.vencido > 0 ? s.cifraValorPeligro : ""}`}>{fmtMXN(cartera.vencido)}</div>
            <p className={s.cifraPista}>
              {cartera.vencido > 0 ? `${plural(cartera.casosConAtraso, "caso con atraso", "casos con atraso")} · ` : ""}
              de {fmtMXN(cartera.porCobrar)} por cobrar
            </p>
          </div>
        </div>

        <div className={s.par}>
          <div className={s.lista}>
            <h3 className={s.listaTitulo}>Por doctor</h3>
            {porDoctor.length === 0 ? (
              <p className={s.vacio}>Sin casos abiertos ni cobros de ortodoncia en este periodo.</p>
            ) : (
              <>
                <div className={s.listaCabecera}>
                  <span>Doctor</span>
                  <span className={s.num}>Casos</span>
                  <span className={s.num}>Cobrado</span>
                </div>
                {porDoctor.map((d) => (
                  <div key={d.doctorId ?? "sin-doctor"} className={s.fila}>
                    <span className={s.nombre} title={d.doctor}>{d.doctor}</span>
                    <span className={`${s.num} ${d.casosActivos === 0 ? s.numApagado : ""}`}>{d.casosActivos}</span>
                    <span className={`${s.num} ${d.ingresos === 0 ? s.numApagado : ""}`}>{fmtMXNSigned(d.ingresos)}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className={s.lista}>
            <h3 className={s.listaTitulo}>Antigüedad de lo vencido</h3>
            {cartera.vencido <= 0 ? (
              <p className={s.vacio}>Ningún caso tiene pagos vencidos.</p>
            ) : (
              cartera.tramos.map((t) => (
                <div key={t.clave} className={s.tramo}>
                  <div className={s.tramoArriba}>
                    <span>
                      {t.etiqueta}
                      {t.casos > 0 && <span className={s.tramoCasos}>{plural(t.casos, "caso", "casos")}</span>}
                    </span>
                    <span className={`${s.num} ${t.importe === 0 ? s.numApagado : ""}`}>{fmtMXN(t.importe)}</span>
                  </div>
                  <div className={s.barra} aria-hidden>
                    <div
                      className={s.barraRelleno}
                      style={{ width: `${mayorTramo > 0 && t.importe > 0 ? Math.max(2, Math.round((t.importe / mayorTramo) * 100)) : 0}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
