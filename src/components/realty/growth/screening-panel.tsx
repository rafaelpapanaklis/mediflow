"use client";

// ═══════════════════════════════════════════════════════════════════════
// INVESTIGACIÓN DE INQUILINO — el expediente y su flujo.
//
// EL ORDEN DE LOS PASOS ES LA PARTE LEGAL, no un detalle de UX:
//
//   1. CAPTURA        → alguien del equipo llena los datos del candidato.
//   2. AUTORIZACIÓN   → 🔴 la firma el INVESTIGADO, no el asesor. Consultar
//                       el buró de crédito de una persona sin su permiso
//                       expreso es ilegal en México (Ley para Regular las
//                       Sociedades de Información Crediticia art. 28, y
//                       LFPDPPP art. 8). Se guarda el texto COMPLETO que
//                       aceptó, con fecha, nombre e IP.
//   3. SOLICITUD      → hasta aquí no ha salido nada al proveedor.
//   4. RESULTADO      → se adjunta al expediente y queda en el historial.
//
// La pantalla NO deja saltarse el paso 2: el botón de "Enviar la solicitud"
// no existe mientras el estado sea PENDIENTE_CONSENTIMIENTO, y la ruta lo
// vuelve a exigir (y la base lo repite con un CHECK). Tres capas para lo
// mismo porque es lo único aquí que puede terminar en una demanda.
//
// PROVEEDOR: hoy solo "manual" — se solicita, alguien de DaleControl la
// tramita y sube el resultado. NO hay integración con Liv, Moradauno,
// Multiburó ni Inquilino Seguro porque todavía no hay convenio. El
// adaptador está listo (RealtyScreeningProvider en growth-shared.ts) y
// enchufar uno es escribir un objeto y registrarlo: esta pantalla no cambia.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSearch, Plus, ShieldCheck, Trash2, Upload } from "lucide-react";
import {
  REALTY_SCREENING_INCLUDES,
  REALTY_SCREENING_RECOMMENDATION_LABELS,
  REALTY_SCREENING_STATUS_LABELS,
  REALTY_SCREENING_TIER_LABELS,
  buildRealtyScreeningConsentText,
  emptyRealtyScreeningApplicant,
  type RealtyScreeningApplicant,
  type RealtyScreeningDTO,
  type RealtyScreeningRecommendation,
  type RealtyScreeningRiskLevel,
  type RealtyScreeningTier,
} from "./growth-shared";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { Dictionary } from "@/i18n/t";
import {
  Aviso,
  Boton,
  Campo,
  Modal,
  Pastilla,
  Rejilla,
  Tarjeta,
  Vacio,
  apiJson,
  areaBase,
  fechaHora,
  inputBase,
  pesos,
} from "./growth-ui";

const TIERS: RealtyScreeningTier[] = ["BASICA", "COMPLETA"];
const RIESGOS: RealtyScreeningRiskLevel[] = ["BAJO", "MEDIO", "ALTO", "SIN_DATO"];
const DICTAMENES: RealtyScreeningRecommendation[] = [
  "APROBADO",
  "APROBADO_CON_AVAL",
  "RECHAZADO",
  "SIN_DICTAMEN",
];

