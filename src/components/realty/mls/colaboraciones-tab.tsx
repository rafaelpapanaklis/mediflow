"use client";

// ═══════════════════════════════════════════════════════════════════════
// E — MIS COLABORACIONES, y C — el acuerdo.
//
// Tres bloques, y cada uno responde una pregunta distinta:
//   1. ACUERDOS      → ¿con quién estoy trabajando y a quién le debo una
//                      respuesta? Lo que me toca responder va PRIMERO.
//   2. EN MI WEB     → ¿qué inventario ajeno estoy enseñando en mi sitio?
//   3. POR COBRAR    → ¿cuánto dinero de colaboraciones está pendiente?
//
// 🔴 EL DINERO NO SE CALCULA AQUÍ. Los importes de "por cobrar" salen de
// RealtyCommissionSplit (T8). Esta pantalla los LEE y los pinta junto al
// acuerdo que los originó; el reparto lo hace `computeSplits` y nadie más.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Coins,
  Eye,
  EyeOff,
  Globe,
  Handshake,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import type {
  RealtyMlsAdoptionDTO,
  RealtyMlsAgreementDTO,
  RealtyMlsDashboard,
  RealtyMlsReceivableDTO,
} from "@/components/realty/mls/mls-contract";
import { REALTY_MLS_MAX_ADOPTIONS } from "@/components/realty/mls/mls-contract";
import {
  Aviso,
  Boton,
  Campo,
  Chip,
  Modal,
  Selector,
  Tarjeta,
  Texto,
  Vacio,
  fechaCorta,
  money,
  pctText,
} from "@/components/realty/mls/mls-ui";

type Operacion = {
  id: string;
  tipo: string;
  status: string;
  monto: number;
  comision: number;
  fecha: string;
};

