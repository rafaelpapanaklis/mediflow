"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/contratos — el listado y el alta.
//
// El módulo REUSA el juego de piezas de Rentas (`./ui` y `rentals.css`) en
// vez de traer uno propio: son el mismo panel y un segundo juego de botones
// con otro verde es justo cómo un producto deja de verse como un producto.
// Lo único que aporta este módulo está en contracts.css (`.ctr-*`).
//
// i18n por CONVENCIÓN B: el servidor ya bajó el sub-árbol y aquí el prefijo
// va VACÍO. Anteponerlo otra vez pintaría las llaves crudas.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { Archive, ArrowRight, CalendarClock, FileSignature, Plus, Settings2 } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { Card, EmptyState, Kpi, Pill, Tabs } from "../rentals/ui";
import "../rentals/rentals.css";
import "./contracts.css";
import {
  CONTRACT_STATUS_TONE,
  REALTY_CONTRACT_KINDS,
  type ContractRowDTO,
  type RealtyContractKind,
  type RealtyContractStatus,
} from "./shared";
import { NewContractForm, type ContractSources } from "./new-contract-form";

type StatusFilter = RealtyContractStatus | "TODOS";

/**
 * Las seis pestañas, en el orden en que un contrato las recorre.
 *
 * ARCHIVADO y ANULADO tienen la suya: sin ellas, un contrato anulado solo
 * aparecería dentro de "todos" y no habría forma de irse a ver únicamente
 * los que se dejaron sin efecto — que es justo lo que alguien busca cuando
 * pregunta "¿qué pasó con aquel contrato?".
 */
const TABS: StatusFilter[] = [
  "TODOS",
  "BORRADOR",
  "ENVIADO",
  "PARCIAL",
  "FIRMADO",
  "ARCHIVADO",
  "ANULADO",
];

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

