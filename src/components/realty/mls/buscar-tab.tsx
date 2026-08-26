"use client";

// ═══════════════════════════════════════════════════════════════════════
// B — BUSCAR EN LA BOLSA.
//
// Los mismos filtros del inventario propio MÁS el que de verdad usa un
// asesor cuando busca inventario ajeno: "comparte comisión". Ese filtro va
// arriba y con su propio espacio, no escondido entre los demás, porque es
// el que decide si abre la ficha o pasa de largo.
//
// 🔴 EL VACÍO ES EL ESTADO NORMAL AL PRINCIPIO. Con cinco cuentas esta
// pantalla va a estar vacía y con quinientas va a valer lo que vale
// EasyBroker. El texto lo dice tal cual —"aquí aparecerán los inmuebles que
// otras inmobiliarias compartan"— y no promete una bolsa llena. Prometerlo
// sería que el primer cliente abriera la pantalla y pensara que está rota.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Globe,
  Handshake,
  Loader2,
  MapPin,
  Percent,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
} from "@/lib/realty/types";
import {
  REALTY_MLS_KINDS,
  REALTY_MLS_OPERATIONS,
  type RealtyMlsListingDTO,
  type RealtyMlsSearchResult,
  type RealtyMlsSort,
} from "@/components/realty/mls/mls-contract";
import { FichaModal } from "@/components/realty/mls/ficha-modal";
import {
  Aviso,
  Boton,
  Campo,
  Chip,
  ComisionChip,
  Interruptor,
  Rejilla,
  Selector,
  Tarjeta,
  Texto,
  Vacio,
  money,
  pctText,
} from "@/components/realty/mls/mls-ui";

type Filtros = {
  q: string;
  kind: string;
  operation: string;
  ciudad: string;
  colonia: string;
  precioMin: string;
  precioMax: string;
  recamarasMin: string;
  comisionMin: string;
  soloColaboracion: boolean;
  sort: RealtyMlsSort;
};

const VACIO: Filtros = {
  q: "",
  kind: "",
  operation: "",
  ciudad: "",
  colonia: "",
  precioMin: "",
  precioMax: "",
  recamarasMin: "",
  comisionMin: "",
  soloColaboracion: false,
  sort: "recientes",
};