export function ColaboracionesTab({
  dict,
  timezone,
  panel,
  cargando,
  onRecargar,
}: {
  dict: Dictionary;
  timezone: string;
  panel: RealtyMlsDashboard | null;
  cargando: boolean;
  onRecargar: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cerrando, setCerrando] = useState<RealtyMlsAgreementDTO | null>(null);
  const [contraoferta, setContraoferta] = useState<RealtyMlsAgreementDTO | null>(null);
  const [pctOferta, setPctOferta] = useState("");

  async function responder(
    a: RealtyMlsAgreementDTO,
    accion: "aceptar" | "rechazar" | "cancelar",
    agreedPct?: number,
  ) {
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/mls/acuerdos/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, agreedPct }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      setContraoferta(null);
      setFlash(t("acciones.guardado"));
      onRecargar();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setOcupado(false);
    }
  }

  async function adopcion(a: RealtyMlsAdoptionDTO, patch: { enLaWeb?: boolean } | "borrar") {
    setOcupado(true);
    setError(null);
    try {
      const res =
        patch === "borrar"
          ? await fetch(`/api/realty/mls/adopciones/${a.id}`, { method: "DELETE" })
          : await fetch(`/api/realty/mls/adopciones/${a.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      setFlash(t("acciones.guardado"));
      onRecargar();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setOcupado(false);
    }
  }

  const acuerdos = panel?.acuerdos ?? [];
  const adopciones = panel?.adopciones ?? [];
  const porCobrar = panel?.porCobrar ?? [];

  // Lo que me toca responder va primero: es lo único de esta pantalla que
  // tiene a otra persona esperando del otro lado.
  const ordenados = useMemo(() => {
    const peso = (a: RealtyMlsAgreementDTO) => {
      if (a.status === "PROPUESTO" && a.miPapel === "CAPTO") return 0;
      if (a.status === "PROPUESTO") return 1;
      if (a.status === "ACEPTADO") return 2;
      return 3;
    };
    return [...acuerdos].sort(
      (x, y) => peso(x) - peso(y) || y.propuestoEn.localeCompare(x.propuestoEn),
    );
  }, [acuerdos]);

  if (cargando && !panel) {
    return (
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
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {flash ? (
        <Aviso tono="ok" icono={<CheckCircle2 size={14} />}>
          {flash}
        </Aviso>
      ) : null}
      {error ? (
        <Aviso tono="malo" icono={<ShieldAlert size={14} />}>
          {error}
        </Aviso>
      ) : null}

      {/* ── 1. Acuerdos ── */}
      <Tarjeta titulo={t("colaboraciones.acuerdos")} padded={false}>
        {ordenados.length === 0 ? (
          <Vacio
            icono={<Handshake size={26} />}
            titulo={t("colaboraciones.acuerdosVacioTitle")}
            cuerpo={t("colaboraciones.acuerdosVacioBody")}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {ordenados.map((a) => (
              <AcuerdoFila
                key={a.id}
                a={a}
                dict={dict}
                timezone={timezone}
                ocupado={ocupado}
                onAceptar={() => void responder(a, "aceptar")}
                onContraofertar={() => {
                  setContraoferta(a);
                  setPctOferta(String(a.porcentajeAcordado));
                }}
                onRechazar={() => void responder(a, "rechazar")}
                onCancelar={() => void responder(a, "cancelar")}
                onCerrar={() => setCerrando(a)}
              />
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── 2. En mi web ── */}
      <Tarjeta
        titulo={t("colaboraciones.enMiWeb")}
        sub={t("colaboraciones.enMiWebSub")}
        padded={false}
        accion={
          adopciones.length > 0 ? (
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {t("colaboraciones.enMiWebTope", {
                n: adopciones.length,
                tope: REALTY_MLS_MAX_ADOPTIONS,
              })}
            </span>
          ) : undefined
        }
      >
        {adopciones.length === 0 ? (
          <Vacio
            icono={<Globe size={26} />}
            titulo={t("colaboraciones.enMiWebVacioTitle")}
            cuerpo={t("colaboraciones.enMiWebVacioBody")}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {adopciones.map((ad) => (
              <AdopcionFila
                key={ad.id}
                ad={ad}
                dict={dict}
                ocupado={ocupado}
                onAlternar={() => void adopcion(ad, { enLaWeb: !ad.enLaWeb })}
                onQuitar={() => void adopcion(ad, "borrar")}
              />
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── 3. Por cobrar ── */}
      <Tarjeta titulo={t("colaboraciones.porCobrar")} padded={false}>
        {porCobrar.length === 0 ? (
          <Vacio
            icono={<Coins size={26} />}
            titulo={t("colaboraciones.porCobrarVacioTitle")}
            cuerpo={t("colaboraciones.porCobrarVacioBody")}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {porCobrar.map((r) => (
              <CobroFila key={r.agreementId} r={r} dict={dict} timezone={timezone} />
            ))}
          </div>
        )}
      </Tarjeta>

      {/* ── Contraoferta ── */}
      {contraoferta ? (
        <Modal
          open
          onClose={() => setContraoferta(null)}
          title={t("colaboraciones.contraofertar")}
          ancho={440}
          pie={
            <>
              <Boton onClick={() => setContraoferta(null)} disabled={ocupado}>
                {t("acciones.cancelar")}
              </Boton>
              <Boton
                variante="primario"
                onClick={() => void responder(contraoferta, "aceptar", Number(pctOferta))}
                disabled={ocupado}
              >
                {t("colaboraciones.aceptar")}
              </Boton>
            </>
          }
        >
          <Campo
            label={t("proponer.pct")}
            ayuda={t("colaboraciones.contraofertarAyuda")}
          >
            <Texto value={pctOferta} onChange={setPctOferta} type="number" min={0} max={100} step={0.5} />
          </Campo>
        </Modal>
      ) : null}

      {/* ── Cerrar contra una operación ── */}
      {cerrando ? (
        <CerrarModal
          dict={dict}
          acuerdo={cerrando}
          timezone={timezone}
          onClose={() => setCerrando(null)}
          onHecho={() => {
            setCerrando(null);
            onRecargar();
          }}
        />
      ) : null}
    </div>
  );
}

// ── Fila de acuerdo ────────────────────────────────────────────────────

function AcuerdoFila({
  a,
  dict,
  timezone,
  ocupado,
  onAceptar,
  onContraofertar,
  onRechazar,
  onCancelar,
  onCerrar,
}: {
  a: RealtyMlsAgreementDTO;
  dict: Dictionary;
  timezone: string;
  ocupado: boolean;
  onAceptar: () => void;
  onContraofertar: () => void;
  onRechazar: () => void;
  onCancelar: () => void;
  onCerrar: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const meToca = a.status === "PROPUESTO" && a.miPapel === "CAPTO";

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "13px 18px",
        borderBottom: "1px solid var(--border-soft)",
        flexWrap: "wrap",
        alignItems: "flex-start",
        background: meToca ? "var(--brand-softer)" : undefined,
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
            {a.inmuebleTitulo}
          </span>
          <Chip tono={a.miPapel === "CAPTO" ? "brand" : "neutro"}>
            {t(`colaboraciones.papelCorto.${a.miPapel}`)}
          </Chip>
          <Chip
            tono={
              a.status === "ACEPTADO"
                ? "ok"
                : a.status === "PROPUESTO"
                  ? "aviso"
                  : a.status === "CERRADO"
                    ? "brand"
                    : "neutro"
            }
          >
            {t(`colaboraciones.estado.${a.status}`)}
          </Chip>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>
          {a.contraparte.nombre}
          {a.inmuebleCiudad ? ` · ${a.inmuebleCiudad}` : ""} ·{" "}
          <strong style={{ color: "var(--text-1)" }}>
            {t("colaboraciones.pct", { pct: pctText(a.porcentajeAcordado) })}
          </strong>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 3 }}>
          {a.cerradoEn
            ? t("colaboraciones.cerradoEn", { fecha: fechaCorta(a.cerradoEn, timezone) })
            : a.respondidoEn
              ? t("colaboraciones.respondidoEn", { fecha: fechaCorta(a.respondidoEn, timezone) })
              : t("colaboraciones.propuestoEn", { fecha: fechaCorta(a.propuestoEn, timezone) })}
        </div>
        {a.recado ? (
          <p
            style={{
              margin: "7px 0 0",
              fontSize: 12,
              color: "var(--text-2)",
              lineHeight: 1.6,
              padding: "7px 10px",
              borderLeft: "2px solid var(--border-brand)",
              background: "var(--bg-elev-2)",
              borderRadius: "0 8px 8px 0",
            }}
          >
            {a.recado}
          </p>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
        {meToca ? (
          <>
            <Boton variante="primario" onClick={onAceptar} disabled={ocupado}>
              {t("colaboraciones.aceptar")}
            </Boton>
            <Boton onClick={onContraofertar} disabled={ocupado}>
              {t("colaboraciones.contraofertar")}
            </Boton>
            <Boton variante="peligro" onClick={onRechazar} disabled={ocupado}>
              {t("colaboraciones.rechazar")}
            </Boton>
          </>
        ) : a.status === "PROPUESTO" ? (
          <>
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {t("colaboraciones.esperandoRespuesta")}
            </span>
            <Boton onClick={onCancelar} disabled={ocupado}>
              {t("colaboraciones.cancelar")}
            </Boton>
          </>
        ) : a.status === "ACEPTADO" ? (
          <>
            {/* Cierra quien CAPTA: el deal y su reparto viven en su cuenta. */}
            {a.miPapel === "CAPTO" ? (
              <Boton variante="primario" onClick={onCerrar} disabled={ocupado}>
                {t("colaboraciones.cerrar")}
              </Boton>
            ) : null}
            <Boton onClick={onCancelar} disabled={ocupado}>
              {t("colaboraciones.cancelar")}
            </Boton>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ── Fila de adopción ───────────────────────────────────────────────────

function AdopcionFila({
  ad,
  dict,
  ocupado,
  onAlternar,
  onQuitar,
}: {
  ad: RealtyMlsAdoptionDTO;
  dict: Dictionary;
  ocupado: boolean;
  onAlternar: () => void;
  onQuitar: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);

  return (
    <div
      style={{
        display: "flex",
        gap: 11,
        padding: "12px 18px",
        borderBottom: "1px solid var(--border-soft)",
        alignItems: "center",
        flexWrap: "wrap",
        opacity: ad.vigente ? 1 : 0.7,
      }}
    >
      {ad.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.coverUrl}
          alt=""
          width={46}
          height={46}
          style={{ borderRadius: 9, objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 46,
            height: 46,
            borderRadius: 9,
            background: "var(--bg-elev-2)",
            color: "var(--text-4)",
            flexShrink: 0,
          }}
        >
          <Building2 size={17} />
        </span>
      )}

      <div style={{ flex: 1, minWidth: 170 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-1)" }}>{ad.titulo}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
          {money(ad.precio, ad.moneda)}
          {ad.ciudad ? ` · ${ad.ciudad}` : ""} · {t("ficha.de", { agencia: ad.quienComparte.nombre })}
        </div>
        {!ad.vigente ? (
          <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>
            {t("colaboraciones.yaNoVigente")} — {t("colaboraciones.yaNoVigenteAyuda")}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <Chip tono={ad.enLaWeb && ad.vigente ? "ok" : "neutro"}>
          {ad.enLaWeb ? t("colaboraciones.enLaWeb") : t("colaboraciones.fueraDeLaWeb")}
        </Chip>
        <Boton onClick={onAlternar} disabled={ocupado || !ad.vigente}>
          {ad.enLaWeb ? <EyeOff size={13} /> : <Eye size={13} />}
        </Boton>
        <Boton variante="peligro" onClick={onQuitar} disabled={ocupado}>
          <Trash2 size={13} />
          {t("colaboraciones.quitar")}
        </Boton>
      </div>
    </div>
  );
}

// ── Fila de cobro ──────────────────────────────────────────────────────

function CobroFila({
  r,
  dict,
  timezone,
}: {
  r: RealtyMlsReceivableDTO;
  dict: Dictionary;
  timezone: string;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 18px",
        borderBottom: "1px solid var(--border-soft)",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-1)" }}>
          {r.inmuebleTitulo}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
          {r.contraparte} · {pctText(r.porcentaje)} ·{" "}
          {t(`colaboraciones.papelCorto.${r.miPapel}`)}
          {r.cerradoEn ? ` · ${fechaCorta(r.cerradoEn, timezone)}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text-1)" }}>
          {money(r.monto)}
        </span>
        <Chip tono={r.pagado ? "ok" : "aviso"}>
          {r.pagado ? t("colaboraciones.pagado") : t("colaboraciones.pendiente")}
        </Chip>
      </div>
    </div>
  );
}

