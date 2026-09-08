"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_INSTITUCION_EDITABLE,
  EDU_INSTITUCION_LABELS,
  EDU_INSTITUCION_NO_EDITABLE,
  type EduInstitucionCampo,
} from "@/lib/edu/institucion-core";

/**
 * /instituto/direccion/instituto — LOS DATOS DE LA PROPIA ESCUELA (H-150).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ CIERRA
 *
 * «Los datos del propio instituto no se editan desde ninguna pantalla del
 * panel. En todo el vertical hay DOS escrituras a EduInstitution, y ninguna
 * es del panel. Nombre, ciudad, estado, teléfono, correo, logo y LA ZONA
 * HORARIA —la que gobierna toda la vista consolidada— no tienen dónde
 * corregirse. Un instituto de Tijuana dado de alta con el default de CDMX
 * no tiene arreglo.»
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA ZONA HORARIA ES LO QUE MÁS PESA DE TODO ESTO, y por eso tiene su
 * propio bloque y su propio aviso. Gobierna qué día es «hoy» en la agenda,
 * a qué mes se carga el gasto de IA, cuándo cierra un turno de caja y qué
 * ve la vista consolidada de dirección. Se valida contra `Intl` en el
 * servidor: «America/Tijuna» por un dedazo movería la escuela entera sin
 * decir nada.
 *
 * 🔴 LO QUE NO SE EDITA SE PINTA CON SU PORQUÉ, en vez de desaparecer. Un
 * campo que falta es una pregunta abierta («¿dónde se cambia el slug?»); un
 * campo que dice por qué no se toca es una respuesta.
 *
 * 🔴 CAMPO EN BLANCO SÍ BORRA, campo ausente no se manda. El formulario
 * envía SOLO lo que cambió: sin eso, un guardado que solo tocaba el
 * teléfono le vaciaría el RFC a la escuela.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduInstitucionVista {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  rfc: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  timezone: string;
  contractStartsAt: string | null;
  contractEndsAt: string | null;
  storageQuotaBytes: string;
}

export interface EduInstitutoScreenProps {
  institucion: EduInstitucionVista;
  canManage: boolean;
  /**
   * Las zonas que este navegador conoce, para el desplegable.
   *
   * ⚠️ Puede venir VACÍA: `Intl.supportedValuesOf` no existe en todos los
   * navegadores (Safari lo estrenó en la 15.4). Cuando falta, el campo cae
   * a un `<input>` de texto y la validación de verdad —la que manda— sigue
   * siendo la del SERVIDOR contra `Intl`. Nunca se valida solo en el
   * cliente: quien manda un PATCH a mano no pasa por esta pantalla.
   */
  zonas: string[];
}

type Editable = EduInstitucionCampo;

const CAMPOS_TEXTO: Exclude<Editable, "name" | "timezone">[] = [
  "legalName",
  "rfc",
  "city",
  "state",
  "phone",
  "email",
  "logoUrl",
];

const PLACEHOLDERS: Record<Editable, string> = {
  name: "Universidad del Noroeste",
  legalName: "Universidad del Noroeste, A.C.",
  rfc: "UNO010203AB4",
  city: "Tijuana",
  state: "Baja California",
  phone: "664 123 4567",
  email: "clinica@escuela.mx",
  logoUrl: "https://…/logo.png",
  timezone: "America/Tijuana",
};

