"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CLAVES_SAT_MEDICOS, REGIMENES_FISCALES, USOS_CFDI } from "@/lib/cfdi-catalogs";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_FISCAL_ENV_DETAILS,
  EDU_FISCAL_ENV_LABELS,
  EDU_TAX_MODE_DETAILS,
  EDU_TAX_MODE_LABELS,
  eduFiscalNotice,
  type EduFiscalConfigView,
  type EduFiscalEnv,
  type EduFiscalReadiness,
  type EduTaxMode,
} from "@/lib/edu/facturacion-core";

/**
 * /instituto/facturacion/datos-fiscales — el RFC del instituto y el
 * interruptor PRUEBAS / EN VIVO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 ESTA PANTALLA ES LA FUENTE DEL AVISO DE TODO EL MÓDULO
 *
 * El ambiente NO es una variable de entorno del despliegue (así lo hace el
 * dental, y por eso una sola variable decide por todos los productos a la
 * vez). Aquí es un DATO del instituto, y lo que se guarda en este
 * formulario es exactamente lo que la pantalla de facturas le dice a quien
 * está en el mostrador.
 *
 * Pasar a EN VIVO no se puede "probar a ver": el servidor le pregunta a
 * Facturapi si la organización ya puede emitir ante el SAT y rechaza el
 * cambio con la lista de lo que falta. Lo que sí se puede es capturar los
 * datos aunque Facturapi esté caído — se guardan y se avisa.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduDatosFiscalesScreenProps {
  config: EduFiscalConfigView | null;
  readiness: EduFiscalReadiness;
}

export function EduDatosFiscalesScreen({ config, readiness }: EduDatosFiscalesScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();

  const [rfc, setRfc] = useState(config?.rfc ?? "");
  const [legalName, setLegalName] = useState(config?.legalName ?? "");
  const [taxRegime, setTaxRegime] = useState(config?.taxRegime ?? "");
  const [zipCode, setZipCode] = useState(config?.zipCode ?? "");
  const [environment, setEnvironment] = useState<EduFiscalEnv>(config?.environment ?? "TEST");
  const [isEnabled, setIsEnabled] = useState(config?.isEnabled ?? false);
  const [taxMode, setTaxMode] = useState<EduTaxMode>(config?.taxMode ?? "EXENTO");
  const [defaultUsoCfdi, setDefaultUsoCfdi] = useState(config?.defaultUsoCfdi ?? "D01");
  const [defaultProductKey, setDefaultProductKey] = useState(
    config?.defaultProductKey ?? CLAVES_SAT_MEDICOS.dental.clave,
  );
  const [folioPrefix, setFolioPrefix] = useState(config?.folioPrefix ?? "F");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const aviso = eduFiscalNotice(
    rfc && legalName ? { environment, isEnabled } : config,
  );

  async function guardar() {
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ aviso: string | null }>(
        "/api/instituto/facturacion/datos-fiscales",
        {
          method: "PUT",
          body: {
            rfc,
            legalName,
            taxRegime,
            zipCode,
            environment,
            isEnabled,
            taxMode,
            defaultUsoCfdi,
            defaultProductKey,
            folioPrefix,
          },
        },
      );
      setOk(res.aviso ?? "Datos fiscales guardados.");
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className={`edu-banner ${aviso.level === "vivo" ? "edu-alert--ok" : "edu-banner--warn"}`}
        role="status"
      >
        <div>
          <p className="edu-banner__title">{aviso.title}</p>
          <p className="edu-banner__detail">{aviso.detail}</p>
        </div>
      </div>

      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}
      {ok && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{ok}</p>
          </div>
        </div>
      )}

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Identidad fiscal del instituto</h2>
          <p className="edu-section__lead">
            Es lo que va como EMISOR en cada CFDI. Cópialo de la Constancia de Situación Fiscal del
            instituto: si algo no coincide, el SAT rechaza el timbrado.
          </p>
        </div>

        <div className="edu-formgrid edu-formgrid--2">
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-df-rfc">
              RFC
            </label>
            <input
              id="edu-df-rfc"
              className="edu-input"
              value={rfc}
              onChange={(e) => setRfc(e.target.value.toUpperCase())}
              placeholder="IEO010101AAA"
              autoComplete="off"
            />
            <span className="edu-field__hint">Sin guiones ni espacios.</span>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-df-razon">
              Razón social
            </label>
            <input
              id="edu-df-razon"
              className="edu-input"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              autoComplete="off"
            />
            <span className="edu-field__hint">Sin el régimen de capital («S.A. de C.V.»).</span>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-df-regimen">
              Régimen fiscal
            </label>
            <select
              id="edu-df-regimen"
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
            <label className="edu-field__label" htmlFor="edu-df-cp">
              Código postal del domicilio fiscal
            </label>
            <input
              id="edu-df-cp"
              className="edu-input"
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value)}
              inputMode="numeric"
              maxLength={5}
              autoComplete="off"
            />
          </div>
        </div>
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Pruebas o en vivo</h2>
          <p className="edu-section__lead">
            Es la decisión más importante de esta pantalla, y la que lee toda la facturación del
            panel para saber qué decirle a quien emite.
          </p>
        </div>

        <div className="edu-seg" role="group" aria-label="Ambiente de timbrado">
          {(["TEST", "LIVE"] as EduFiscalEnv[]).map((env) => (
            <button
              key={env}
              type="button"
              className={`edu-seg__btn ${environment === env ? "edu-seg__btn--on" : ""}`}
              onClick={() => setEnvironment(env)}
            >
              {EDU_FISCAL_ENV_LABELS[env]}
            </button>
          ))}
        </div>
        <p className="edu-note">{EDU_FISCAL_ENV_DETAILS[environment]}</p>

        {environment === "LIVE" && config?.environment !== "LIVE" && (
          <div className="edu-banner edu-banner--warn">
            <div>
              <p className="edu-banner__title">Al guardar se comprueba con Facturapi</p>
              <p className="edu-banner__detail">
                Si a la organización del instituto todavía le falta el CSD, la Carta Manifiesto o el
                logo, el cambio se rechaza y se dice qué falta. Encenderlo a ciegas sería descubrirlo
                con el paciente en el mostrador y un timbre gastado.
              </p>
            </div>
          </div>
        )}

        <label className="edu-check">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
          />
          <span className="edu-check__body">
            <span className="edu-check__label">Facturación encendida</span>
            <span className="edu-check__hint">
              Apagada, nadie puede emitir — ni en pruebas. Sirve para capturar todo esto con calma
              antes de abrir la puerta.
            </span>
          </span>
        </label>
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Lo que Facturapi dice que falta</h2>
          <p className="edu-section__lead">
            Esto NO lo decide el panel: se le pregunta a Facturapi, que es quien sabe si la
            organización del instituto puede emitir ante el SAT.
          </p>
        </div>

        {readiness.unavailableReason ? (
          <div className="edu-alert" role="note">
            {readiness.unavailableReason}
          </div>
        ) : readiness.productionReady ? (
          <div className="edu-auth-puerta edu-auth-puerta--ok">
            <span className="edu-auth-puerta__k">Listo para timbrar ante el SAT</span>
            <span className="edu-auth-puerta__v">
              {readiness.certificateExpiresAt
                ? `El certificado vence el ${new Date(
                    readiness.certificateExpiresAt,
                  ).toLocaleDateString("es-MX", { timeZone: "UTC" })}`
                : "Certificado cargado"}
            </span>
          </div>
        ) : (
          <div className="edu-auth-puertas">
            <div className="edu-auth-puerta edu-auth-puerta--falta">
              <span className="edu-auth-puerta__k">Todavía no puede timbrar ante el SAT</span>
              <span className="edu-auth-puerta__v">
                {readiness.pendingSteps.length > 0
                  ? readiness.pendingSteps.map((s) => s.description || s.type).join(" · ")
                  : "Facturapi no detalló qué falta. Revísalo en su panel."}
              </span>
            </div>
            <p className="edu-note">
              El CSD (.cer y .key), la Carta Manifiesto firmada con la e.firma y el logo se cargan en
              el panel de Facturapi, con la cuenta de DaleControl. En PRUEBAS no hace falta nada de
              eso: Facturapi timbra con sus propios certificados.
            </p>
          </div>
        )}
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <h2 className="edu-section__title">Cómo salen las facturas</h2>
          <p className="edu-section__lead">
            Los valores que se proponen al emitir. Se pueden cambiar factura por factura.
          </p>
        </div>

        <div className="edu-formgrid edu-formgrid--2">
          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-df-iva">
              Impuestos
            </label>
            <select
              id="edu-df-iva"
              className="edu-input"
              value={taxMode}
              onChange={(e) => setTaxMode(e.target.value as EduTaxMode)}
            >
              <option value="EXENTO">{EDU_TAX_MODE_LABELS.EXENTO}</option>
              <option value="IVA16">{EDU_TAX_MODE_LABELS.IVA16}</option>
            </select>
            <span className="edu-field__hint">{EDU_TAX_MODE_DETAILS[taxMode]}</span>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-df-uso">
              Uso del CFDI que se propone
            </label>
            <select
              id="edu-df-uso"
              className="edu-input"
              value={defaultUsoCfdi}
              onChange={(e) => setDefaultUsoCfdi(e.target.value)}
            >
              {USOS_CFDI.map((u) => (
                <option key={u.clave} value={u.clave}>
                  {u.clave} · {u.descripcion}
                </option>
              ))}
            </select>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-df-clave">
              Clave del SAT de los conceptos
            </label>
            <input
              id="edu-df-clave"
              className="edu-input"
              value={defaultProductKey}
              onChange={(e) => setDefaultProductKey(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={8}
              autoComplete="off"
            />
            <span className="edu-field__hint">
              Ocho dígitos del catálogo c_ClaveProdServ. {CLAVES_SAT_MEDICOS.dental.clave} ={" "}
              {CLAVES_SAT_MEDICOS.dental.descripcion}.
            </span>
          </div>

          <div className="edu-field">
            <label className="edu-field__label" htmlFor="edu-df-prefijo">
              Prefijo del folio interno
            </label>
            <input
              id="edu-df-prefijo"
              className="edu-input"
              value={folioPrefix}
              onChange={(e) => setFolioPrefix(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
              maxLength={6}
              autoComplete="off"
            />
            <span className="edu-field__hint">
              Las facturas se numeran {folioPrefix || "F"}-0001, {folioPrefix || "F"}-0002… No es el
              folio fiscal: ése es el UUID que devuelve el SAT.
            </span>
          </div>
        </div>
      </section>

      <div className="edu-actions">
        <button
          type="button"
          className="edu-btn edu-btn--primary"
          onClick={guardar}
          disabled={busy || !rfc.trim() || !legalName.trim() || !taxRegime || !zipCode.trim()}
        >
          {busy ? "Guardando…" : "Guardar datos fiscales"}
        </button>
      </div>

      {config && (
        <p className="edu-note">
          Última edición: {config.updatedByName ?? "—"} ·{" "}
          {new Date(config.updatedAt).toLocaleString("es-MX")}
        </p>
      )}
    </>
  );
}