export function BuscarTab({
  dict,
  timezone,
  puedeAdoptar,
  onIrACompartir,
}: {
  dict: Dictionary;
  timezone: string;
  puedeAdoptar: boolean;
  onIrACompartir: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [filtros, setFiltros] = useState<Filtros>(VACIO);
  const [abiertos, setAbiertos] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(RealtyMlsSearchResult & { truncado?: boolean }) | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ficha, setFicha] = useState<RealtyMlsListingDTO | null>(null);

  // El `q` se escribe letra a letra: sin este retardo cada tecla sería una
  // consulta. 350 ms es lo que tarda alguien en dejar de teclear.
  const [qDebounced, setQDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQDebounced(filtros.q.trim()), 350);
    return () => clearTimeout(id);
  }, [filtros.q]);

  // Cambiar un filtro devuelve a la página 1. Sin esto, filtrar estando en
  // la página 4 da una lista vacía y parece que el buscador no encuentra
  // nada.
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    setPage(1);
  }, [
    qDebounced,
    filtros.kind,
    filtros.operation,
    filtros.ciudad,
    filtros.colonia,
    filtros.precioMin,
    filtros.precioMax,
    filtros.recamarasMin,
    filtros.comisionMin,
    filtros.soloColaboracion,
    filtros.sort,
  ]);

  const buscar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (qDebounced) q.set("q", qDebounced);
      if (filtros.kind) q.set("kind", filtros.kind);
      if (filtros.operation) q.set("operation", filtros.operation);
      if (filtros.ciudad) q.set("ciudad", filtros.ciudad);
      if (filtros.colonia) q.set("colonia", filtros.colonia);
      if (filtros.precioMin) q.set("precioMin", filtros.precioMin);
      if (filtros.precioMax) q.set("precioMax", filtros.precioMax);
      if (filtros.recamarasMin) q.set("recamarasMin", filtros.recamarasMin);
      if (filtros.comisionMin) q.set("comisionMin", filtros.comisionMin);
      if (filtros.soloColaboracion) q.set("soloColaboracion", "1");
      q.set("sort", filtros.sort);
      q.set("page", String(page));

      const res = await fetch(`/api/realty/mls?${q.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        setData(null);
        return;
      }
      setData(json as RealtyMlsSearchResult & { truncado?: boolean });
    } catch {
      setError(t("acciones.error"));
      setData(null);
    } finally {
      setCargando(false);
    }
  }, [
    qDebounced,
    filtros.kind,
    filtros.operation,
    filtros.ciudad,
    filtros.colonia,
    filtros.precioMin,
    filtros.precioMax,
    filtros.recamarasMin,
    filtros.comisionMin,
    filtros.soloColaboracion,
    filtros.sort,
    page,
    // `t` va memoizado en el padre con useMemo: sin eso, makeRealtyT
    // devolvería una función nueva por render y este useCallback cambiaría
    // de identidad en cada uno — bucle infinito de fetch.
    t,
  ]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  /** Abre la ficha completa. Se vuelve a pedir al servidor a propósito: la
   *  del listado puede llevar minutos en pantalla y el dueño pudo retirarla. */
  async function abrirFicha(listingId: string) {
    try {
      const res = await fetch(`/api/realty/mls/fichas/${listingId}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        void buscar();
        return;
      }
      setFicha(json.ficha as RealtyMlsListingDTO);
    } catch {
      setError(t("acciones.error"));
    }
  }

  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) =>
    setFiltros((f) => ({ ...f, [k]: v }));

  const hayFiltros =
    JSON.stringify({ ...filtros, q: filtros.q.trim() }) !== JSON.stringify(VACIO);
  const rows = data?.rows ?? [];
  const facets = data?.facets ?? { ciudades: [], colonias: [] };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Barra de búsqueda + el filtro que de verdad importa ── */}
      <Tarjeta padded>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <Campo label={t("buscar.title")} htmlFor="mls-q">
                <div style={{ position: "relative" }}>
                  <Search
                    size={14}
                    style={{
                      position: "absolute",
                      left: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--text-4)",
                      pointerEvents: "none",
                    }}
                  />
                  <input
                    id="mls-q"
                    type="search"
                    value={filtros.q}
                    onChange={(e) => set("q", e.target.value)}
                    placeholder={t("buscar.placeholder")}
                    style={{
                      width: "100%",
                      padding: "8px 10px 8px 30px",
                      borderRadius: 9,
                      border: "1px solid var(--border-soft)",
                      background: "var(--bg-elev)",
                      color: "var(--text-1)",
                      fontSize: 13,
                      fontFamily: "inherit",
                      outline: "none",
                    }}
                  />
                </div>
              </Campo>
            </div>

            {/* 🔴 "Comparte al menos" NO está escondido en los filtros de
                abajo: es lo primero que un asesor decide. */}
            <div style={{ width: 150 }}>
              <Campo label={t("buscar.comisionMin")} htmlFor="mls-com">
                <div style={{ position: "relative" }}>
                  <Percent
                    size={13}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--text-4)",
                      pointerEvents: "none",
                    }}
                  />
                  <input
                    id="mls-com"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={filtros.comisionMin}
                    onChange={(e) => set("comisionMin", e.target.value)}
                    placeholder="0"
                    style={{
                      width: "100%",
                      padding: "8px 26px 8px 10px",
                      borderRadius: 9,
                      border: "1px solid var(--border-soft)",
                      background: "var(--bg-elev)",
                      color: "var(--text-1)",
                      fontSize: 13,
                      fontFamily: "inherit",
                      outline: "none",
                    }}
                  />
                </div>
              </Campo>
            </div>

            <div style={{ width: 190 }}>
              <Campo label={t("buscar.orden")} htmlFor="mls-sort">
                <Selector
                  id="mls-sort"
                  value={filtros.sort}
                  onChange={(v) => set("sort", v)}
                  options={[
                    { value: "recientes", label: t("buscar.ordenRecientes") },
                    { value: "comisionDesc", label: t("buscar.ordenComision") },
                    { value: "precioAsc", label: t("buscar.ordenPrecioAsc") },
                    { value: "precioDesc", label: t("buscar.ordenPrecioDesc") },
                  ]}
                />
              </Campo>
            </div>

            <Boton onClick={() => setAbiertos((v) => !v)}>
              <SlidersHorizontal size={14} />
              {t("buscar.filtros")}
            </Boton>
          </div>

          <Interruptor
            checked={filtros.soloColaboracion}
            onChange={(v) => set("soloColaboracion", v)}
            label={t("buscar.soloColaboracion")}
          />

          {abiertos ? (
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
                paddingTop: 12,
                borderTop: "1px solid var(--border-soft)",
              }}
            >
              <Campo label={t("buscar.tipo")}>
                <Selector
                  value={filtros.kind}
                  onChange={(v) => set("kind", v)}
                  options={[
                    { value: "", label: t("buscar.todos") },
                    ...REALTY_MLS_KINDS.map((k) => ({
                      value: k as string,
                      label: REALTY_PROPERTY_KIND_LABELS[k] ?? k,
                    })),
                  ]}
                />
              </Campo>
              <Campo label={t("buscar.operacion")}>
                <Selector
                  value={filtros.operation}
                  onChange={(v) => set("operation", v)}
                  options={[
                    { value: "", label: t("buscar.todos") },
                    ...REALTY_MLS_OPERATIONS.map((o) => ({
                      value: o as string,
                      label: REALTY_OPERATION_LABELS[o] ?? o,
                    })),
                  ]}
                />
              </Campo>
              {/* Las ciudades y colonias salen de lo que HAY en la bolsa, no
                  de mi cartera: un select con una ciudad donde la bolsa no
                  tiene nada es un filtro que siempre da cero. */}
              <Campo label={t("buscar.ciudad")}>
                <Selector
                  value={filtros.ciudad}
                  onChange={(v) => set("ciudad", v)}
                  options={[
                    { value: "", label: t("buscar.todos") },
                    ...facets.ciudades.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </Campo>
              <Campo label={t("buscar.colonia")}>
                <Selector
                  value={filtros.colonia}
                  onChange={(v) => set("colonia", v)}
                  options={[
                    { value: "", label: t("buscar.todos") },
                    ...facets.colonias.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </Campo>
              <Campo label={t("buscar.precioMin")}>
                <Texto
                  value={filtros.precioMin}
                  onChange={(v) => set("precioMin", v)}
                  type="number"
                  min={0}
                />
              </Campo>
              <Campo label={t("buscar.precioMax")}>
                <Texto
                  value={filtros.precioMax}
                  onChange={(v) => set("precioMax", v)}
                  type="number"
                  min={0}
                />
              </Campo>
              <Campo label={t("buscar.recamarasMin")}>
                <Texto
                  value={filtros.recamarasMin}
                  onChange={(v) => set("recamarasMin", v)}
                  type="number"
                  min={0}
                />
              </Campo>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <Boton onClick={() => setFiltros(VACIO)} disabled={!hayFiltros}>
                  {t("buscar.limpiar")}
                </Boton>
              </div>
            </div>
          ) : null}
        </div>
      </Tarjeta>

      {data?.truncado ? <Aviso tono="aviso">{t("buscar.truncado")}</Aviso> : null}
      {error ? <Aviso tono="malo">{error}</Aviso> : null}

      {/* ── Resultados ── */}
      {cargando && !data ? (
        <Tarjeta padded>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: 36,
              color: "var(--text-3)",
              fontSize: 13,
            }}
          >
            <Loader2 size={15} className="animate-spin" />
            {t("buscar.cargando")}
          </div>
        </Tarjeta>
      ) : rows.length === 0 ? (
        <Tarjeta padded={false}>
          {hayFiltros ? (
            <Vacio
              icono={<Search size={26} />}
              titulo={t("buscar.sinResultadosTitle")}
              cuerpo={t("buscar.sinResultadosBody")}
              accion={<Boton onClick={() => setFiltros(VACIO)}>{t("buscar.limpiar")}</Boton>}
            />
          ) : (
            <Vacio
              icono={<Handshake size={26} />}
              titulo={t("buscar.vacioTitle")}
              cuerpo={t("buscar.vacioBody")}
              accion={
                <Boton variante="primario" onClick={onIrACompartir}>
                  {t("buscar.vacioCta")}
                </Boton>
              }
            />
          )}
        </Tarjeta>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              {data && data.total === 1
                ? t("buscar.resultadosUno")
                : t("buscar.resultados", { total: data?.total ?? 0 })}
            </span>
            {cargando ? (
              <Loader2 size={13} className="animate-spin" style={{ color: "var(--text-4)" }} />
            ) : null}
          </div>

          <Rejilla min={252}>
            {rows.map((r) => (
              <FichaCard
                key={r.listingId}
                ficha={r}
                dict={dict}
                onAbrir={() => void abrirFicha(r.listingId)}
              />
            ))}
          </Rejilla>

          {data && data.pageCount > 1 ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <Boton onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={data.page <= 1}>
                {t("buscar.anterior")}
              </Boton>
              <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                {t("buscar.pagina", { page: data.page, pageCount: data.pageCount })}
              </span>
              <Boton
                onClick={() => setPage((p) => p + 1)}
                disabled={data.page >= data.pageCount}
              >
                {t("buscar.siguiente")}
              </Boton>
            </div>
          ) : null}
        </>
      )}

      <FichaModal
        dict={dict}
        ficha={ficha}
        timezone={timezone}
        puedeAdoptar={puedeAdoptar}
        onClose={() => setFicha(null)}
        onCambio={() => void buscar()}
      />
    </div>
  );
}

