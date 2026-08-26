"use client";

// ═══════════════════════════════════════════════════════════════════════
// BOLSA INMOBILIARIA — la pantalla que cose las tres pestañas.
//
// Es el ÚNICO componente que sabe que la bolsa tiene pestañas. Cada una es
// independiente y no se conocen entre sí: se hablan a través de este
// archivo (`onIrACompartir` cambia de pestaña, `onCambio` recarga el
// tablero). Así, mover una pestaña a otra pantalla mañana no obliga a
// tocar las otras dos.
//
// ── 🔴 EL COPY HONESTO NO ES UN DETALLE DE ESTA PANTALLA ───────────────
// La bolsa vale poco con 5 clientes y muchísimo con 500. Los primeros
// meses va a estar VACÍA, y quien la abra el primer día tiene que entender
// por qué sin sentirse estafado. Por eso:
//
//   · "Cómo funciona" se abre SOLO cuando la cuenta no ha compartido nada
//     ni tiene acuerdos: es el día uno y hay que explicar el trato, no
//     estorbar al que ya sabe.
//   · Ninguna cadena de esta pantalla dice cuántos inmuebles hay en la
//     bolsa, ni cuántas inmobiliarias, ni "cientos de". El vacío dice
//     "aquí aparecerá lo que otros compartan" y punto.
//
// ── LA TARJETA DE PRIVACIDAD SÍ ES CONTROL DE ACCESO (del otro tipo) ───
// Nadie comparte inventario si no sabe qué está soltando. La lista exacta
// de campos que cruzan sale de REALTY_MLS_PUBLIC_FIELDS —la MISMA
// constante que el motor usa para recortar, no una copia— así que la
// pantalla no puede prometer una reja distinta de la que existe.
//
// ── i18n: CONVENCIÓN B ─────────────────────────────────────────────────
// El servidor baja el sub-árbol YA recortado (mls.json → es/en) y aquí se
// llama a `makeRealtyT` SIN prefijo. Cruzarlo con la convención A —dict
// completo + prefijo— es el bug que le costó dos pantallas a barber.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, Handshake, Search, ShieldCheck } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  REALTY_MLS_NEVER_EXPOSED,
  REALTY_MLS_PUBLIC_FIELDS,
  type RealtyMlsDashboard,
} from "@/components/realty/mls/mls-contract";
import { BuscarTab } from "@/components/realty/mls/buscar-tab";
import { CompartirTab } from "@/components/realty/mls/compartir-tab";
import { ColaboracionesTab } from "@/components/realty/mls/colaboraciones-tab";
import { Aviso, Boton, Modal, Tarjeta } from "@/components/realty/mls/mls-ui";

type Pestana = "buscar" | "compartir" | "colaboraciones";

const PESTANAS: Array<{ key: Pestana; icono: typeof Search }> = [
  { key: "buscar", icono: Search },
  { key: "compartir", icono: Building2 },
  { key: "colaboraciones", icono: Handshake },
];

/**
 * Los campos de la lista blanca que además dependen de `showExactAddress`.
 * Se marcan aparte en la tabla de privacidad porque prometerlos sin la
 * condición sería mentir: un dueño que no marcó pública su dirección no la
 * comparte por más que deje el campo encendido.
 */
const CONDICIONALES = new Set<string>(["direccion", "lat", "lng"]);

