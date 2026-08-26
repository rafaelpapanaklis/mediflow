"use client";

// ═══════════════════════════════════════════════════════════════════════
// VENCIMIENTOS — /inmobiliaria/contratos/vencimientos
//
// Tres listas y ninguna inventa un dato:
//   1. Contratos que generó ESTE módulo y están por vencer.
//   2. Contratos de RENTA de T4 por vencer que NUNCA tuvieron contrato
//      firmable generado.
//   3. EXCLUSIVAS de T1 por vencer en la misma situación.
//
// 🔴 LAS FECHAS SON LAS DE T4 Y T1, NO UNA COPIA. RealtyLease.endsAt y
// RealtyExclusive.endsAt se consultan tal cual desde el servidor
// (expiringBoard). Aquí no se recalcula ni una vigencia: si mañana esas
// olas cambian cómo guardan una fecha, esta pantalla se entera sola.
//
// Lo único PROPIO es saber qué contratos generó este módulo — que es justo
// lo que las pantallas de Rentas y de Exclusivas no pueden saber, y por lo
// que las listas 2 y 3 son útiles en vez de redundantes.
//
// La ventana (30/60/90) se filtra EN EL NAVEGADOR sobre los 90 días que ya
// bajó el servidor: son decenas de filas y cambiar de pestaña no merece un
// viaje a la base.
//
// i18n CONVENCIÓN B: el servidor ya recortó el sub-árbol; prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { Card, EmptyState, Pill, Tabs } from "../rentals/ui";
import "../rentals/rentals.css";
import "./contracts.css";
import { CONTRACT_STATUS_TONE, type ContractRowDTO } from "./shared";

export interface FuentePorVencer {
  id: string;
  title: string;
  endsAt: string;
  daysToEnd: number;
}

type Ventana = "30" | "60" | "90";

export function ExpiringClient({
  dict,
  contracts,
  leases,
  exclusives,
  timeZone,
}: {
  dict: Dictionary;
  contracts: ContractRowDTO[];
  leases: FuentePorVencer[];
  exclusives: FuentePorVencer[];
  timeZone: string;
}) {
  const t = makeRealtyT(dict);
  const [ventana, setVentana] = useState<Ventana>("30");
  const tope = Number(ventana);

  function fechaCorta(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t("comun.sinDato");
    try {
      return new Intl.DateTimeFormat("es-MX", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone,
      }).format(d);
    } catch {
      return iso.slice(0, 10);
    }
  }

  function cuando(dias: number): string {
    if (dias <= 0) return t("vencimientos.hoy");
    return t("vencimientos.enDias", { dias: String(dias) });
  }

  const cContratos = useMemo(
    () => contracts.filter((c) => c.daysToEnd !== null && c.daysToEnd <= tope),
    [contracts, tope],
  );
  const cLeases = useMemo(() => leases.filter((l) => l.daysToEnd <= tope), [leases, tope]);
  const cExclusivas = useMemo(
    () => exclusives.filter((e) => e.daysToEnd <= tope),
    [exclusives, tope],
  );
  const vacio = cContratos.length === 0 && cLeases.length === 0 && cExclusivas.length === 0;

  // Los contadores de las pestañas cuentan las TRES listas: la pregunta que
  // se contesta al mirarlas es "cuánto se me viene encima", no "cuántos
  // contratos hay".
  function total(dias: number): number {
    return (
      contracts.filter((c) => c.daysToEnd !== null && c.daysToEnd <= dias).length +
      leases.filter((l) => l.daysToEnd <= dias).length +
      exclusives.filter((e) => e.daysToEnd <= dias).length
    );
  }

  return (
    <div className="ctr">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{t("vencimientos.title")}</h1>
            <p className="rnt-head__sub">{t("vencimientos.subtitle")}</p>
          </div>
          <div className="rnt-head__actions">
            <Link className="rnt-btn" href="/inmobiliaria/contratos">
              <ArrowLeft size={14} />
              {t("detalle.volver")}
            </Link>
          </div>
        </div>
      </header>

      <div className="rnt-toolbar">
        <div className="rnt-toolbar__grow">
          <Tabs
            label={t("vencimientos.ventana")}
            value={ventana}
            onChange={setVentana}
            tabs={[
              { key: "30" as Ventana, label: t("vencimientos.v30"), count: total(30) },
              { key: "60" as Ventana, label: t("vencimientos.v60"), count: total(60) },
              { key: "90" as Ventana, label: t("vencimientos.v90"), count: total(90) },
            ]}
          />
        </div>
      </div>

      {vacio ? (
        <EmptyState title={t("vencimientos.vacio")} body={t("vencimientos.subtitle")} />
      ) : null}

      {cContratos.length > 0 ? (
        <Card title={t("vencimientos.contratos")} sub={t("vencimientos.contratosSub")} flush>
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <tbody>
                {cContratos.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.folio}</strong>
                      <div className="rnt-card__sub">{t(`kinds.${c.kind}`)}</div>
                    </td>
                    <td>
                      <div>{c.title}</div>
                      {c.propertyTitle ? (
                        <div className="rnt-card__sub">{c.propertyTitle}</div>
                      ) : null}
                    </td>
                    <td>
                      <Pill tone={CONTRACT_STATUS_TONE[c.status]} dot>
                        {t(`status.${c.status}`)}
                      </Pill>
                    </td>
                    <td>
                      <div>{t("vencimientos.vence")} {fechaCorta(c.effectiveTo ?? "")}</div>
                      <div className="rnt-card__sub">{cuando(c.daysToEnd ?? 0)}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="rnt-btn rnt-btn--sm" href={`/inmobiliaria/contratos/${c.id}`}>
                        {t("vencimientos.abrir")}
                        <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {cLeases.length > 0 ? (
        <Card title={t("vencimientos.rentas")} sub={t("vencimientos.rentasSub")} flush>
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <tbody>
                {cLeases.map((l) => (
                  <tr key={l.id}>
                    <td>{l.title}</td>
                    <td>
                      <div>{t("vencimientos.vence")} {fechaCorta(l.endsAt)}</div>
                      <div className="rnt-card__sub">{cuando(l.daysToEnd)}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {/* A Rentas y no al alta de contratos: el asesor
                          decide ahí si renueva o si genera el contrato, y
                          esa pantalla ya tiene todo el expediente. */}
                      <Link className="rnt-btn rnt-btn--sm" href={`/inmobiliaria/rentas/${l.id}`}>
                        {t("vencimientos.abrir")}
                        <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {cExclusivas.length > 0 ? (
        <Card title={t("vencimientos.exclusivas")} sub={t("vencimientos.exclusivasSub")} flush>
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <tbody>
                {cExclusivas.map((e) => (
                  <tr key={e.id}>
                    <td>{e.title}</td>
                    <td>
                      <div>{t("vencimientos.vence")} {fechaCorta(e.endsAt)}</div>
                      <div className="rnt-card__sub">{cuando(e.daysToEnd)}</div>
                    </td>
                    <td style={{ textAlign: "right" }} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