// ── Cerrar contra una operación ────────────────────────────────────────

/**
 * El punto donde la bolsa ALIMENTA el reparto de T8.
 *
 * La ruta responde con `splitAplicado`, y esta pantalla lo dice tal cual:
 * si el reparto no admitió la fila (hay partes ya pagadas, o quien cierra
 * no tiene permiso de comisiones), sale el motivo Y la fila exacta para
 * agregarla a mano. Un "listo" a secas sería que alguien descubriera en un
 * mes que a su colega nunca se le apuntó su parte.
 */
function CerrarModal({
  dict,
  acuerdo,
  timezone,
  onClose,
  onHecho,
}: {
  dict: Dictionary;
  acuerdo: RealtyMlsAgreementDTO;
  timezone: string;
  onClose: () => void;
  onHecho: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [ops, setOps] = useState<Operacion[] | null>(null);
  const [dealId, setDealId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [aMano, setAMano] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/realty/mls/acuerdos/${acuerdo.id}/cerrar`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        setOps([]);
        return;
      }
      const lista = (json.operaciones ?? []) as Operacion[];
      setOps(lista);
      if (lista[0]) setDealId(lista[0].id);
    } catch {
      setError(t("acciones.error"));
      setOps([]);
    }
  }, [acuerdo.id, t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cerrar() {
    if (!dealId) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch(`/api/realty/mls/acuerdos/${acuerdo.id}/cerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      if (json.splitAplicado) {
        setResultado(
          json.yaEstaba
            ? t("cerrar.listoYaEstaba", { agencia: acuerdo.contraparte.nombre })
            : t("cerrar.listo", { agencia: acuerdo.contraparte.nombre }),
        );
        // Con el reparto ya escrito no hace falta que nadie haga nada más:
        // se cierra el modal y la lista se recarga.
        setTimeout(onHecho, 1400);
        return;
      }
      // No entró. Se dice el motivo Y la fila exacta.
      setResultado(
        t("cerrar.listoSinSplit", {
          motivo: typeof json.motivo === "string" ? json.motivo : "",
        }),
      );
      setAMano(
        t("cerrar.agregaAMano", {
          nombre: json.split?.externalName ?? acuerdo.contraparte.nombre,
          pct: pctText(Number(json.split?.pct ?? acuerdo.porcentajeAcordado)),
        }),
      );
    } catch {
      setError(t("acciones.error"));
    } finally {
      setOcupado(false);
    }
  }

  const sinOps = ops !== null && ops.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={t("cerrar.title")}
      ancho={520}
      pie={
        resultado ? (
          <Boton variante="primario" onClick={onHecho}>
            {t("acciones.cerrar")}
          </Boton>
        ) : (
          <>
            <Boton onClick={onClose} disabled={ocupado}>
              {t("acciones.cancelar")}
            </Boton>
            <Boton variante="primario" onClick={cerrar} disabled={ocupado || !dealId || sinOps}>
              {ocupado ? t("cerrar.cerrando") : t("cerrar.confirmar")}
            </Boton>
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>
          {t("cerrar.body", { agencia: acuerdo.contraparte.nombre })}
        </p>

        {ops === null ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--text-3)",
              fontSize: 12.5,
            }}
          >
            <Loader2 size={14} className="animate-spin" />
            {t("buscar.cargando")}
          </div>
        ) : sinOps ? (
          <Vacio
            icono={<Coins size={24} />}
            titulo={t("cerrar.sinOperacionesTitle")}
            cuerpo={t("cerrar.sinOperacionesBody")}
            accion={
              <a href="/inmobiliaria/comisiones" style={{ textDecoration: "none" }}>
                <Boton>{t("cerrar.sinOperacionesCta")}</Boton>
              </a>
            }
          />
        ) : (
          <Campo label={t("cerrar.operacion")}>
            <Selector
              value={dealId}
              onChange={setDealId}
              options={ops.map((o) => ({
                value: o.id,
                label: `${o.tipo} · ${money(o.monto)} · ${t("cerrar.comisionOperacion")} ${money(
                  o.comision,
                )} · ${fechaCorta(o.fecha, timezone)}`,
              }))}
            />
          </Campo>
        )}

        {resultado ? (
          <Aviso tono={aMano ? "aviso" : "ok"} icono={<CheckCircle2 size={14} />}>
            <div>{resultado}</div>
            {aMano ? (
              <div style={{ marginTop: 6, fontWeight: 600 }}>
                {aMano}{" "}
                <a
                  href="/inmobiliaria/comisiones"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  {t("cerrar.irAComisiones")}
                </a>
              </div>
            ) : null}
          </Aviso>
        ) : null}

        {error ? (
          <Aviso tono="malo" icono={<ShieldAlert size={14} />}>
            {error}
          </Aviso>
        ) : null}
      </div>
    </Modal>
  );
}