export function EduInstitutoScreen({
  institucion,
  canManage,
  zonas,
}: EduInstitutoScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [form, setForm] = useState(() => ({
    name: institucion.name,
    legalName: institucion.legalName ?? "",
    rfc: institucion.rfc ?? "",
    city: institucion.city ?? "",
    state: institucion.state ?? "",
    phone: institucion.phone ?? "",
    email: institucion.email ?? "",
    logoUrl: institucion.logoUrl ?? "",
    timezone: institucion.timezone,
  }));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const original: Record<Editable, string> = {
    name: institucion.name,
    legalName: institucion.legalName ?? "",
    rfc: institucion.rfc ?? "",
    city: institucion.city ?? "",
    state: institucion.state ?? "",
    phone: institucion.phone ?? "",
    email: institucion.email ?? "",
    logoUrl: institucion.logoUrl ?? "",
    timezone: institucion.timezone,
  };

  const cambiados = (Object.keys(original) as Editable[]).filter(
    (k) => form[k].trim() !== original[k],
  );
  const cambiaZona = form.timezone.trim() !== institucion.timezone;

  async function guardar() {
    setError(null);
    setFlash(null);
    setBusy(true);
    try {
      // 🔴 SOLO LO QUE CAMBIÓ. El servidor trata «ausente» como «no lo
      // toques» y «vacío» como «bórralo»; mandar el formulario entero
      // convertiría cada guardado en una reescritura completa de la ficha.
      const body: Record<string, string | null> = {};
      for (const k of cambiados) {
        const v = form[k].trim();
        body[k] = k === "name" || k === "timezone" ? v : v || null;
      }
      await eduRequest("/api/instituto/institucion", { method: "PATCH", body });
      setFlash(
        cambiaZona
          ? `Guardado. La zona horaria ahora es ${form.timezone.trim()}: la agenda, el corte de caja y el mes del cupo de IA se recalculan con ella desde este momento.`
          : "Guardado.",
      );
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="edu-stack">
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {!canManage && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Puedes ver estos datos, pero no cambiarlos</p>
            <p className="edu-banner__detail">
              Corregirlos pide el permiso <code>sedes.manage</code>, que por defecto solo lleva la
              dirección — es la misma llave con la que se administran las sedes, y los datos del
              instituto son su cabecera. Pídeselo a la dirección: es un interruptor, no un trámite.
            </p>
          </div>
        </div>
      )}

      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Identidad</h2>
            <p className="edu-section__lead">
              Es lo que sale en la cabecera del panel, en los PDF y en las cartas de consentimiento
              que firma un paciente.
            </p>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-inst-name">
            {EDU_INSTITUCION_LABELS.name}
          </label>
          <input
            id="edu-inst-name"
            className="edu-input"
            value={form.name}
            maxLength={EDU_INSTITUCION_EDITABLE.name}
            disabled={!canManage || busy}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder={PLACEHOLDERS.name}
            autoComplete="off"
          />
          <p className="edu-field__hint">No puede quedar vacío.</p>
        </div>

        <div className="edu-formgrid">
          {CAMPOS_TEXTO.map((k) => (
            <div className="edu-field" key={k}>
              <label className="edu-field__label" htmlFor={`edu-inst-${k}`}>
                {EDU_INSTITUCION_LABELS[k]}
              </label>
              <input
                id={`edu-inst-${k}`}
                className="edu-input"
                value={form[k]}
                maxLength={EDU_INSTITUCION_EDITABLE[k]}
                disabled={!canManage || busy}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                placeholder={PLACEHOLDERS[k]}
                autoComplete="off"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Zona horaria</h2>
            <p className="edu-section__lead">
              Decide qué día es «hoy» en la agenda, a qué mes se carga el gasto de IA y con qué hora
              cierra un turno de caja. Es el dato con más consecuencias de esta pantalla.
            </p>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-inst-tz">
            {EDU_INSTITUCION_LABELS.timezone}
          </label>
          {zonas.length > 0 ? (
            <select
              id="edu-inst-tz"
              className="edu-input"
              value={form.timezone}
              disabled={!canManage || busy}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            >
              {/* La actual va SIEMPRE en la lista, aunque este navegador no
                  la conozca: si no, abrir la pantalla la cambiaría sola por
                  la primera del desplegable. */}
              {!zonas.includes(institucion.timezone) && (
                <option value={institucion.timezone}>{institucion.timezone} (la actual)</option>
              )}
              {zonas.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="edu-inst-tz"
              className="edu-input"
              value={form.timezone}
              disabled={!canManage || busy}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              placeholder={PLACEHOLDERS.timezone}
              autoComplete="off"
            />
          )}
          <p className="edu-field__hint">
            Formato IANA («America/Tijuana»). El servidor la comprueba contra el catálogo real: una
            zona inventada se rechaza en vez de guardarse como UTC.
          </p>
        </div>

        {cambiaZona && (
          <div className="edu-banner edu-banner--warn" role="status">
            <div>
              <p className="edu-banner__title">Estás cambiando la hora de toda la escuela</p>
              <p className="edu-banner__detail">
                Las citas NO se mueven: siguen en el mismo instante. Lo que cambia es a qué hora de
                reloj se pintan y a qué día de calendario pertenecen. Cada SEDE puede tener la suya
                —y manda sobre ésta cuando la tiene—; esto es la del instituto, la que usan la vista
                consolidada y las sedes que no capturaron ninguna.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Lo que no se edita aquí</h2>
            <p className="edu-section__lead">
              No es un olvido, y por eso se dice en vez de esconderlo.
            </p>
          </div>
        </div>
        <dl className="edu-stack edu-stack--tight">
          <div className="edu-row">
            <div className="edu-cell edu-cell--wide">
              <span className="edu-cell__label">URL pública (slug)</span>
              <span className="edu-cell__value">
                <code>{institucion.slug}</code>
              </span>
              <span className="edu-cell__sub">{EDU_INSTITUCION_NO_EDITABLE.slug}</span>
            </div>
          </div>
          <div className="edu-row">
            <div className="edu-cell edu-cell--wide">
              <span className="edu-cell__label">Contrato</span>
              <span className="edu-cell__value">
                {institucion.contractStartsAt ? institucion.contractStartsAt.slice(0, 10) : "—"} →{" "}
                {institucion.contractEndsAt ? institucion.contractEndsAt.slice(0, 10) : "sin fecha"}
              </span>
              <span className="edu-cell__sub">{EDU_INSTITUCION_NO_EDITABLE.contractEndsAt}</span>
            </div>
          </div>
          <div className="edu-row">
            <div className="edu-cell edu-cell--wide">
              <span className="edu-cell__label">Cuota de almacenamiento</span>
              <span className="edu-cell__value">
                {(Number(institucion.storageQuotaBytes) / 1024 ** 4).toFixed(2)} TB
              </span>
              <span className="edu-cell__sub">
                {EDU_INSTITUCION_NO_EDITABLE.storageQuotaBytes}
              </span>
            </div>
          </div>
        </dl>
      </section>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {cambiados.length === 0
            ? "Sin cambios sin guardar"
            : `${cambiados.length} ${cambiados.length === 1 ? "cambio" : "cambios"} sin guardar`}
        </span>
        <button
          type="button"
          className="edu-btn edu-btn--primary"
          onClick={guardar}
          disabled={!canManage || busy || cambiados.length === 0}
          title={
            canManage
              ? undefined
              : "Corregir los datos del instituto pide el permiso sedes.manage, que por defecto solo lleva la dirección."
          }
        >
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}