interface ContactoLite {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export function RealtyScreeningPanel({
  dict,
  timeZone,
  accountName,
  /** Cuando la monta la ficha de un contacto, ya sabe a quién investigar. */
  contactoFijo,
  leaseId,
  propertyId,
}: {
  dict: Dictionary;
  timeZone: string;
  accountName: string;
  contactoFijo?: ContactoLite | null;
  leaseId?: string | null;
  propertyId?: string | null;
}) {
  // Convención B: sub-árbol ya recortado → prefijo VACÍO. `t` es nueva por
  // render: nunca en las deps de un efecto.
  const t = makeRealtyT(dict);

  const [lista, setLista] = useState<RealtyScreeningDTO[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<RealtyScreeningDTO | null>(null);

  const url = useMemo(() => {
    const qs = new URLSearchParams();
    if (contactoFijo?.id) qs.set("contactId", contactoFijo.id);
    if (leaseId) qs.set("leaseId", leaseId);
    const q = qs.toString();
    return q ? `/api/realty/screening?${q}` : "/api/realty/screening";
  }, [contactoFijo?.id, leaseId]);

  const recargar = useCallback(async () => {
    const r = await apiJson<{ requests: RealtyScreeningDTO[] }>(url);
    if (r.ok && r.data) {
      setLista(r.data.requests ?? []);
      setError(null);
      // Si el detalle abierto cambió de estado, se refresca en su sitio:
      // volver a la lista después de autorizar sería perder el hilo.
      setAbierta((prev) =>
        prev ? ((r.data?.requests ?? []).find((x) => x.id === prev.id) ?? null) : null,
      );
    } else {
      setError(r.error ?? null);
    }
    setCargando(false);
  }, [url]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return (
    <Tarjeta
      titulo={t("screening.title")}
      sub={t("screening.sub")}
      accion={
        <Boton tono="primario" pequeno onClick={() => setCreando(true)}>
          <Plus size={13} aria-hidden="true" />
          {contactoFijo ? t("screening.investigarA") : t("screening.nueva")}
        </Boton>
      }
    >
      {error && <Aviso tono="malo">{error}</Aviso>}

      {cargando ? (
        <Vacio texto={t("comun.cargando")} />
      ) : lista.length === 0 ? (
        <Vacio texto={t("screening.vacio")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lista.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setAbierta(s)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 12,
                background: "var(--bg-elev-2)",
                border: "1px solid var(--border-soft)",
                cursor: "pointer",
                fontFamily: "inherit",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0, display: "flex", gap: 10, alignItems: "center" }}>
                <FileSearch size={16} style={{ color: "var(--text-4)" }} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                    {s.contactName}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-4)" }}>
                    {REALTY_SCREENING_TIER_LABELS[s.tier]}
                    {s.propertyTitle ? ` · ${s.propertyTitle}` : ""} ·{" "}
                    {fechaHora(s.createdAt, timeZone)}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                {s.recommendation && s.recommendation !== "SIN_DICTAMEN" && (
                  <Pastilla tono={s.recommendation === "RECHAZADO" ? "malo" : "bueno"}>
                    {REALTY_SCREENING_RECOMMENDATION_LABELS[s.recommendation]}
                  </Pastilla>
                )}
                <Pastilla
                  tono={
                    s.status === "LISTA"
                      ? "bueno"
                      : s.status === "CANCELADA"
                        ? "malo"
                        : s.status === "PENDIENTE_CONSENTIMIENTO"
                          ? "alerta"
                          : "info"
                  }
                >
                  {REALTY_SCREENING_STATUS_LABELS[s.status]}
                </Pastilla>
              </div>
            </button>
          ))}
        </div>
      )}

      <NuevaModal
        abierto={creando}
        t={t}
        contactoFijo={contactoFijo ?? null}
        leaseId={leaseId ?? null}
        propertyId={propertyId ?? null}
        onCerrar={() => setCreando(false)}
        onCreada={async () => {
          setCreando(false);
          await recargar();
        }}
      />

      <DetalleModal
        solicitud={abierta}
        t={t}
        timeZone={timeZone}
        accountName={accountName}
        onCerrar={() => setAbierta(null)}
        onCambio={recargar}
      />
    </Tarjeta>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Paso 1 — CAPTURA
   ═══════════════════════════════════════════════════════════════════════ */