export function ContractsClient({
  dict,
  contracts,
  sources,
  canEdit,
}: {
  dict: Dictionary;
  contracts: ContractRowDTO[];
  sources: ContractSources;
  canEdit: boolean;
}) {
  const t = makeRealtyT(dict);
  const router = useRouter();

  const [status, setStatus] = useState<StatusFilter>("TODOS");
  const [kind, setKind] = useState<RealtyContractKind | "TODOS">("TODOS");
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  // Los KPI se calculan sobre TODO, no sobre lo filtrado: cuántos contratos
  // esperan firma no puede cambiar porque alguien tocó una pestaña.
  const kpi = useMemo(() => {
    let borradores = 0;
    let esperando = 0;
    let firmados = 0;
    let porVencer = 0;
    for (const c of contracts) {
      if (c.status === "BORRADOR") borradores += 1;
      if (c.status === "ENVIADO" || c.status === "PARCIAL") esperando += 1;
      if (c.status === "FIRMADO") firmados += 1;
      if (
        c.expiryWindow !== null &&
        c.daysToEnd !== null &&
        c.daysToEnd >= 0 &&
        c.status !== "ANULADO" &&
        c.status !== "ARCHIVADO"
      ) {
        porVencer += 1;
      }
    }
    return { borradores, esperando, firmados, porVencer };
  }, [contracts]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { TODOS: 0 };
    for (const c of contracts) {
      // ARCHIVADO no suma en TODOS: la pestaña "todos" es el trabajo vivo.
      if (c.status !== "ARCHIVADO") map.TODOS += 1;
      map[c.status] = (map[c.status] ?? 0) + 1;
    }
    return map;
  }, [contracts]);

  const visibles = useMemo(() => {
    return contracts.filter((c) => {
      if (status === "TODOS" ? c.status === "ARCHIVADO" : c.status !== status) return false;
      if (kind !== "TODOS" && c.kind !== kind) return false;
      return true;
    });
  }, [contracts, status, kind]);

  async function crear(payload: Record<string, unknown>): Promise<void> {
    const res = await fetch("/api/realty/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(typeof data.error === "string" ? data.error : t("comun.error"));
      return;
    }
    toast.success(t("nuevo.creado"));
    setNuevoAbierto(false);
    router.push(`/inmobiliaria/contratos/${data.id}`);
    router.refresh();
  }

  return (
    <div className="ctr">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{t("title")}</h1>
            <p className="rnt-head__sub">{t("subtitle")}</p>
          </div>
          <div className="rnt-head__actions">
            <Link className="rnt-btn" href="/inmobiliaria/contratos/vencimientos">
              <CalendarClock size={14} />
              {t("nav.vencimientos")}
            </Link>
            <Link className="rnt-btn" href="/inmobiliaria/contratos/boveda">
              <Archive size={14} />
              {t("nav.boveda")}
            </Link>
            <Link className="rnt-btn" href="/inmobiliaria/contratos/plantillas">
              <Settings2 size={14} />
              {t("nav.plantillas")}
            </Link>
            {canEdit ? (
              <button
                type="button"
                className="rnt-btn rnt-btn--primary"
                onClick={() => setNuevoAbierto(true)}
              >
                <Plus size={14} />
                {t("acciones.nuevo")}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="rnt-kpis">
        <Kpi label={t("kpis.borradores")} value={String(kpi.borradores)} />
        <Kpi
          label={t("kpis.esperando")}
          value={String(kpi.esperando)}
          hint={kpi.esperando > 0 ? t("kpis.esperandoHint") : undefined}
          tone={kpi.esperando > 0 ? "danger" : undefined}
        />
        <Kpi label={t("kpis.firmados")} value={String(kpi.firmados)} tone="good" />
        <Kpi
          label={t("kpis.porVencer")}
          value={String(kpi.porVencer)}
          hint={t("kpis.porVencerHint")}
        />
      </div>

      <div className="rnt-toolbar">
        <div className="rnt-toolbar__grow">
          <Tabs
            label={t("filtros.estado")}
            value={status}
            onChange={setStatus}
            tabs={TABS.map((s) => ({
              key: s,
              label: s === "TODOS" ? t("filtros.todos") : t(`status.${s}`),
              count: counts[s] ?? 0,
            }))}
          />
        </div>
        <select
          className="rnt-select"
          value={kind}
          aria-label={t("filtros.tipo")}
          onChange={(e) => setKind(e.target.value as RealtyContractKind | "TODOS")}
        >
          <option value="TODOS">{t("filtros.tipoTodos")}</option>
          {REALTY_CONTRACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
      </div>

      {visibles.length === 0 ? (
        <EmptyState
          title={t("vacio.title")}
          body={t("vacio.body")}
          action={
            canEdit ? (
              <button
                type="button"
                className="rnt-btn rnt-btn--primary"
                onClick={() => setNuevoAbierto(true)}
              >
                <FileSignature size={14} />
                {t("acciones.nuevo")}
              </button>
            ) : undefined
          }
        />
      ) : (
        <Card flush>
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <thead>
                <tr>
                  <th>{t("tabla.folio")}</th>
                  <th>{t("tabla.contrato")}</th>
                  <th>{t("tabla.estado")}</th>
                  <th>{t("tabla.firmas")}</th>
                  <th>{t("tabla.vigencia")}</th>
                  <th aria-label={t("tabla.acciones")} />
                </tr>
              </thead>
              <tbody>
                {visibles.map((c) => (
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
                      {c.required === 0 ? "—" : `${c.signed} / ${c.required}`}
                    </td>
                    <td>
                      {c.effectiveTo ? (
                        <>
                          <div>{fechaCorta(c.effectiveTo)}</div>
                          {c.expiryWindow !== null && c.daysToEnd !== null ? (
                            <div className="rnt-card__sub">
                              {c.daysToEnd < 0
                                ? t("tabla.vencido")
                                : t("tabla.enDias", { dias: String(c.daysToEnd) })}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="rnt-btn rnt-btn--sm" href={`/inmobiliaria/contratos/${c.id}`}>
                        {t("tabla.abrir")}
                        <ArrowRight size={13} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <NewContractForm
        dict={dict}
        open={nuevoAbierto}
        sources={sources}
        onClose={() => setNuevoAbierto(false)}
        onCreate={crear}
      />
    </div>
  );
}
