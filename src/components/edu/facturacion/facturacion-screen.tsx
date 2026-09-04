"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, FileText, Plus, Search } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { eduMoney } from "@/lib/edu/dinero-core";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import {
  EDU_CANCEL_MOTIVES,
  EDU_FISCAL_ENV_LABELS,
  EDU_INVOICE_STATUS_DESCRIPTIONS,
  EDU_INVOICE_STATUS_LABELS,
  EDU_TAX_MODE_LABELS,
  eduDescribeCancelMotive,
  eduDescribeFormaPago,
  eduDescribeUsoCfdi,
  eduFiscalNotice,
  type EduCobroFacturable,
  type EduFiscalConfigView,
  type EduInvoiceRow,
  type EduInvoiceStatus,
  type EduInvoicesPage,
  type EduTaxMode,
} from "@/lib/edu/facturacion-core";
import { FORMAS_PAGO_SAT, REGIMENES_FISCALES, USOS_CFDI } from "@/lib/cfdi-catalogs";

/**
 * /instituto/facturacion — las facturas del instituto.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE ESTA PANTALLA TIENE QUE DECIR SIEMPRE
 *
 * Si el instituto está en PRUEBAS, lo dice arriba del todo Y en cada
 * factura. Un CFDI de prueba se ve idéntico a uno fiscal —tiene folio
 * fiscal, PDF y XML— y la única forma de que nadie se lo entregue a un
 * paciente creyendo que sirve para deducir es que la pantalla lo repita.
 *
 * Y ese dato NO es una constante del código: sale de la configuración del
 * instituto (EduFiscalConfig.environment) y viaja como prop. Cada factura
 * además pinta el ambiente EN QUE SE TIMBRÓ, que puede no ser el de hoy.
 * ═══════════════════════════════════════════════════════════════════════
 */

const TAG_BY_STATUS: Record<EduInvoiceStatus, string> = {
  STAMPING: "edu-tag--warn",
  VALID: "edu-tag--ok",
  CANCELLED: "edu-tag--muted",
  FAILED: "edu-tag--danger",
};

export interface EduFacturacionScreenProps {
  page: EduInvoicesPage;
  config: EduFiscalConfigView | null;
  filtroQ: string;
  filtroEstado: EduInvoiceStatus | null;
  maxRows: number;
  canEmit: boolean;
  canCancel: boolean;
  canConfig: boolean;
  /** Cobro preseleccionado (se llega desde Caja con ?cobro=…). */
  cobroInicial: string | null;
}