function NuevaModal({
  abierto,
  t,
  contactoFijo,
  leaseId,
  propertyId,
  onCerrar,
  onCreada,
}: {
  abierto: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
  contactoFijo: ContactoLite | null;
  leaseId: string | null;
  propertyId: string | null;
  onCerrar: () => void;
  onCreada: () => void | Promise<void>;
}) {
  const [tier, setTier] = useState<RealtyScreeningTier>("BASICA");
  const [ap, setAp] = useState<RealtyScreeningApplicant>(emptyRealtyScreeningApplicant());
  const [contacto, setContacto] = useState<ContactoLite | null>(contactoFijo);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<ContactoLite[]>([]);
  const [sinBuscador, setSinBuscador] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setTier("BASICA");
    setContacto(contactoFijo);
    setAp({ ...emptyRealtyScreeningApplicant(), fullName: contactoFijo?.name ?? "" });
    setBusqueda("");
    setResultados([]);
    setError(null);
  }, [abierto, contactoFijo]);

  // Buscador de contactos con espera: teclear "María" no puede disparar
  // cinco consultas. 300 ms es lo que tarda una persona en dejar de teclear.
  useEffect(() => {
    if (contactoFijo) return undefined;
    const q = busqueda.trim();
    if (q.length < 2) {
      setResultados([]);
      return undefined;
    }
    let vivo = true;
    const id = setTimeout(async () => {
      const r = await apiJson<{ contacts: ContactoLite[] }>(
        `/api/realty/contacts?limit=8&search=${encodeURIComponent(q)}`,
      );
      if (!vivo) return;
      if (r.ok && r.data) {
        setResultados(r.data.contacts ?? []);
        setSinBuscador(false);
      } else {
        // El buscador pide `leads.view`, que es un permiso distinto del que
        // abre esta pantalla (`leases.manage`). Quien no lo tenga no puede
        // buscar aquí: se le dice, y entra por la ficha del contacto.
        setResultados([]);
        setSinBuscador(true);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(id);
    };
  }, [busqueda, contactoFijo]);

  const faltaId = !ap.curp?.trim() && !ap.rfc?.trim();

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={contactoFijo ? t("screening.investigarA") : t("screening.nueva")}
      cerrarLabel={t("comun.cerrar")}
      ancho={720}
      pie={
        <>
          <Boton tono="fantasma" onClick={onCerrar}>
            {t("comun.cancelar")}
          </Boton>
          <Boton
            tono="primario"
            disabled={guardando || !contacto || ap.fullName.trim().length < 5 || faltaId}
            onClick={async () => {
              if (!contacto) return;
              setGuardando(true);
              setError(null);
              const r = await apiJson("/api/realty/screening", {
                method: "POST",
                json: { contactId: contacto.id, tier, leaseId, propertyId, applicant: ap },
              });
              setGuardando(false);
              if (!r.ok) {
                setError(r.error ?? t("errores.red"));
                return;
              }
              await onCreada();
            }}
          >
            {guardando ? t("screening.creando") : t("screening.crear")}
          </Boton>
        </>
      }
    >
      {error && <Aviso tono="malo">{error}</Aviso>}

      {/* Contacto */}
      {contactoFijo ? (
        <Aviso tono="info">
          <strong>{contactoFijo.name}</strong>
          {contactoFijo.phone ? ` · ${contactoFijo.phone}` : ""}
        </Aviso>
      ) : (
        <Campo label={t("screening.nombre")} htmlFor="rs-buscar">
          <input
            id="rs-buscar"
            type="search"
            value={contacto ? contacto.name : busqueda}
            onChange={(e) => {
              setContacto(null);
              setBusqueda(e.target.value);
            }}
            style={inputBase}
          />
          {sinBuscador && <Aviso tono="alerta">{t("errores.sinPermiso")}</Aviso>}
          {!contacto && resultados.length > 0 && (
            <div
              style={{
                marginTop: 6,
                borderRadius: 10,
                border: "1px solid var(--border-soft)",
                overflow: "hidden",
              }}
            >
              {resultados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setContacto(c);
                    setAp((s) => ({
                      ...s,
                      fullName: s.fullName || c.name,
                      phone: s.phone || c.phone,
                      email: s.email || c.email,
                    }));
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 12px",
                    background: "var(--bg)",
                    border: "none",
                    borderBottom: "1px solid var(--border-soft)",
                    color: "var(--text-1)",
                    fontSize: 12.5,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ""}
                </button>
              ))}
            </div>
          )}
        </Campo>
      )}

      {/* Nivel */}
      <Campo label={t("screening.nivel")} htmlFor="rs-tier">
        <select
          id="rs-tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as RealtyScreeningTier)}
          style={inputBase}
        >
          {TIERS.map((x) => (
            <option key={x} value={x}>
              {REALTY_SCREENING_TIER_LABELS[x]}
            </option>
          ))}
        </select>
      </Campo>
      <div
        style={{
          padding: "11px 13px",
          borderRadius: 11,
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-4)", marginBottom: 6 }}>
          {t("screening.incluye")}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>
          {REALTY_SCREENING_INCLUDES[tier].map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>

      {/* Datos */}
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
        {t("screening.datos")}
      </div>
      <Rejilla min={210}>
        <Campo label={t("screening.nombre")} htmlFor="rs-nombre">
          <input
            id="rs-nombre"
            type="text"
            value={ap.fullName}
            onChange={(e) => setAp((s) => ({ ...s, fullName: e.target.value }))}
            style={inputBase}
          />
        </Campo>
        <Campo label={t("screening.telefono")} htmlFor="rs-tel">
          <input
            id="rs-tel"
            type="tel"
            value={ap.phone ?? ""}
            onChange={(e) => setAp((s) => ({ ...s, phone: e.target.value || null }))}
            style={inputBase}
          />
        </Campo>
        <Campo label={t("screening.email")} htmlFor="rs-mail">
          <input
            id="rs-mail"
            type="email"
            value={ap.email ?? ""}
            onChange={(e) => setAp((s) => ({ ...s, email: e.target.value || null }))}
            style={inputBase}
          />
        </Campo>
        <Campo
          label={t("screening.curp")}
          hint={faltaId ? t("screening.curpRfcHint") : undefined}
          htmlFor="rs-curp"
        >
          <input
            id="rs-curp"
            type="text"
            maxLength={18}
            value={ap.curp ?? ""}
            onChange={(e) => setAp((s) => ({ ...s, curp: e.target.value.toUpperCase() || null }))}
            style={inputBase}
          />
        </Campo>
        <Campo label={t("screening.rfc")} htmlFor="rs-rfc">
          <input
            id="rs-rfc"
            type="text"
            maxLength={13}
            value={ap.rfc ?? ""}
            onChange={(e) => setAp((s) => ({ ...s, rfc: e.target.value.toUpperCase() || null }))}
            style={inputBase}
          />
        </Campo>
        <Campo label={t("screening.nacimiento")} htmlFor="rs-nac">
          <input
            id="rs-nac"
            type="date"
            value={ap.birthDate ?? ""}
            onChange={(e) => setAp((s) => ({ ...s, birthDate: e.target.value || null }))}
            style={inputBase}
          />
        </Campo>
        <Campo
          label={t("screening.ingreso")}
          hint={t("screening.ingresoHint")}
          htmlFor="rs-ingreso"
        >
          <input
            id="rs-ingreso"
            type="number"
            min={0}
            value={ap.declaredIncomeMxn ?? ""}
            onChange={(e) =>
              setAp((s) => ({
                ...s,
                declaredIncomeMxn: e.target.value ? Number(e.target.value) : null,
              }))
            }
            style={inputBase}
          />
        </Campo>
        <Campo label={t("screening.empleador")} htmlFor="rs-empleo">
          <input
            id="rs-empleo"
            type="text"
            value={ap.employer ?? ""}
            onChange={(e) => setAp((s) => ({ ...s, employer: e.target.value || null }))}
            style={inputBase}
          />
        </Campo>
        <Campo label={t("screening.puesto")} htmlFor="rs-puesto">
          <input
            id="rs-puesto"
            type="text"
            value={ap.jobTitle ?? ""}
            onChange={(e) => setAp((s) => ({ ...s, jobTitle: e.target.value || null }))}
            style={inputBase}
          />
        </Campo>
      </Rejilla>

      {/* Referencias */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 9,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
            {t("screening.referencias")}
          </span>
          <Boton
            pequeno
            onClick={() =>
              setAp((s) => ({
                ...s,
                references: [...s.references, { name: "", phone: "", relation: null }],
              }))
            }
          >
            <Plus size={12} aria-hidden="true" />
            {t("screening.agregarReferencia")}
          </Boton>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {ap.references.map((ref, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 150px", minWidth: 0 }}>
                <input
                  type="text"
                  placeholder={t("screening.referenciaNombre")}
                  value={ref.name}
                  onChange={(e) =>
                    setAp((s) => ({
                      ...s,
                      references: s.references.map((r, j) =>
                        j === i ? { ...r, name: e.target.value } : r,
                      ),
                    }))
                  }
                  style={inputBase}
                />
              </div>
              <div style={{ flex: "1 1 130px", minWidth: 0 }}>
                <input
                  type="tel"
                  placeholder={t("screening.referenciaTelefono")}
                  value={ref.phone}
                  onChange={(e) =>
                    setAp((s) => ({
                      ...s,
                      references: s.references.map((r, j) =>
                        j === i ? { ...r, phone: e.target.value } : r,
                      ),
                    }))
                  }
                  style={inputBase}
                />
              </div>
              <div style={{ flex: "1 1 120px", minWidth: 0 }}>
                <input
                  type="text"
                  placeholder={t("screening.referenciaRelacion")}
                  value={ref.relation ?? ""}
                  onChange={(e) =>
                    setAp((s) => ({
                      ...s,
                      references: s.references.map((r, j) =>
                        j === i ? { ...r, relation: e.target.value || null } : r,
                      ),
                    }))
                  }
                  style={inputBase}
                />
              </div>
              <Boton
                tono="peligro"
                pequeno
                onClick={() =>
                  setAp((s) => ({ ...s, references: s.references.filter((_, j) => j !== i) }))
                }
              >
                <Trash2 size={12} aria-hidden="true" />
              </Boton>
            </div>
          ))}
        </div>
      </div>

      <Campo label={t("screening.notas")} htmlFor="rs-notas">
        <textarea
          id="rs-notas"
          value={ap.notes ?? ""}
          maxLength={1000}
          onChange={(e) => setAp((s) => ({ ...s, notes: e.target.value || null }))}
          style={areaBase}
        />
      </Campo>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Pasos 2-4 — AUTORIZACIÓN, SOLICITUD y RESULTADO
   ═══════════════════════════════════════════════════════════════════════ */

function DetalleModal({
  solicitud,
  t,
  timeZone,
  accountName,
  onCerrar,
  onCambio,
}: {
  solicitud: RealtyScreeningDTO | null;
  t: (k: string, v?: Record<string, string | number>) => string;
  timeZone: string;
  accountName: string;
  onCerrar: () => void;
  onCambio: () => void | Promise<void>;
}) {
  const [nombreConsent, setNombreConsent] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resultado (proveedor manual: lo sube una persona)
  const [resultUrl, setResultUrl] = useState("");
  const [resumen, setResumen] = useState("");
  const [riesgo, setRiesgo] = useState<RealtyScreeningRiskLevel>("SIN_DATO");
  const [dictamen, setDictamen] = useState<RealtyScreeningRecommendation>("SIN_DICTAMEN");

  useEffect(() => {
    setNombreConsent("");
    setError(null);
    setResultUrl(solicitud?.resultUrl ?? "");
    setResumen(solicitud?.resultSummary ?? "");
    setRiesgo(solicitud?.riskLevel ?? "SIN_DATO");
    setDictamen(solicitud?.recommendation ?? "SIN_DICTAMEN");
  }, [solicitud]);

  if (!solicitud) return null;

  const textoConsentimiento = buildRealtyScreeningConsentText(solicitud.tier, accountName);
  const urlMala = resultUrl.trim().length > 0 && !/^https:\/\//i.test(resultUrl.trim());

  const patch = async (json: Record<string, unknown>) => {
    setTrabajando(true);
    setError(null);
    const r = await apiJson(`/api/realty/screening/${solicitud.id}`, { method: "PATCH", json });
    setTrabajando(false);
    if (!r.ok) {
      setError(r.error ?? t("errores.red"));
      return false;
    }
    await onCambio();
    return true;
  };

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={solicitud.contactName}
      cerrarLabel={t("comun.cerrar")}
      ancho={700}
    >
      {error && <Aviso tono="malo">{error}</Aviso>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Pastilla tono={solicitud.status === "LISTA" ? "bueno" : "info"}>
          {REALTY_SCREENING_STATUS_LABELS[solicitud.status]}
        </Pastilla>
        <Pastilla>{REALTY_SCREENING_TIER_LABELS[solicitud.tier]}</Pastilla>
        {solicitud.priceMxn != null && <Pastilla>{pesos(solicitud.priceMxn)}</Pastilla>}
        {solicitud.providerRef && <Pastilla>{solicitud.providerRef}</Pastilla>}
      </div>

      {/* ── PASO 2 — AUTORIZACIÓN ─────────────────────────────────────── */}
      {solicitud.status === "PENDIENTE_CONSENTIMIENTO" && (
        <>
          <Aviso tono="malo">{t("screening.consentimiento.aviso")}</Aviso>
          <Aviso tono="info">{t("screening.consentimiento.leer")}</Aviso>
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: "var(--bg)",
              border: "1px solid var(--border-strong)",
              fontSize: 12.5,
              lineHeight: 1.7,
              color: "var(--text-1)",
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {textoConsentimiento}
          </div>
          <Campo label={t("screening.consentimiento.escribeNombre")} htmlFor="rs-consent">
            <input
              id="rs-consent"
              type="text"
              autoComplete="off"
              value={nombreConsent}
              onChange={(e) => setNombreConsent(e.target.value)}
              style={inputBase}
            />
          </Campo>
          <Boton
            tono="primario"
            disabled={trabajando || nombreConsent.trim().length < 5}
            onClick={() => void patch({ action: "consent", consentName: nombreConsent.trim() })}
          >
            <ShieldCheck size={13} aria-hidden="true" />
            {trabajando ? t("screening.consentimiento.autorizando") : t("screening.consentimiento.autorizar")}
          </Boton>
        </>
      )}

      {solicitud.consentAt && (
        <Aviso tono="bueno">
          {t("screening.consentimiento.autorizado", {
            fecha: fechaHora(solicitud.consentAt, timeZone),
          })}
          {solicitud.consentName ? ` — ${solicitud.consentName}` : ""}
        </Aviso>
      )}

      {/* ── PASO 3 — SOLICITUD ────────────────────────────────────────── */}
      {solicitud.status === "SOLICITADA" && (
        <>
          <Aviso tono="info">{t("screening.manualAviso")}</Aviso>
          <Boton
            tono="primario"
            disabled={trabajando}
            onClick={() => void patch({ action: "submit" })}
          >
            {trabajando ? t("screening.solicitando") : t("screening.solicitar")}
          </Boton>
        </>
      )}

      {/* ── PASO 4 — RESULTADO ────────────────────────────────────────── */}
      {(solicitud.status === "EN_PROCESO" || solicitud.status === "LISTA") && (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            display: "flex",
            flexDirection: "column",
            gap: 13,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
            {solicitud.status === "LISTA"
              ? t("screening.resultado.title")
              : t("screening.resultado.subir")}
          </div>

          <Campo
            label={t("screening.resultado.liga")}
            hint={t("screening.resultado.ligaHint")}
            error={urlMala ? t("screening.resultado.ligaNoHttps") : null}
            htmlFor="rs-res-url"
          >
            <input
              id="rs-res-url"
              type="url"
              placeholder="https://..."
              value={resultUrl}
              onChange={(e) => setResultUrl(e.target.value)}
              style={inputBase}
            />
          </Campo>

          <Campo label={t("screening.resultado.resumen")} htmlFor="rs-res-sum">
            <textarea
              id="rs-res-sum"
              value={resumen}
              maxLength={4000}
              onChange={(e) => setResumen(e.target.value)}
              style={areaBase}
            />
          </Campo>

          <Rejilla min={190}>
            <Campo label={t("screening.resultado.riesgo")} htmlFor="rs-res-riesgo">
              <select
                id="rs-res-riesgo"
                value={riesgo}
                onChange={(e) => setRiesgo(e.target.value as RealtyScreeningRiskLevel)}
                style={inputBase}
              >
                {RIESGOS.map((r) => (
                  <option key={r} value={r}>
                    {t(`screening.riesgos.${r}`)}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label={t("screening.resultado.dictamen")} htmlFor="rs-res-dict">
              <select
                id="rs-res-dict"
                value={dictamen}
                onChange={(e) => setDictamen(e.target.value as RealtyScreeningRecommendation)}
                style={inputBase}
              >
                {DICTAMENES.map((d) => (
                  <option key={d} value={d}>
                    {REALTY_SCREENING_RECOMMENDATION_LABELS[d]}
                  </option>
                ))}
              </select>
            </Campo>
          </Rejilla>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Boton
              tono="primario"
              disabled={trabajando || urlMala}
              onClick={() =>
                void patch({
                  action: "result",
                  resultUrl: resultUrl.trim(),
                  resultSummary: resumen.trim(),
                  riskLevel: riesgo,
                  recommendation: dictamen,
                })
              }
            >
              <Upload size={13} aria-hidden="true" />
              {t("screening.resultado.guardar")}
            </Boton>
            {solicitud.resultUrl && (
              <a
                href={solicitud.resultUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 36,
                  padding: "0 15px",
                  borderRadius: 10,
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg-elev-2)",
                  color: "var(--text-1)",
                  fontSize: 13,
                  fontWeight: 650,
                  textDecoration: "none",
                }}
              >
                {t("screening.resultado.verReporte")}
              </a>
            )}
          </div>

          {solicitud.deliveredAt && (
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-4)" }}>
              {t("screening.resultado.entregado")} {fechaHora(solicitud.deliveredAt, timeZone)}
            </p>
          )}
        </div>
      )}

      {/* Cancelar — una LISTA no se cancela: ya se entregó y se pagó. */}
      {solicitud.status !== "LISTA" && solicitud.status !== "CANCELADA" && (
        <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 13 }}>
          <p style={{ margin: "0 0 9px", fontSize: 11.5, color: "var(--text-4)" }}>
            {t("screening.cancelarConfirm")}
          </p>
          <Boton
            tono="peligro"
            pequeno
            disabled={trabajando}
            onClick={async () => {
              setTrabajando(true);
              setError(null);
              const r = await apiJson(`/api/realty/screening/${solicitud.id}`, {
                method: "DELETE",
              });
              setTrabajando(false);
              if (!r.ok) {
                setError(r.error ?? t("errores.red"));
                return;
              }
              await onCambio();
              onCerrar();
            }}
          >
            <Trash2 size={12} aria-hidden="true" />
            {t("screening.cancelar")}
          </Boton>
        </div>
      )}
    </Modal>
  );
}