// ── La tarjeta del resultado ───────────────────────────────────────────

/**
 * Cada resultado enseña, en este orden: la propiedad, CUÁNTO COMPARTE,
 * quién la tiene y el botón para hablar con su asesor. La comisión va
 * arriba a la derecha, sobre la foto: es el dato por el que se entra.
 */
function FichaCard({
  ficha,
  dict,
  onAbrir,
}: {
  ficha: RealtyMlsListingDTO;
  dict: Dictionary;
  onAbrir: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const portada = ficha.fotos[0]?.url ?? "";
  const lugar = [ficha.colonia, ficha.ciudad].filter(Boolean).join(", ");

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", background: "var(--bg-elev-2)" }}>
        {portada ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={portada}
            alt={ficha.titulo}
            style={{ width: "100%", height: 152, objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              height: 152,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-4)",
              fontSize: 12,
              gap: 6,
            }}
          >
            <Building2 size={18} />
            {t("ficha.sinFoto")}
          </div>
        )}
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <ComisionChip pct={ficha.comisionCompartida} cero={t("ficha.comparteCero")} />
        </div>
        {ficha.adoptado ? (
          <div style={{ position: "absolute", top: 8, left: 8 }}>
            <Chip tono="brand">
              <Globe size={11} />
              {t("ficha.adoptado")}
            </Chip>
          </div>
        ) : null}
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)", letterSpacing: "-0.02em" }}>
          {money(ficha.precio, ficha.moneda)}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-1)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {ficha.titulo}
        </div>
        {lugar ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11.5,
              color: "var(--text-3)",
            }}
          >
            <MapPin size={12} style={{ flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {lugar}
            </span>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5, color: "var(--text-3)" }}>
          {ficha.recamaras ? <span>{ficha.recamaras} rec</span> : null}
          {ficha.banos ? <span>{ficha.banos} baños</span> : null}
          {ficha.construidoM2 ? <span>{ficha.construidoM2} m²</span> : null}
        </div>

        <div
          style={{
            marginTop: "auto",
            paddingTop: 9,
            borderTop: "1px solid var(--border-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: "var(--text-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
            title={ficha.quienComparte.nombre}
          >
            {t("ficha.de", { agencia: ficha.quienComparte.nombre })}
          </span>
          <button
            type="button"
            onClick={onAbrir}
            style={{
              flexShrink: 0,
              padding: "6px 11px",
              borderRadius: 8,
              border: "1px solid var(--border-brand)",
              background: "var(--brand-soft)",
              color: "var(--brand)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {t("ficha.ver")}
          </button>
        </div>

        {ficha.miAcuerdo ? (
          <Chip tono={ficha.miAcuerdo === "ACEPTADO" ? "ok" : "neutro"}>
            {t(`ficha.miAcuerdo.${ficha.miAcuerdo}`)}
          </Chip>
        ) : !ficha.aceptaColaboracion ? (
          <span style={{ fontSize: 11, color: "var(--text-4)" }}>
            {t("ficha.noAceptaColaboracion")}
          </span>
        ) : ficha.comisionCompartida > 0 ? (
          <span style={{ fontSize: 11, color: "var(--text-4)" }}>
            {t("ficha.compartePct", { pct: pctText(ficha.comisionCompartida) })}
          </span>
        ) : null}
      </div>
    </article>
  );
}