export function EduFacturacionScreen({
  page,
  config,
  filtroQ,
  filtroEstado,
  maxRows,
  canEmit,
  canCancel,
  canConfig,
  cobroInicial,
}: EduFacturacionScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [emitir, setEmitir] = useState<string | null>(cobroInicial);
  const [detalle, setDetalle] = useState<EduInvoiceRow | null>(null);
  const [q, setQ] = useState(filtroQ);

  const aviso = useMemo(() => eduFiscalNotice(config), [config]);
  const puedeEmitirYa = Boolean(config?.isEnabled && config.hasOrg);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  function aplicarFiltros(nuevoQ: string, estado: EduInvoiceStatus | null) {
    const params = new URLSearchParams();
    if (nuevoQ.trim()) params.set("q", nuevoQ.trim());
    if (estado) params.set("estado", estado);
    const qs = params.toString();
    startNav(() => router.push(qs ? `/instituto/facturacion?${qs}` : "/instituto/facturacion"));
  }

  return (
    <>
      {/* 🔴 El aviso del ambiente. Nunca se esconde: es la diferencia entre
          un papel y un comprobante fiscal. */}
      <div
        className={`edu-banner ${aviso.level === "vivo" ? "edu-alert--ok" : "edu-banner--warn"}`}
        role="status"
      >
        <div>
          <p className="edu-banner__title">{aviso.title}</p>
          <p className="edu-banner__detail">{aviso.detail}</p>
          {canConfig && (
            <p className="edu-banner__detail">
              <Link className="edu-auth-card__link" href="/instituto/facturacion/datos-fiscales">
                Datos fiscales del instituto →
              </Link>
            </p>
          )}
        </div>
      </div>

      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-kpis">
        <div className="edu-kpi">
          <span className="edu-kpi__label">Facturas timbradas</span>
          <span className="edu-kpi__value">{page.totals.vivas}</span>
          <span className="edu-kpi__note">De las que se listan aquí.</span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Facturado</span>
          <span className="edu-kpi__value">{eduMoney(page.totals.totalCents)}</span>
          <span className="edu-kpi__note">Las canceladas no suman.</span>
        </div>
        <div className="edu-kpi">
          <span className="edu-kpi__label">Canceladas</span>
          <span className="edu-kpi__value">{page.totals.canceladas}</span>
          <span className="edu-kpi__note">Se conservan con su motivo.</span>
        </div>
      </div>

      <div className="edu-toolbar">
        <form
          className="edu-input-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            aplicarFiltros(q, filtroEstado);
          }}
        >
          <label className="edu-field__label" htmlFor="edu-fac-q">
            Buscar
          </label>
          <input
            id="edu-fac-q"
            className="edu-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Folio, UUID, RFC, razón social o paciente"
            autoComplete="off"
          />
          <span className="edu-field__hint">Enter para buscar.</span>
        </form>

        <div className="edu-seg" role="group" aria-label="Estado de la factura">
          <button
            type="button"
            className={`edu-seg__btn ${filtroEstado === null ? "edu-seg__btn--on" : ""}`}
            onClick={() => aplicarFiltros(q, null)}
          >
            Todas
          </button>
          {(["VALID", "CANCELLED", "STAMPING", "FAILED"] as EduInvoiceStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`edu-seg__btn ${filtroEstado === s ? "edu-seg__btn--on" : ""}`}
              onClick={() => aplicarFiltros(q, s)}
            >
              {EDU_INVOICE_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Actualizando…"
            : `${page.rows.length} ${page.rows.length === 1 ? "factura" : "facturas"}${
                page.truncated ? ` (se muestran las ${maxRows} más recientes)` : ""
              }`}
        </span>
        {canEmit && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            disabled={!puedeEmitirYa}
            title={
              puedeEmitirYa
                ? undefined
                : "Captura los datos fiscales del instituto y enciende la facturación antes de emitir."
            }
            onClick={() => {
              setFlash(null);
              setEmitir("");
            }}
          >
            <Plus size={16} />
            Facturar un cobro
          </button>
        )}
      </div>

      {page.rows.length === 0 ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Todavía no hay facturas</p>
          <p className="edu-empty__detail">
            Se factura desde un COBRO ya emitido: en Caja, el botón «Facturar» de cada renglón, o
            aquí con «Facturar un cobro». Los importes salen del cobro tal como se emitió — nunca se
            recalculan con el tarifario de hoy.
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--facturas">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Folio</span>
            <span>Receptor</span>
            <span>Cobro</span>
            <span>Total</span>
            <span>Estado</span>
            <span />
          </div>

          {page.rows.map((f) => (
            <div
              key={f.id}
              className={`edu-row ${f.status === "CANCELLED" || f.status === "FAILED" ? "edu-row--off" : ""}`}
            >
              <div className="edu-cell">
                <span className="edu-cell__label">Folio</span>
                <span className="edu-cell__value edu-cell__value--strong">{f.folio}</span>
                {/* 🔴 El ambiente, factura por factura: el instituto puede
                    haber pasado a EN VIVO y ésta seguir siendo de pruebas. */}
                <span
                  className={`edu-tag ${f.environment === "LIVE" ? "edu-tag--ok" : "edu-tag--warn"}`}
                >
                  {EDU_FISCAL_ENV_LABELS[f.environment]}
                </span>
              </div>

              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Receptor</span>
                <span className="edu-cell__value edu-cell__value--strong">
                  {f.receptorLegalName}
                </span>
                <span className="edu-cell__sub">
                  {f.receptorRfc} ·{" "}
                  <EduPersonaLink kind="paciente" id={f.patientId}>
                    {f.patientName}
                  </EduPersonaLink>
                </span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Cobro</span>
                <span className="edu-cell__value">{f.chargeFolio}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Total</span>
                <span className="edu-cell__value edu-precio">{eduMoney(f.totalCents)}</span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Estado</span>
                <span className={`edu-tag ${TAG_BY_STATUS[f.status]}`}>
                  {EDU_INVOICE_STATUS_LABELS[f.status]}
                </span>
              </div>

              <div className="edu-cell__actions">
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => {
                    setFlash(null);
                    setDetalle(f);
                  }}
                >
                  <FileText size={15} />
                  Ver
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {emitir !== null && (
        <EmitirFactura
          cobroPreseleccionado={emitir || null}
          config={config}
          onClose={() => setEmitir(null)}
          onDone={(folio, ambiente) => {
            setEmitir(null);
            recargar(
              ambiente === "LIVE"
                ? `Factura ${folio} timbrada ante el SAT.`
                : `Factura ${folio} timbrada EN PRUEBAS: no tiene validez fiscal y no se le puede entregar al paciente como comprobante.`,
            );
          }}
        />
      )}

      {detalle && (
        <DetalleFactura
          factura={detalle}
          canCancel={canCancel}
          canConfig={canConfig}
          onClose={() => setDetalle(null)}
          onDone={(mensaje) => {
            setDetalle(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EMITIR
// ═══════════════════════════════════════════════════════════════════════

function EmitirFactura({
  cobroPreseleccionado,
  config,
  onClose,
  onDone,
}: {
  cobroPreseleccionado: string | null;
  config: EduFiscalConfigView | null;
  onClose: () => void;
  onDone: (folio: string, ambiente: "TEST" | "LIVE") => void;
}) {
  const [q, setQ] = useState("");
  const [cobros, setCobros] = useState<EduCobroFacturable[]>([]);
  const [cargando, setCargando] = useState(true);
  const [elegido, setElegido] = useState<EduCobroFacturable | null>(null);

  const [rfc, setRfc] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxRegime, setTaxRegime] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [email, setEmail] = useState("");
  const [usoCfdi, setUsoCfdi] = useState(config?.defaultUsoCfdi ?? "D01");
  const [paymentForm, setPaymentForm] = useState("");
  const [taxMode, setTaxMode] = useState<EduTaxMode>(config?.taxMode ?? "EXENTO");
  const [guardarReceptor, setGuardarReceptor] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buscar = useCallback(async (termino: string) => {
    setCargando(true);
    try {
      const data = await eduRequest<{ rows: EduCobroFacturable[] }>(
        `/api/instituto/facturacion/cobros?q=${encodeURIComponent(termino)}`,
      );
      setCobros(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron leer los cobros.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void buscar("");
  }, [buscar]);

  // Preselección desde Caja: en cuanto llega la lista se busca el cobro.
  useEffect(() => {
    if (!cobroPreseleccionado || elegido) return;
    const hit = cobros.find((c) => c.id === cobroPreseleccionado);
    if (hit) setElegido(hit);
  }, [cobroPreseleccionado, cobros, elegido]);

  // Al elegir cobro se traen los datos fiscales guardados del paciente.
  useEffect(() => {
    if (!elegido) return;
    let vivo = true;
    (async () => {
      try {
        const data = await eduRequest<{
          receptor: {
            rfc: string;
            legalName: string;
            taxRegime: string;
            zipCode: string;
            email: string | null;
            usoCfdi: string;
          } | null;
        }>(`/api/instituto/facturacion/receptores/${elegido.patientId}`);
        if (!vivo || !data.receptor) return;
        setRfc(data.receptor.rfc);
        setLegalName(data.receptor.legalName);
        setTaxRegime(data.receptor.taxRegime);
        setZipCode(data.receptor.zipCode);
        setEmail(data.receptor.email ?? "");
        setUsoCfdi(data.receptor.usoCfdi);
      } catch {
        // Que no haya datos guardados es lo NORMAL la primera vez. No se
        // pinta un error por eso: se deja el formulario vacío.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [elegido]);

  async function timbrar() {
    if (!elegido) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ folio: string; environment: "TEST" | "LIVE" }>(
        "/api/instituto/facturacion",
        {
          method: "POST",
          body: {
            chargeId: elegido.id,
            receptor: {
              rfc,
              legalName,
              taxRegime,
              zipCode,
              email: email.trim() || null,
              usoCfdi,
            },
            guardarReceptor,
            paymentForm,
            taxMode,
          },
        },
      );
      onDone(res.folio, res.environment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo timbrar.");
    } finally {
      setBusy(false);
    }
  }

  const listo = Boolean(
    elegido && rfc.trim() && legalName.trim() && taxRegime && zipCode.trim() && paymentForm,
  );
  const enVivo = config?.environment === "LIVE";

  return (
    <EduModal
      title="Facturar un cobro"
      subtitle={
        elegido ? (
          <>
            Cobro {elegido.folio} ·{" "}
            <EduPersonaLink kind="paciente" id={elegido.patientId}>
              {elegido.patientName}
            </EduPersonaLink>{" "}
            · {eduMoney(elegido.totalCents)}
          </>
        ) : (
          "Elige el cobro que se va a facturar."
        )
      }
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={timbrar}
            disabled={busy || !listo}
          >
            {busy ? "Timbrando…" : enVivo ? "Timbrar ante el SAT" : "Timbrar (pruebas)"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {!elegido ? (
        <>
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-fac-buscacobro">
              Buscar el cobro
            </label>
            <input
              id="edu-fac-buscacobro"
              className="edu-input"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                void buscar(e.target.value);
              }}
              placeholder="Folio del cobro o nombre del paciente"
              autoComplete="off"
            />
            <span className="edu-field__hint">
              Se listan los cobros no cancelados. Los que ya tienen factura viva salen marcados.
            </span>
          </div>

          {cargando ? (
            <p className="edu-note">Buscando…</p>
          ) : cobros.length === 0 ? (
            <p className="edu-note">No hay cobros que coincidan.</p>
          ) : (
            <div className="edu-picklist">
              {cobros.map((c) => {
                const bloqueado = c.facturaFolio !== null;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="edu-pick"
                    disabled={bloqueado}
                    onClick={() => setElegido(c)}
                  >
                    <span className="edu-pick__name">
                      {c.folio} · {c.patientName}
                    </span>
                    <span className="edu-pick__sub">
                      {eduMoney(c.totalCents)}
                      {c.balanceCents > 0 ? ` · debe ${eduMoney(c.balanceCents)}` : " · pagado"}
                      {bloqueado
                        ? ` · ya facturado (${c.facturaFolio}${
                            c.facturaStatus === "STAMPING" ? ", timbrando" : ""
                          })`
                        : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="edu-linea edu-linea--recibo">
            <span className="edu-linea__desc">
              <span className="edu-linea__name">Cobro {elegido.folio}</span>
              <span className="edu-linea__sub">
                {elegido.patientFolio} ·{" "}
                <EduPersonaLink kind="paciente" id={elegido.patientId}>
                  {elegido.patientName}
                </EduPersonaLink>
                {elegido.balanceCents > 0
                  ? ` · queda a deber ${eduMoney(elegido.balanceCents)}`
                  : ""}
              </span>
            </span>
            <span className="edu-linea__total">{eduMoney(elegido.totalCents)}</span>
          </div>
          {/* 🔴 Los importes salen del cobro congelado. Se dice, para que
              nadie busque dónde editarlos en esta pantalla. */}
          <p className="edu-note">
            El importe sale del cobro tal como se emitió. Si hay que cambiarlo, se corrige el cobro
            en Caja: aquí no se teclean importes.
          </p>

          <p className="edu-field__label">Datos fiscales del receptor</p>
          <div className="edu-formgrid edu-formgrid--2">
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-rfc">
                RFC
              </label>
              <input
                id="edu-fac-rfc"
                className="edu-input"
                value={rfc}
                onChange={(e) => setRfc(e.target.value.toUpperCase())}
                placeholder="XAXX010101000"
                autoComplete="off"
              />
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-razon">
                Razón social
              </label>
              <input
                id="edu-fac-razon"
                className="edu-input"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                autoComplete="off"
              />
              <span className="edu-field__hint">
                Como está en su Constancia de Situación Fiscal, sin «S.A. de C.V.».
              </span>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-regimen">
                Régimen fiscal
              </label>
              <select
                id="edu-fac-regimen"
                className="edu-input"
                value={taxRegime}
                onChange={(e) => setTaxRegime(e.target.value)}
              >
                <option value="">Elige…</option>
                {REGIMENES_FISCALES.map((r) => (
                  <option key={r.clave} value={r.clave}>
                    {r.clave} · {r.descripcion}
                  </option>
                ))}
              </select>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-cp">
                Código postal fiscal
              </label>
              <input
                id="edu-fac-cp"
                className="edu-input"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
              />
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-mail">
                Correo (opcional)
              </label>
              <input
                id="edu-fac-mail"
                className="edu-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-uso">
                Uso del CFDI
              </label>
              <select
                id="edu-fac-uso"
                className="edu-input"
                value={usoCfdi}
                onChange={(e) => setUsoCfdi(e.target.value)}
              >
                {USOS_CFDI.map((u) => (
                  <option key={u.clave} value={u.clave}>
                    {u.clave} · {u.descripcion}
                  </option>
                ))}
              </select>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-forma">
                Forma de pago (SAT)
              </label>
              <select
                id="edu-fac-forma"
                className="edu-input"
                value={paymentForm}
                onChange={(e) => setPaymentForm(e.target.value)}
              >
                {/* 🔴 Vacía a propósito: no se adivina. Es el dato con el
                    que el SAT cruza el comprobante contra el depósito. */}
                <option value="">Elige…</option>
                {FORMAS_PAGO_SAT.map((f) => (
                  <option key={f.clave} value={f.clave}>
                    {f.clave} · {f.descripcion}
                  </option>
                ))}
              </select>
            </div>

            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-fac-iva">
                Impuestos
              </label>
              <select
                id="edu-fac-iva"
                className="edu-input"
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value as EduTaxMode)}
              >
                <option value="EXENTO">{EDU_TAX_MODE_LABELS.EXENTO}</option>
                <option value="IVA16">{EDU_TAX_MODE_LABELS.IVA16}</option>
              </select>
              <span className="edu-field__hint">
                Los servicios odontológicos de profesionales están exentos (art. 15 LIVA).
              </span>
            </div>
          </div>

          <label className="edu-check">
            <input
              type="checkbox"
              checked={guardarReceptor}
              onChange={(e) => setGuardarReceptor(e.target.checked)}
            />
            <span className="edu-check__body">
              <span className="edu-check__label">Guardar estos datos para este paciente</span>
              <span className="edu-check__hint">
                La próxima vez salen puestos. No cambia ninguna factura ya emitida: el receptor se
                congela en cada CFDI.
              </span>
            </span>
          </label>

          <div className={`edu-banner ${enVivo ? "edu-alert--ok" : "edu-banner--warn"}`}>
            <div>
              <p className="edu-banner__title">
                {enVivo
                  ? "Se va a timbrar ANTE EL SAT"
                  : "Se va a timbrar EN PRUEBAS: sin validez fiscal"}
              </p>
              <p className="edu-banner__detail">
                {enVivo
                  ? "El comprobante será fiscal y cancelarlo pasa por el SAT."
                  : "El documento tendrá folio fiscal, PDF y XML, pero no llega al SAT. No se lo entregues al paciente como comprobante deducible."}
              </p>
            </div>
          </div>
        </>
      )}
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// DETALLE, DESCARGAS, CANCELACIÓN Y RESCATE
// ═══════════════════════════════════════════════════════════════════════

function DetalleFactura({
  factura,
  canCancel,
  canConfig,
  onClose,
  onDone,
}: {
  factura: EduInvoiceRow;
  canCancel: boolean;
  canConfig: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [modo, setModo] = useState<"ver" | "cancelar" | "resolver">("ver");
  const [motive, setMotive] = useState("02");
  const [reason, setReason] = useState("");
  const [uuid, setUuid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelar() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/facturacion/${factura.id}/cancelar`, {
        method: "POST",
        body: { motive, reason },
      });
      onDone(`Factura ${factura.folio} cancelada. El cobro quedó libre para volver a facturarse.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar.");
    } finally {
      setBusy(false);
    }
  }

  async function resolver(sinTimbre: boolean) {
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/facturacion/${factura.id}/resolver`, {
        method: "POST",
        body: sinTimbre ? { sinTimbre: true } : { uuid },
      });
      onDone(
        sinTimbre
          ? `Factura ${factura.folio} marcada como no timbrada. El cobro quedó libre.`
          : `Factura ${factura.folio} recuperada con su folio fiscal.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo resolver.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title={`Factura ${factura.folio}`}
      subtitle={`${EDU_INVOICE_STATUS_LABELS[factura.status]} · ${
        EDU_FISCAL_ENV_LABELS[factura.environment]
      }`}
      onClose={onClose}
      busy={busy}
      footer={
        modo === "ver" ? (
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose}>
            Cerrar
          </button>
        ) : modo === "cancelar" ? (
          <>
            <button
              type="button"
              className="edu-btn edu-btn--ghost"
              onClick={() => setModo("ver")}
              disabled={busy}
            >
              Volver
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--danger"
              onClick={cancelar}
              disabled={busy || reason.trim().length < 5}
            >
              {busy ? "Cancelando…" : "Cancelar la factura"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="edu-btn edu-btn--ghost"
            onClick={() => setModo("ver")}
            disabled={busy}
          >
            Volver
          </button>
        )
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {factura.environment === "TEST" && (
        <div className="edu-banner edu-banner--warn">
          <div>
            <p className="edu-banner__title">Timbrada EN PRUEBAS</p>
            <p className="edu-banner__detail">
              Este comprobante no llegó al SAT y no tiene validez fiscal, aunque traiga folio fiscal,
              PDF y XML.
            </p>
          </div>
        </div>
      )}

      {modo === "ver" && (
        <>
          <p className="edu-note">{EDU_INVOICE_STATUS_DESCRIPTIONS[factura.status]}</p>

          <div className="edu-kv">
            <span className="edu-kv__k">Receptor</span>
            <span className="edu-kv__v">
              {factura.receptorLegalName} · {factura.receptorRfc}
            </span>
          </div>
          <div className="edu-kv">
            <span className="edu-kv__k">Paciente</span>
            <span className="edu-kv__v">
              {factura.patientFolio} ·{" "}
              <EduPersonaLink kind="paciente" id={factura.patientId}>
                {factura.patientName}
              </EduPersonaLink>
            </span>
          </div>
          <div className="edu-kv">
            <span className="edu-kv__k">Cobro</span>
            <span className="edu-kv__v">{factura.chargeFolio}</span>
          </div>
          <div className="edu-kv">
            <span className="edu-kv__k">Folio fiscal (UUID)</span>
            <span className="edu-kv__v">{factura.uuid ?? "—"}</span>
          </div>
          <div className="edu-kv">
            <span className="edu-kv__k">Uso del CFDI</span>
            <span className="edu-kv__v">{eduDescribeUsoCfdi(factura.usoCfdi)}</span>
          </div>
          <div className="edu-kv">
            <span className="edu-kv__k">Forma de pago</span>
            <span className="edu-kv__v">{eduDescribeFormaPago(factura.paymentForm)}</span>
          </div>
          <div className="edu-kv">
            <span className="edu-kv__k">Impuestos</span>
            <span className="edu-kv__v">{EDU_TAX_MODE_LABELS[factura.taxMode]}</span>
          </div>
          <div className="edu-kv">
            <span className="edu-kv__k">Emitida por</span>
            <span className="edu-kv__v">{factura.issuedByName}</span>
          </div>

          {factura.status === "CANCELLED" && (
            <div className="edu-motivo">
              <p className="edu-field__label">
                Cancelada · {eduDescribeCancelMotive(factura.cancelMotive)}
              </p>
              <p className="edu-note">{factura.cancelReason}</p>
              <p className="edu-note">{factura.cancelledByName}</p>
            </div>
          )}

          {factura.errorMessage && factura.status !== "VALID" && (
            <div className="edu-alert" role="note">
              {factura.errorMessage}
            </div>
          )}

          <div className="edu-lineas">
            {factura.conceptos.map((c, i) => (
              <div className="edu-linea" key={`${c.description}-${i}`}>
                <span className="edu-linea__desc">
                  <span className="edu-linea__name">{c.description}</span>
                  <span className="edu-linea__sub">
                    {c.quantity} × {eduMoney(c.unitPriceCents)}
                    {c.discountCents > 0 ? ` − ${eduMoney(c.discountCents)}` : ""}
                  </span>
                </span>
                <span className="edu-linea__total">{eduMoney(c.totalCents)}</span>
              </div>
            ))}
          </div>

          <div className="edu-totales">
            <div className="edu-totales__fila edu-totales__fila--fuerte">
              <span>Total</span>
              <span>{eduMoney(factura.totalCents)}</span>
            </div>
          </div>

          <div className="edu-actions">
            {(factura.hasXml || factura.hasDocument) && (
              <a
                className="edu-btn edu-btn--ghost edu-btn--sm"
                href={`/api/instituto/facturacion/${factura.id}/archivo/xml`}
              >
                <Download size={15} />
                XML
              </a>
            )}
            {factura.hasDocument && (
              <a
                className="edu-btn edu-btn--ghost edu-btn--sm"
                href={`/api/instituto/facturacion/${factura.id}/archivo/pdf`}
              >
                <Download size={15} />
                PDF
              </a>
            )}
            {canCancel && factura.status === "VALID" && (
              <button
                type="button"
                className="edu-btn edu-btn--danger edu-btn--sm"
                onClick={() => setModo("cancelar")}
              >
                Cancelar factura
              </button>
            )}
            {canConfig && factura.status === "STAMPING" && (
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => setModo("resolver")}
              >
                <Search size={15} />
                Resolver
              </button>
            )}
          </div>
        </>
      )}

      {modo === "cancelar" && (
        <>
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">
                {factura.environment === "LIVE"
                  ? "Cancelar un CFDI timbrado no se deshace"
                  : "Cancelación en ambiente de pruebas"}
              </p>
              <p className="edu-banner__detail">
                {factura.environment === "LIVE"
                  ? "La cancelación va al SAT con su motivo, y desde 2022 el receptor puede rechazarla. No se borra nada: la factura se queda aquí con su folio fiscal y su XML."
                  : "Este comprobante nunca llegó al SAT. Se marca como cancelado en el registro del instituto y el cobro queda libre."}
              </p>
            </div>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-fac-motivo">
              Motivo del SAT
            </label>
            <select
              id="edu-fac-motivo"
              className="edu-input"
              value={motive}
              onChange={(e) => setMotive(e.target.value)}
            >
              {EDU_CANCEL_MOTIVES.map((m) => (
                <option key={m.clave} value={m.clave}>
                  {m.clave} · {m.label}
                </option>
              ))}
            </select>
            <span className="edu-field__hint">
              {EDU_CANCEL_MOTIVES.find((m) => m.clave === motive)?.detail}
            </span>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-fac-razon-cancel">
              Por qué se cancela
            </label>
            <textarea
              id="edu-fac-razon-cancel"
              className="edu-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="El RFC estaba mal capturado; se vuelve a emitir con el correcto."
            />
            <span className="edu-field__hint">
              Con tus palabras. El motivo del catálogo no le explica nada a quien lea esto en seis
              meses.
            </span>
          </div>
        </>
      )}

      {modo === "resolver" && (
        <>
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">Esta factura se quedó a medias</p>
              <p className="edu-banner__detail">
                La conexión con Facturapi se cortó y no se sabe si el timbre salió. El cobro NO se
                liberó a propósito: liberarlo sin mirar sería arriesgarse a un CFDI duplicado. Abre
                Facturapi, busca el comprobante y dinos qué encontraste.
              </p>
            </div>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-fac-uuid">
              SÍ estaba timbrada: pega su folio fiscal (UUID)
            </label>
            <input
              id="edu-fac-uuid"
              className="edu-input"
              value={uuid}
              onChange={(e) => setUuid(e.target.value.toUpperCase())}
              placeholder="AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"
              autoComplete="off"
            />
          </div>
          <div className="edu-actions">
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => resolver(false)}
              disabled={busy || uuid.trim().length < 36}
            >
              {busy ? "Guardando…" : "Registrar el folio fiscal"}
            </button>
            <button
              type="button"
              className="edu-btn edu-btn--ghost edu-btn--sm"
              onClick={() => resolver(true)}
              disabled={busy}
            >
              No hay ningún comprobante: liberar el cobro
            </button>
          </div>
        </>
      )}
    </EduModal>
  );
}
