"use client";

// ═══════════════════════════════════════════════════════════════════════
// LA PANTALLA DE CUMPLIMIENTO — el armazón de las cinco pestañas.
//
// i18n — CONVENCIÓN B: el servidor manda el sub-árbol YA RECORTADO
// (pld.json → el idioma que toque) y aquí se llama a makeRealtyT SIN
// segundo argumento. Cruzar esto con la convención A es el bug que pinta
// llaves crudas en pantalla; makeRealtyT lo grita en consola en desarrollo.
//
// 🔴 LA LEYENDA DE ALCANCE VA EN EL ENCABEZADO, no en un pie. Es lo primero
// que se lee: "tu expediente y tus alertas, ordenadas — DaleControl no es un
// despacho". Vive en una constante de contrato.ts y no en el diccionario, a
// propósito: no es una etiqueta de UI, es la frontera legal del producto.
//
// 🔴 SIN PARÁMETROS LA PANTALLA NO SE CAE. Si nadie ha capturado la UMA del
// año, se enseña qué falta y el módulo SIGUE SIRVIENDO: se integran
// expedientes, se suben papeles y se lee la bitácora — nada de eso depende
// de un número. Lo único que desaparece es la comparación contra el umbral,
// que es justo lo que no se puede inventar.
//
// Refrescar = router.refresh(). La pantalla la arma el servidor de una
// sola pieza (getPantallaCumplimiento): mantener aquí una copia paralela
// del estado sería tener dos verdades, y la del navegador envejecería.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  LEYENDA_ALCANCE,
  type PantallaCumplimiento,
} from "@/lib/realty/pld/contrato";
import { Tablero } from "./tablero";
import { PanelBitacora } from "./bitacora-panel";
import { PanelCalendario } from "./calendario-panel";
import { PanelExpedientes, type FiltroExpediente } from "./expedientes-panel";
import { PanelOperaciones, type FiltroOperacion } from "./operaciones-panel";
import { FaltantesPld, LeyendaLegal, Pestanas } from "./ui";

type TabId = "tablero" | "expedientes" | "operaciones" | "calendario" | "bitacora";

const TABS: TabId[] = ["tablero", "expedientes", "operaciones", "calendario", "bitacora"];

function esTab(v: string): v is TabId {
  return (TABS as string[]).includes(v);
}

export function CumplimientoScreen({
  dict,
  datos,
  locale,
}: {
  dict: Dictionary;
  datos: PantallaCumplimiento;
  locale: string;
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const t = useMemo(() => makeRealtyT(dict), [dict]);

  const [tab, setTab] = useState<TabId>("tablero");
  const [filtroExp, setFiltroExp] = useState<FiltroExpediente>("");
  const [filtroOp, setFiltroOp] = useState<FiltroOperacion>("");

  const refrescar = useCallback(() => {
    empezar(() => router.refresh());
  }, [router]);

  /**
   * Los contadores del tablero son botones: cada uno salta a su pestaña YA
   * FILTRADA. Un tablero que solo cuenta obliga a buscar a mano lo que
   * acaba de señalar.
   */
  const ir = useCallback((destino: string, filtro?: string) => {
    if (!esTab(destino)) return;
    if (destino === "expedientes") setFiltroExp((filtro ?? "") as FiltroExpediente);
    if (destino === "operaciones") setFiltroOp((filtro ?? "") as FiltroOperacion);
    setTab(destino);
  }, []);

  const b = datos.tablero;
  // Lo que urge, en el globo de cada pestaña. Solo lo que exige una acción:
  // un contador que siempre trae un número deja de leerse a la semana.
  const pendientes: Record<TabId, number> = {
    tablero: 0,
    expedientes: b.expedientesIncompletos + b.expedientesVencidos,
    operaciones: b.efectivoEnBandera + b.alertas24h,
    calendario: b.proximoCorte?.vencido ? 1 : 0,
    bitacora: 0,
  };

  return (
    <div className="realty-page" style={{ opacity: pendiente ? 0.75 : 1, transition: "opacity .12s" }}>
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            color: "var(--text-1)",
            letterSpacing: "-0.02em",
          }}
        >
          <ShieldCheck size={19} aria-hidden="true" />
          {t("title")}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-3)", lineHeight: 1.55 }}>
          {t("subtitle")}
        </p>
        <div style={{ marginTop: 8 }}>
          <LeyendaLegal texto={LEYENDA_ALCANCE} />
        </div>
      </header>

      {/* Lo que falta capturar en /admin. Va ARRIBA de todo: sin esto, la
          pantalla enseña expedientes pero no compara nada, y hay que
          decirlo antes de que alguien se confíe. */}
      {datos.faltantes.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <FaltantesPld
            faltantes={datos.faltantes}
            titulo={t("errores.sinParametros")}
            cuerpo={t("errores.sinParametrosCuerpo")}
          />
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <Pestanas
          activa={tab}
          onCambiar={(k) => {
            if (esTab(k)) setTab(k);
          }}
          items={TABS.map((k) => ({
            key: k,
            label: t(`tabs.${k}`),
            contador: pendientes[k],
          }))}
        />
      </div>

      {tab === "tablero" && <Tablero datos={datos} t={t} onIr={ir} />}

      {tab === "expedientes" && (
        <PanelExpedientes
          expedientes={datos.expedientes}
          contactos={datos.contactos}
          puedeGestionar={datos.puedeGestionar}
          timeZone={datos.timeZone}
          locale={locale}
          t={t}
          filtro={filtroExp}
          onFiltro={setFiltroExp}
          onRefrescar={refrescar}
        />
      )}

      {tab === "operaciones" && (
        <PanelOperaciones
          operaciones={datos.operaciones}
          umbrales={datos.umbrales}
          puedeGestionar={datos.puedeGestionar}
          timeZone={datos.timeZone}
          locale={locale}
          t={t}
          filtro={filtroOp}
          onFiltro={setFiltroOp}
          onRefrescar={refrescar}
        />
      )}

      {tab === "calendario" && (
        <PanelCalendario
          periodos={datos.periodos}
          hayUmbrales={datos.umbrales !== null}
          puedeGestionar={datos.puedeGestionar}
          timeZone={datos.timeZone}
          locale={locale}
          t={t}
          onRefrescar={refrescar}
        />
      )}

      {/* La bitácora se monta solo al entrar: sus renglones se piden bajo
          demanda y no viajan con la pantalla. */}
      {tab === "bitacora" && (
        <PanelBitacora timeZone={datos.timeZone} locale={locale} t={t} />
      )}
    </div>
  );
}