export function BolsaScreen({
  dict,
  timezone,
  puedeEditar,
  puedeAdoptar,
}: {
  dict: Dictionary;
  timezone: string;
  /** properties.edit — sin él se ve la bolsa pero no se comparte nada. */
  puedeEditar: boolean;
  /** web.edit — sin él no se puede poner inventario ajeno en la mini-web. */
  puedeAdoptar: boolean;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [pestana, setPestana] = useState<Pestana>("buscar");
  const [panel, setPanel] = useState<RealtyMlsDashboard | null>(null);
  const [cargandoPanel, setCargandoPanel] = useState(true);
  const [verCampos, setVerCampos] = useState(false);
  const [comoAbierto, setComoAbierto] = useState(false);
  // El usuario manda: si cierra "Cómo funciona", no se lo volvemos a abrir
  // aunque el tablero llegue después y diga que es su primer día.
  const [comoTocado, setComoTocado] = useState(false);

  // El tablero lo carga la pantalla y no la pestaña de colaboraciones: sus
  // números (propuestas por responder) se pintan en la pestaña ANTES de que
  // nadie la abra. Si lo cargara la pestaña, el aviso solo aparecería
  // después de entrar, que es justo cuando ya no sirve de aviso.
  const cargarPanel = useCallback(async () => {
    setCargandoPanel(true);
    try {
      const res = await fetch("/api/realty/mls/panel", { cache: "no-store" });
      if (!res.ok) {
        setPanel(null);
        return;
      }
      setPanel((await res.json()) as RealtyMlsDashboard);
    } catch {
      // Sin tablero la bolsa se sigue usando: buscar y compartir no lo
      // necesitan. La pestaña de colaboraciones pinta su propio error.
      setPanel(null);
    } finally {
      setCargandoPanel(false);
    }
  }, []);

  useEffect(() => {
    void cargarPanel();
  }, [cargarPanel]);

  // Día uno: ni comparte, ni le han propuesto nada, ni pinta inventario
  // ajeno. Es la cuenta que necesita que le expliquen el trato.
  const primerDia =
    panel !== null &&
    panel.compartidos.length === 0 &&
    panel.acuerdos.length === 0 &&
    panel.adopciones.length === 0;

  useEffect(() => {
    if (primerDia && !comoTocado) setComoAbierto(true);
  }, [primerDia, comoTocado]);

  // Lo que de verdad interrumpe: propuestas de OTROS esperando mi respuesta.
  // Las que yo propuse no cuentan — ahí el que espera soy yo.
  const porResponder = (panel?.acuerdos ?? []).filter(
    (a) => a.status === "PROPUESTO" && a.miPapel === "CAPTO",
  ).length;

  return (
    <div className="realty-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--text-1)",
          }}
        >
          {t("title")}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text-3)",
            lineHeight: 1.65,
            maxWidth: 680,
          }}
        >
          {t("subtitle")}
        </p>
      </header>

      {/* ── Cómo funciona ── */}
      <Tarjeta padded={false}>
        <button
          type="button"
          onClick={() => {
            setComoTocado(true);
            setComoAbierto((v) => !v);
          }}
          aria-expanded={comoAbierto}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            width: "100%",
            padding: "13px 18px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--text-1)",
            font: "inherit",
            textAlign: "left",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700 }}>
            <Handshake size={15} style={{ color: "var(--brand)" }} />
            {t("comoFunciona.title")}
          </span>
          <ChevronDown
            size={15}
            style={{
              color: "var(--text-3)",
              transform: comoAbierto ? "rotate(180deg)" : "none",
              transition: "transform 140ms ease",
              flexShrink: 0,
            }}
          />
        </button>

        {/* Colapsada = DESMONTADA. Dejarla en el DOM con display:none deja
            texto que el buscador del navegador encuentra y el lector de
            pantalla anuncia dentro de una sección "cerrada". */}
        {comoAbierto ? (
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
              padding: "16px 18px 18px",
              borderTop: "1px solid var(--border-soft)",
            }}
          >
            {(["paso1", "paso2", "paso3"] as const).map((paso) => (
              <div key={paso} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "var(--text-1)" }}>
                  {t(`comoFunciona.${paso}Title`)}
                </h3>
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", lineHeight: 1.65 }}>
                  {t(`comoFunciona.${paso}Body`)}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </Tarjeta>

      {/* ── Qué ve el otro asesor. Va ARRIBA de las pestañas a propósito:
             nadie comparte inventario si no sabe qué está soltando. ── */}
      <Aviso tono="neutro" icono={<ShieldCheck size={15} />}>
        <strong style={{ display: "block", fontSize: 12.5, marginBottom: 3, color: "var(--text-1)" }}>
          {t("privacidad.title")}
        </strong>
        <span style={{ color: "var(--text-3)" }}>{t("privacidad.body")}</span>
        <button
          type="button"
          onClick={() => setVerCampos(true)}
          style={{
            display: "block",
            marginTop: 6,
            padding: 0,
            background: "none",
            border: "none",
            color: "var(--brand)",
            font: "inherit",
            fontWeight: 600,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {t("privacidad.verCampos")}
        </button>
      </Aviso>

      {/* ── Pestañas ── */}
      <div
        role="tablist"
        aria-label={t("title")}
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          borderRadius: 12,
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          overflowX: "auto",
        }}
      >
        {PESTANAS.map(({ key, icono: Icono }) => {
          const activa = pestana === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activa}
              onClick={() => setPestana(key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "8px 13px",
                borderRadius: 9,
                border: "1px solid",
                borderColor: activa ? "var(--border-brand)" : "transparent",
                background: activa ? "var(--bg-elev)" : "transparent",
                color: activa ? "var(--text-1)" : "var(--text-3)",
                fontSize: 12.5,
                fontWeight: activa ? 700 : 600,
                fontFamily: "inherit",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Icono size={14} style={activa ? { color: "var(--brand)" } : undefined} />
              {t(`tabs.${key}`)}
              {key === "colaboraciones" && porResponder > 0 ? (
                <span
                  aria-label={t("colaboraciones.teToca")}
                  title={t("colaboraciones.teToca")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minWidth: 17,
                    height: 17,
                    padding: "0 5px",
                    borderRadius: 999,
                    background: "var(--brand)",
                    color: "#fff",
                    fontSize: 10.5,
                    fontWeight: 800,
                  }}
                >
                  {porResponder}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Las tres pestañas se DESMONTAN al cambiar. La de buscar guarda
          filtros y página en su propio estado; conservarlos escondidos
          significaría que volver a ella te devuelve a una búsqueda vieja
          contra una bolsa que ya cambió. */}
      {pestana === "buscar" ? (
        <BuscarTab
          dict={dict}
          timezone={timezone}
          puedeAdoptar={puedeAdoptar}
          onIrACompartir={() => setPestana("compartir")}
        />
      ) : null}

      {pestana === "compartir" ? (
        <CompartirTab
          dict={dict}
          timezone={timezone}
          puedeEditar={puedeEditar}
          onCambio={() => void cargarPanel()}
        />
      ) : null}

      {pestana === "colaboraciones" ? (
        <ColaboracionesTab
          dict={dict}
          timezone={timezone}
          panel={panel}
          cargando={cargandoPanel}
          onRecargar={() => void cargarPanel()}
        />
      ) : null}

      <CamposModal open={verCampos} onClose={() => setVerCampos(false)} dict={dict} />
    </div>
  );
}

/**
 * La lista EXACTA de lo que cruza entre cuentas, y la de lo que no cruza
 * nunca.
 *
 * 🔴 Las dos salen de las constantes del contrato, no de un texto escrito a
 * mano: si mañana alguien añade un campo a la lista blanca, esta pantalla
 * lo enseña sin que nadie se acuerde de venir. Un texto copiado sería una
 * promesa que se puede quedar vieja en silencio, y en este módulo eso se
 * llama otra cosa.
 */
function CamposModal({
  open,
  onClose,
  dict,
}: {
  open: boolean;
  onClose: () => void;
  dict: Dictionary;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("privacidad.title")}
      ancho={560}
      pie={<Boton onClick={onClose}>{t("acciones.cerrar")}</Boton>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.65 }}>
          {t("privacidad.body")}
        </p>

        <ul
          style={{
            display: "grid",
            gap: 6,
            gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))",
            listStyle: "none",
            margin: 0,
            padding: 0,
          }}
        >
          {REALTY_MLS_PUBLIC_FIELDS.map((campo) => (
            <li
              key={campo}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 6,
                fontSize: 12,
                color: "var(--text-2)",
                minWidth: 0,
              }}
            >
              <span aria-hidden style={{ color: "var(--brand)", flexShrink: 0 }}>
                ·
              </span>
              <span style={{ minWidth: 0 }}>
                {t(`compartir.camposLabels.${campo}`)}
                {CONDICIONALES.has(campo) ? (
                  <span style={{ color: "var(--text-4)" }}> *</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <Aviso tono="aviso">{t("compartir.direccionAviso")}</Aviso>

        <div>
          <strong
            style={{ display: "block", fontSize: 12.5, marginBottom: 6, color: "var(--text-1)" }}
          >
            {t("privacidad.nuncaTitle")}
          </strong>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-3)", lineHeight: 1.65 }}>
            {t("privacidad.nuncaBody")}
          </p>
          {/* Las llaves crudas del contrato, sin traducir y a propósito: son
              nombres de columna, y ver el nombre técnico es justo lo que
              convence a quien duda de si sus notas internas salen. */}
          <code
            style={{
              display: "block",
              padding: "9px 11px",
              borderRadius: 9,
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              color: "var(--text-3)",
              fontSize: 11,
              lineHeight: 1.7,
              wordBreak: "break-word",
            }}
          >
            {REALTY_MLS_NEVER_EXPOSED.join(" · ")}
          </code>
        </div>
      </div>
    </Modal>
  );
}
