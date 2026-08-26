"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/campanas — la consola de crecimiento del vertical.
//
// Cuatro pestañas, y la última está aquí por una razón de allowlist que
// conviene dejar escrita: la investigación de inquilino NACE en la ficha del
// contacto o del contrato ("Investigar a este prospecto"), no en una lista.
// Esas pantallas son de otras terminales; el botón que las engancha existe
// (screening-launcher.tsx) y son tres líneas de import. Mientras nadie lo
// monte ahí, esta pestaña es su casa: una función que no se puede abrir no
// existe.
//
// 🔴 LO QUE ESTA PANTALLA NUNCA DEBE DEJAR PASAR:
//   · Un envío que sea un salto de fe. Antes de crear se ve la VISTA PREVIA
//     con a quién SÍ, a quién NO y POR QUÉ. Enseñar el motivo es lo que hace
//     que alguien crea que el tope y la baja se aplican, en vez de sospechar
//     que no.
//   · Reactivar una baja de un clic. Volver a mandarle a quien pidió que lo
//     dejaran en paz pide confirmación expresa Y el motivo escrito.
//   · Una liga de reseñas que no sea de Google. Esa liga sale desde el
//     número de WhatsApp DEL CLIENTE.
//
// El envío es por TANDAS y el botón lo dice: "quedan N". No es una
// limitación técnica, es el diseño — 400 WhatsApps en una tarde es un número
// restringido por Meta, y el número es del cliente.
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Plus, RefreshCw, Send, Star, TrendingDown, Trash2 } from "lucide-react";
import {
  REALTY_CAMPAIGN_DAILY_CAP_MAX,
  REALTY_CAMPAIGN_DAILY_CAP_MIN,
  REALTY_CAMPAIGN_KINDS,
  REALTY_CAMPAIGN_KIND_HELP,
  REALTY_CAMPAIGN_KIND_LABELS,
  REALTY_CAMPAIGN_STATUS_LABELS,
  REALTY_OPT_OUT_LINE,
  REALTY_SKIP_LABELS,
  hasRealtyOptOutLine,
  isRealtyGoogleReviewUrl,
  type RealtyCampaignDTO,
  type RealtyCampaignKind,
  type RealtyCampaignSegment,
  type RealtyGrowthSettingsDTO,
  type RealtyOptOutDTO,
  type RealtyRecipientSkipReason,
} from "./growth-shared";
import {
  REALTY_CREDIT_KIND_LABELS,
  REALTY_LEAD_FLOW,
  REALTY_LEAD_STAGE_UI,
  REALTY_OPERATION_LABELS,
  type RealtyCreditKind,
  type RealtyLeadStage,
  type RealtyOperation,
} from "@/lib/realty/types";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { Dictionary } from "@/i18n/t";
import { RealtyScreeningPanel } from "./screening-panel";
import {
  Aviso,
  Boton,
  Campo,
  Cifra,
  Encabezado,
  Interruptor,
  Modal,
  Pastilla,
  Pestanas,
  Rejilla,
  TablaScroll,
  Tarjeta,
  Vacio,
  apiJson,
  areaBase,
  fechaHora,
  inputBase,
  td,
  th,
} from "./growth-ui";

type Tab = "campanas" | "bajas" | "resenas" | "investigacion";

interface AudienciaPrevia {
  eligible: { contactId: string; name: string | null; phone: string; propertyTitle: string | null }[];
  skipped: { name: string | null; phone: string; reason: RealtyRecipientSkipReason }[];
  counts: { eligible: number; skipped: number; remainingToday: number; dailyCap: number };
}

export function RealtyCampanasScreen({
  dict,
  timeZone,
  accountName,
  puedeEnviar,
}: {
  dict: Dictionary;
  timeZone: string;
  accountName: string;
  /** whatsapp.send. Sin él se ve todo, pero no sale nada. */
  puedeEnviar: boolean;
}) {
  // Convención B: el servidor ya recortó el sub-árbol → prefijo VACÍO.
  // `t` es una función nueva por render: NUNCA va en deps de un efecto.
  const t = makeRealtyT(dict);

  const [tab, setTab] = useState<Tab>("campanas");
  const [campanas, setCampanas] = useState<RealtyCampaignDTO[]>([]);
  const [optOuts, setOptOuts] = useState<RealtyOptOutDTO[]>([]);
  const [ajustes, setAjustes] = useState<RealtyGrowthSettingsDTO | null>(null);
  const [faltaSql, setFaltaSql] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  const recargar = useCallback(async () => {
    const [c, o, s] = await Promise.all([
      apiJson<{ campaigns: RealtyCampaignDTO[] }>("/api/realty/campaigns"),
      apiJson<{ optOuts: RealtyOptOutDTO[]; storageReady: boolean }>(
        "/api/realty/campaigns/optouts",
      ),
      apiJson<{ settings: RealtyGrowthSettingsDTO; storageReady: boolean }>(
        "/api/realty/campaigns/settings",
      ),
    ]);
    if (c.ok && c.data) setCampanas(c.data.campaigns ?? []);
    if (o.ok && o.data) setOptOuts(o.data.optOuts ?? []);
    if (s.ok && s.data) {
      setAjustes(s.data.settings ?? null);
      setFaltaSql(s.data.storageReady === false);
    }
    // Solo se grita si NINGUNA respondió: una sola caída no debe tapar la
    // pantalla entera.
    if (!c.ok && !o.ok && !s.ok) setError(c.error ?? t("errores.red"));
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  useEffect(() => {
    if (!nota) return undefined;
    const id = setTimeout(() => setNota(null), 4000);
    return () => clearTimeout(id);
  }, [nota]);

  const tabs = useMemo(
    () => [
      { key: "campanas" as Tab, label: t("campanas.tabs.campanas") },
      { key: "bajas" as Tab, label: t("campanas.tabs.bajas") },
      { key: "resenas" as Tab, label: t("campanas.tabs.resenas") },
      { key: "investigacion" as Tab, label: t("campanas.tabs.investigacion") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dict],
  );

  return (
    <div className="realty-page">
      <Encabezado titulo={t("campanas.title")} sub={t("campanas.subtitle")} />

      {faltaSql && <Aviso tono="alerta">{t("errores.faltaSql")}</Aviso>}
      {error && <Aviso tono="malo">{error}</Aviso>}
      {nota && <Aviso tono="bueno">{nota}</Aviso>}

      <Pestanas valor={tab} onChange={setTab} opciones={tabs} />

      {tab === "campanas" && (
        <>
          <Tarjeta
            titulo={t("campanas.lista.title")}
            accion={
              <Boton
                tono="primario"
                pequeno
                disabled={!puedeEnviar || faltaSql}
                onClick={() => setCreando(true)}
              >
                <Plus size={13} aria-hidden="true" />
                {t("campanas.lista.nueva")}
              </Boton>
            }
          >
            {cargando ? (
              <Vacio texto={t("comun.cargando")} />
            ) : campanas.length === 0 ? (
              <Vacio texto={t("campanas.lista.vacio")} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {campanas.map((c) => (
                  <CampanaFila
                    key={c.id}
                    campana={c}
                    t={t}
                    timeZone={timeZone}
                    puedeEnviar={puedeEnviar}
                    onCambio={recargar}
                    onNota={setNota}
                    onError={setError}
                  />
                ))}
              </div>
            )}
          </Tarjeta>

          <AjustesEnvio
            t={t}
            ajustes={ajustes}
            puedeEnviar={puedeEnviar}
            faltaSql={faltaSql}
            onGuardado={(s) => {
              setAjustes(s);
              setNota(t("comun.guardado"));
            }}
            onError={setError}
            onNota={setNota}
            onCampanas={recargar}
          />
        </>
      )}

      {tab === "bajas" && (
        <BajasTab
          t={t}
          optOuts={optOuts}
          cargando={cargando}
          puedeEnviar={puedeEnviar}
          faltaSql={faltaSql}
          timeZone={timeZone}
          onCambio={recargar}
          onError={setError}
          onNota={setNota}
        />
      )}

      {tab === "resenas" && (
        <ResenasTab
          t={t}
          ajustes={ajustes}
          puedeEnviar={puedeEnviar}
          faltaSql={faltaSql}
          onGuardado={(s) => {
            setAjustes(s);
            setNota(t("comun.guardado"));
          }}
          onError={setError}
          onNota={setNota}
          onCampanas={recargar}
        />
      )}

      {tab === "investigacion" && (
        <RealtyScreeningPanel dict={dict} timeZone={timeZone} accountName={accountName} />
      )}

      <NuevaCampanaModal
        abierto={creando}
        t={t}
        onCerrar={() => setCreando(false)}
        onCreada={async () => {
          setCreando(false);
          setNota(t("campanas.nueva.avisoBorrador"));
          await recargar();
        }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Una campaña de la lista
   ═══════════════════════════════════════════════════════════════════════ */

function CampanaFila({
  campana,
  t,
  timeZone,
  puedeEnviar,
  onCambio,
  onNota,
  onError,
}: {
  campana: RealtyCampaignDTO;
  t: (k: string, v?: Record<string, string | number>) => string;
  timeZone: string;
  puedeEnviar: boolean;
  onCambio: () => void | Promise<void>;
  onNota: (s: string) => void;
  onError: (s: string | null) => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const c = campana.counts;
  const terminada = campana.status === "ENVIADA" || campana.status === "CANCELADA";

  return (
    <article
      style={{
        padding: 14,
        borderRadius: 13,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--text-1)" }}>
              {campana.name}
            </span>
            <Pastilla
              tono={
                campana.status === "ENVIADA"
                  ? "bueno"
                  : campana.status === "CANCELADA"
                    ? "malo"
                    : campana.status === "ENVIANDO"
                      ? "alerta"
                      : "info"
              }
            >
              {REALTY_CAMPAIGN_STATUS_LABELS[campana.status]}
            </Pastilla>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 4 }}>
            {REALTY_CAMPAIGN_KIND_LABELS[campana.kind]}
            {campana.propertyTitle ? ` · ${campana.propertyTitle}` : ""}
            {campana.scheduledAt
              ? ` · ${t("campanas.lista.programadaPara")} ${fechaHora(campana.scheduledAt, timeZone)}`
              : ""}
          </div>
        </div>
      </header>

      {campana.body && (
        <p
          style={{
            margin: "0 0 11px",
            padding: "9px 12px",
            borderRadius: 10,
            background: "var(--bg)",
            border: "1px solid var(--border-soft)",
            fontSize: 12.5,
            color: "var(--text-2)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {campana.body}
        </p>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, marginBottom: 11 }}>
        <Dato label={t("campanas.lista.destinatarios")} valor={c.total} />
        <Dato label={t("campanas.lista.enviados")} valor={c.enviado} />
        <Dato label={t("campanas.lista.pendientes")} valor={c.pendiente} />
        <Dato label={t("campanas.lista.omitidos")} valor={c.omitido} />
        <Dato label={t("campanas.lista.fallidos")} valor={c.fallido} tono={c.fallido > 0} />
      </div>

      <footer style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Boton
          tono="primario"
          pequeno
          disabled={!puedeEnviar || enviando || terminada || c.pendiente === 0}
          onClick={async () => {
            setEnviando(true);
            onError(null);
            const r = await apiJson<{
              sent: number;
              failed: number;
              skipped: number;
              remainingPending: number;
              stoppedBy: string | null;
            }>(`/api/realty/campaigns/${campana.id}`, { method: "POST", json: { limit: 30 } });
            setEnviando(false);
            if (!r.ok) {
              onError(r.error ?? t("errores.red"));
              return;
            }
            const quedan = r.data?.remainingPending ?? 0;
            onNota(
              quedan > 0
                ? t("campanas.lista.quedan", { n: quedan })
                : t("campanas.lista.terminada"),
            );
            await onCambio();
          }}
        >
          <Send size={12} aria-hidden="true" />
          {enviando ? t("campanas.lista.enviando") : t("campanas.lista.enviar")}
        </Boton>
        {!terminada && (
          <Boton
            tono="peligro"
            pequeno
            disabled={!puedeEnviar}
            onClick={async () => {
              const r = await apiJson(`/api/realty/campaigns/${campana.id}`, { method: "DELETE" });
              if (!r.ok) {
                onError(r.error ?? t("errores.red"));
                return;
              }
              await onCambio();
            }}
          >
            <Trash2 size={12} aria-hidden="true" />
            {t("campanas.lista.cancelar")}
          </Boton>
        )}
      </footer>
    </article>
  );
}

function Dato({ label, valor, tono }: { label: string; valor: number; tono?: boolean }) {
  return (
    <span style={{ color: "var(--text-4)" }}>
      <strong style={{ color: tono ? "var(--danger)" : "var(--text-1)", fontWeight: 700 }}>
        {valor}
      </strong>{" "}
      {label}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Nueva campaña — con vista previa OBLIGATORIA antes de crear
   ═══════════════════════════════════════════════════════════════════════ */

function NuevaCampanaModal({
  abierto,
  t,
  onCerrar,
  onCreada,
}: {
  abierto: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
  onCerrar: () => void;
  onCreada: () => void | Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [kind, setKind] = useState<RealtyCampaignKind>("MANUAL");
  const [cuerpo, setCuerpo] = useState("");
  const [cuando, setCuando] = useState("");
  const [colderThanDays, setColder] = useState<string>("30");
  const [stages, setStages] = useState<RealtyLeadStage[]>([]);
  const [zonas, setZonas] = useState("");
  const [operation, setOperation] = useState<RealtyOperation | "">("");
  const [creditKind, setCredit] = useState<RealtyCreditKind | "">("");
  const [presupuestoMin, setMin] = useState("");
  const [presupuestoMax, setMax] = useState("");
  const [previa, setPrevia] = useState<AudienciaPrevia | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El modal se reusa: al abrirlo otra vez no puede quedar lo de la anterior.
  useEffect(() => {
    if (!abierto) return;
    setNombre("");
    setKind("MANUAL");
    setCuerpo("");
    setCuando("");
    setColder("30");
    setStages([]);
    setZonas("");
    setOperation("");
    setCredit("");
    setMin("");
    setMax("");
    setPrevia(null);
    setError(null);
  }, [abierto]);

  const segment = useMemo((): RealtyCampaignSegment => {
    const n = Number(colderThanDays);
    return {
      colderThanDays: kind === "REACTIVACION" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
      stages,
      zones: zonas
        .split(",")
        .map((z) => z.trim())
        .filter(Boolean),
      operation: operation || null,
      creditKind: creditKind || null,
      budgetMin: presupuestoMin ? Number(presupuestoMin) : null,
      budgetMax: presupuestoMax ? Number(presupuestoMax) : null,
    };
  }, [kind, colderThanDays, stages, zonas, operation, creditKind, presupuestoMin, presupuestoMax]);

  // Cambiar los filtros invalida la vista previa: dejarla puesta enseñaría
  // un número que ya no corresponde a lo que se va a crear.
  useEffect(() => {
    setPrevia(null);
  }, [segment]);

  // Si el cuerpo no trae salida, el servidor le pega la línea de baja. Se
  // avisa aquí para que no sea una sorpresa en el mensaje que ya salió.
  const faltaLineaDeBaja = Boolean(cuerpo.trim()) && !hasRealtyOptOutLine(cuerpo);

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={t("campanas.nueva.title")}
      cerrarLabel={t("comun.cerrar")}
      ancho={720}
      pie={
        <>
          <Boton tono="fantasma" onClick={onCerrar}>
            {t("comun.cancelar")}
          </Boton>
          <Boton
            disabled={calculando}
            onClick={async () => {
              setCalculando(true);
              setError(null);
              const r = await apiJson<AudienciaPrevia>("/api/realty/campaigns/audience", {
                method: "POST",
                json: { kind, segment },
              });
              setCalculando(false);
              if (!r.ok) {
                setError(r.error ?? t("errores.red"));
                return;
              }
              setPrevia(r.data);
            }}
          >
            {calculando ? t("campanas.nueva.calculando") : t("campanas.nueva.previa")}
          </Boton>
          <Boton
            tono="primario"
            disabled={guardando || nombre.trim().length < 3 || cuerpo.trim().length < 10}
            onClick={async () => {
              setGuardando(true);
              setError(null);
              const r = await apiJson("/api/realty/campaigns", {
                method: "POST",
                json: {
                  name: nombre.trim(),
                  kind,
                  body: cuerpo.trim(),
                  segment,
                  scheduledAt: cuando ? new Date(cuando).toISOString() : null,
                },
              });
              setGuardando(false);
              if (!r.ok) {
                setError(r.error ?? t("errores.red"));
                return;
              }
              await onCreada();
            }}
          >
            {guardando ? t("campanas.nueva.creando") : t("campanas.nueva.crear")}
          </Boton>
        </>
      }
    >
      {error && <Aviso tono="malo">{error}</Aviso>}

      <Rejilla min={230}>
        <Campo
          label={t("campanas.nueva.nombre")}
          hint={t("campanas.nueva.nombreHint")}
          htmlFor="rc-nombre"
        >
          <input
            id="rc-nombre"
            type="text"
            value={nombre}
            maxLength={80}
            onChange={(e) => setNombre(e.target.value)}
            style={inputBase}
          />
        </Campo>
        <Campo label={t("campanas.nueva.tipo")} htmlFor="rc-tipo">
          <select
            id="rc-tipo"
            value={kind}
            onChange={(e) => setKind(e.target.value as RealtyCampaignKind)}
            style={inputBase}
          >
            {REALTY_CAMPAIGN_KINDS.map((k) => (
              <option key={k} value={k}>
                {REALTY_CAMPAIGN_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Campo>
      </Rejilla>

      <Aviso tono="info">{REALTY_CAMPAIGN_KIND_HELP[kind]}</Aviso>

      <Campo
        label={t("campanas.nueva.mensaje")}
        hint={t("campanas.nueva.mensajeHint")}
        htmlFor="rc-cuerpo"
      >
        <textarea
          id="rc-cuerpo"
          value={cuerpo}
          maxLength={900}
          onChange={(e) => setCuerpo(e.target.value)}
          style={areaBase}
        />
      </Campo>
      {faltaLineaDeBaja && <Aviso tono="info">{REALTY_OPT_OUT_LINE}</Aviso>}

      {/* ── Filtros ─────────────────────────────────────────────────── */}
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
          {t("campanas.nueva.filtros")}
        </div>

        {kind === "REACTIVACION" && (
          <Campo label={t("campanas.nueva.friosDias")} htmlFor="rc-frios">
            <input
              id="rc-frios"
              type="number"
              min={1}
              max={3650}
              value={colderThanDays}
              onChange={(e) => setColder(e.target.value)}
              style={inputBase}
            />
          </Campo>
        )}

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 7 }}>
            {t("campanas.nueva.etapas")}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {REALTY_LEAD_FLOW.map((s) => {
              const activo = stages.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={activo}
                  onClick={() =>
                    setStages((prev) => (activo ? prev.filter((x) => x !== s) : [...prev, s]))
                  }
                  style={{
                    padding: "5px 11px",
                    borderRadius: 999,
                    border: `1px solid ${activo ? "var(--brand)" : "var(--border-soft)"}`,
                    background: activo ? "var(--brand)" : "var(--bg)",
                    color: activo ? "#fff" : "var(--text-3)",
                    fontSize: 11.5,
                    fontWeight: 650,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {REALTY_LEAD_STAGE_UI[s].label}
                </button>
              );
            })}
          </div>
        </div>

        <Rejilla min={200}>
          <Campo
            label={t("campanas.nueva.zonas")}
            hint={t("campanas.nueva.zonasHint")}
            htmlFor="rc-zonas"
          >
            <input
              id="rc-zonas"
              type="text"
              value={zonas}
              onChange={(e) => setZonas(e.target.value)}
              style={inputBase}
            />
          </Campo>
          <Campo label={t("campanas.nueva.operacion")} htmlFor="rc-op">
            <select
              id="rc-op"
              value={operation}
              onChange={(e) => setOperation(e.target.value as RealtyOperation | "")}
              style={inputBase}
            >
              <option value="">{t("comun.ninguno")}</option>
              {(Object.keys(REALTY_OPERATION_LABELS) as RealtyOperation[]).map((o) => (
                <option key={o} value={o}>
                  {REALTY_OPERATION_LABELS[o]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label={t("campanas.nueva.credito")} htmlFor="rc-credito">
            <select
              id="rc-credito"
              value={creditKind}
              onChange={(e) => setCredit(e.target.value as RealtyCreditKind | "")}
              style={inputBase}
            >
              <option value="">{t("comun.ninguno")}</option>
              {(Object.keys(REALTY_CREDIT_KIND_LABELS) as RealtyCreditKind[]).map((k) => (
                <option key={k} value={k}>
                  {REALTY_CREDIT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label={t("campanas.nueva.presupuestoMin")} htmlFor="rc-min">
            <input
              id="rc-min"
              type="number"
              min={0}
              value={presupuestoMin}
              onChange={(e) => setMin(e.target.value)}
              style={inputBase}
            />
          </Campo>
          <Campo label={t("campanas.nueva.presupuestoMax")} htmlFor="rc-max">
            <input
              id="rc-max"
              type="number"
              min={0}
              value={presupuestoMax}
              onChange={(e) => setMax(e.target.value)}
              style={inputBase}
            />
          </Campo>
          <Campo label={t("campanas.nueva.cuando")} htmlFor="rc-cuando">
            <input
              id="rc-cuando"
              type="datetime-local"
              value={cuando}
              onChange={(e) => setCuando(e.target.value)}
              style={inputBase}
            />
          </Campo>
        </Rejilla>
      </div>

      {previa && <Previa previa={previa} t={t} />}
    </Modal>
  );
}

function Previa({
  previa,
  t,
}: {
  previa: AudienciaPrevia;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  // Agrupar los omitidos por motivo: veinte líneas de "pidió no recibir" no
  // dicen más que "20 pidieron no recibir", y sí tapan el resto.
  const porMotivo = useMemo(() => {
    const m = new Map<RealtyRecipientSkipReason, number>();
    for (const s of previa.skipped) m.set(s.reason, (m.get(s.reason) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [previa]);

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        background: "var(--bg)",
        border: "1px solid var(--border-strong)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
        {t("campanas.previa.title")}
      </div>

      {previa.counts.eligible === 0 ? (
        <Vacio texto={t("campanas.previa.vacio")} />
      ) : (
        <Rejilla min={140}>
          <Cifra
            label={t("campanas.previa.vanA")}
            valor={String(previa.counts.eligible)}
            tono="bueno"
          />
          <Cifra
            label={t("campanas.previa.seOmiten")}
            valor={String(previa.counts.skipped)}
            tono={previa.counts.skipped > 0 ? "alerta" : undefined}
          />
          {/* Lo que de verdad decide cuántos salen HOY: el tope menos lo ya
              enviado. Un "van 120" con 40 de cupo es una promesa falsa. */}
          <Cifra
            label={t("campanas.ajustes.topeDiario")}
            valor={`${previa.counts.remainingToday} / ${previa.counts.dailyCap}`}
            tono={previa.counts.remainingToday < previa.counts.eligible ? "alerta" : undefined}
          />
        </Rejilla>
      )}

      {porMotivo.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 650, color: "var(--text-4)", marginBottom: 7 }}>
            {t("campanas.previa.porQue")}
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {porMotivo.map(([motivo, n]) => (
              <Pastilla key={motivo} tono="alerta">
                {n} · {REALTY_SKIP_LABELS[motivo]}
              </Pastilla>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Ajustes de envío (tope diario + bajada de precio)
   ═══════════════════════════════════════════════════════════════════════ */

function AjustesEnvio({
  t,
  ajustes,
  puedeEnviar,
  faltaSql,
  onGuardado,
  onError,
  onNota,
  onCampanas,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  ajustes: RealtyGrowthSettingsDTO | null;
  puedeEnviar: boolean;
  faltaSql: boolean;
  onGuardado: (s: RealtyGrowthSettingsDTO) => void;
  onError: (s: string | null) => void;
  onNota: (s: string) => void;
  onCampanas: () => void | Promise<void>;
}) {
  const [cap, setCap] = useState<string>("");
  const [corriendo, setCorriendo] = useState(false);

  // El input arranca con lo guardado, y se re-sincroniza cuando llega.
  useEffect(() => {
    if (ajustes) setCap(String(ajustes.campaignDailyCap));
  }, [ajustes]);

  if (!ajustes) return null;

  const guardar = async (patch: Record<string, unknown>) => {
    onError(null);
    const r = await apiJson<{ settings: RealtyGrowthSettingsDTO }>(
      "/api/realty/campaigns/settings",
      { method: "PATCH", json: patch },
    );
    if (!r.ok || !r.data?.settings) {
      onError(r.error ?? t("errores.red"));
      return;
    }
    onGuardado(r.data.settings);
  };

  return (
    <Tarjeta titulo={t("campanas.ajustes.title")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <Campo
          label={t("campanas.ajustes.topeDiario")}
          hint={t("campanas.ajustes.topeDiarioHint")}
          htmlFor="rc-tope"
        >
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="rc-tope"
              type="number"
              min={REALTY_CAMPAIGN_DAILY_CAP_MIN}
              max={REALTY_CAMPAIGN_DAILY_CAP_MAX}
              disabled={!puedeEnviar}
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              style={inputBase}
            />
            <Boton
              disabled={!puedeEnviar || faltaSql || cap === String(ajustes.campaignDailyCap)}
              onClick={() => void guardar({ campaignDailyCap: Number(cap) })}
            >
              {t("comun.guardar")}
            </Boton>
          </div>
        </Campo>

        <Interruptor
          checked={ajustes.priceDropEnabled}
          disabled={!puedeEnviar || faltaSql}
          label={t("campanas.ajustes.bajadaPrecio")}
          hint={t("campanas.ajustes.bajadaPrecioHint")}
          onChange={(v) => void guardar({ priceDropEnabled: v })}
        />

        <div>
          <Boton
            disabled={!puedeEnviar || faltaSql || corriendo}
            onClick={async () => {
              setCorriendo(true);
              onError(null);
              const r = await apiJson<{ watched: number; drops: number; campaigns: string[] }>(
                "/api/realty/campaigns/price-drops",
                { method: "POST", json: {} },
              );
              setCorriendo(false);
              if (!r.ok) {
                onError(r.error ?? t("errores.red"));
                return;
              }
              const n = r.data?.campaigns?.length ?? 0;
              onNota(
                n > 0
                  ? t("campanas.ajustes.bajadasHechas", { n })
                  : t("campanas.ajustes.sinBajadas"),
              );
              await onCampanas();
            }}
          >
            <TrendingDown size={13} aria-hidden="true" />
            {corriendo ? t("campanas.ajustes.corriendo") : t("campanas.ajustes.correrBajadas")}
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Bajas
   ═══════════════════════════════════════════════════════════════════════ */

function BajasTab({
  t,
  optOuts,
  cargando,
  puedeEnviar,
  faltaSql,
  timeZone,
  onCambio,
  onError,
  onNota,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  optOuts: RealtyOptOutDTO[];
  cargando: boolean;
  puedeEnviar: boolean;
  faltaSql: boolean;
  timeZone: string;
  onCambio: () => void | Promise<void>;
  onError: (s: string | null) => void;
  onNota: (s: string) => void;
}) {
  const [altaAbierta, setAlta] = useState(false);
  const [telefono, setTelefono] = useState("");
  const [scope, setScope] = useState<"MARKETING" | "ALL">("MARKETING");
  const [motivo, setMotivo] = useState("");
  const [reactivando, setReactivando] = useState<RealtyOptOutDTO | null>(null);
  const [motivoReactivar, setMotivoReactivar] = useState("");

  useEffect(() => {
    if (!altaAbierta) return;
    setTelefono("");
    setScope("MARKETING");
    setMotivo("");
  }, [altaAbierta]);

  useEffect(() => {
    setMotivoReactivar("");
  }, [reactivando]);

  return (
    <Tarjeta
      titulo={t("campanas.bajas.title")}
      sub={t("campanas.bajas.sub")}
      accion={
        <Boton pequeno disabled={faltaSql} onClick={() => setAlta(true)}>
          <Ban size={13} aria-hidden="true" />
          {t("campanas.bajas.alta")}
        </Boton>
      }
    >
      {cargando ? (
        <Vacio texto={t("comun.cargando")} />
      ) : optOuts.length === 0 ? (
        <Vacio texto={t("campanas.bajas.vacio")} />
      ) : (
        <TablaScroll>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>{t("campanas.bajas.telefono")}</th>
                <th style={th}>{t("campanas.bajas.alcance")}</th>
                <th style={th}>{t("campanas.bajas.origen")}</th>
                <th style={th}>{t("campanas.bajas.desde")}</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {optOuts.map((o) => (
                <tr key={o.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 650, color: "var(--text-1)" }}>{o.phone}</div>
                    {o.contactName && (
                      <div style={{ fontSize: 11.5, color: "var(--text-4)" }}>{o.contactName}</div>
                    )}
                  </td>
                  <td style={td}>
                    <Pastilla tono={o.scope === "ALL" ? "malo" : "alerta"}>
                      {o.scope === "ALL"
                        ? t("campanas.bajas.alcanceAll")
                        : t("campanas.bajas.alcanceMarketing")}
                    </Pastilla>
                  </td>
                  <td style={td}>{t(`campanas.bajas.origen${o.source}`)}</td>
                  <td style={td}>{fechaHora(o.createdAt, timeZone)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <Boton pequeno tono="fantasma" disabled={!puedeEnviar} onClick={() => setReactivando(o)}>
                      <RefreshCw size={12} aria-hidden="true" />
                      {t("campanas.bajas.reactivar")}
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablaScroll>
      )}

      {/* Alta manual */}
      <Modal
        abierto={altaAbierta}
        onCerrar={() => setAlta(false)}
        titulo={t("campanas.bajas.alta")}
        cerrarLabel={t("comun.cerrar")}
        pie={
          <>
            <Boton tono="fantasma" onClick={() => setAlta(false)}>
              {t("comun.cancelar")}
            </Boton>
            <Boton
              tono="primario"
              disabled={telefono.replace(/\D/g, "").length < 10}
              onClick={async () => {
                const r = await apiJson("/api/realty/campaigns/optouts", {
                  method: "POST",
                  json: { phone: telefono, scope, note: motivo || null },
                });
                if (!r.ok) {
                  onError(r.error ?? t("errores.red"));
                  return;
                }
                setAlta(false);
                onNota(t("comun.guardado"));
                await onCambio();
              }}
            >
              {t("comun.guardar")}
            </Boton>
          </>
        }
      >
        <Campo label={t("campanas.bajas.telefono")} htmlFor="rc-baja-tel">
          <input
            id="rc-baja-tel"
            type="tel"
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            style={inputBase}
          />
        </Campo>
        <Campo
          label={t("campanas.bajas.alcance")}
          hint={t("campanas.bajas.alcanceMarketingHint")}
          htmlFor="rc-baja-scope"
        >
          <select
            id="rc-baja-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value === "ALL" ? "ALL" : "MARKETING")}
            style={inputBase}
          >
            <option value="MARKETING">{t("campanas.bajas.alcanceMarketing")}</option>
            <option value="ALL">{t("campanas.bajas.alcanceAll")}</option>
          </select>
        </Campo>
        <Campo label={t("campanas.bajas.motivo")} htmlFor="rc-baja-motivo">
          <input
            id="rc-baja-motivo"
            type="text"
            maxLength={300}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            style={inputBase}
          />
        </Campo>
      </Modal>

      {/* Reactivar — el peligroso */}
      <Modal
        abierto={Boolean(reactivando)}
        onCerrar={() => setReactivando(null)}
        titulo={t("campanas.bajas.reactivarTitle")}
        cerrarLabel={t("comun.cerrar")}
        pie={
          <>
            <Boton tono="fantasma" onClick={() => setReactivando(null)}>
              {t("comun.cancelar")}
            </Boton>
            <Boton
              tono="peligro"
              disabled={motivoReactivar.trim().length < 5}
              onClick={async () => {
                if (!reactivando) return;
                const r = await apiJson("/api/realty/campaigns/optouts", {
                  method: "DELETE",
                  // `confirm: true` es lo que la ruta exige; sin él contesta
                  // 428 y no reactiva a nadie.
                  json: { phone: reactivando.phone, confirm: true, note: motivoReactivar.trim() },
                });
                if (!r.ok) {
                  onError(r.error ?? t("errores.red"));
                  return;
                }
                setReactivando(null);
                onNota(t("comun.guardado"));
                await onCambio();
              }}
            >
              {t("campanas.bajas.reactivarConfirmar")}
            </Boton>
          </>
        }
      >
        <Aviso tono="malo">{t("campanas.bajas.reactivarAviso")}</Aviso>
        {reactivando && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-1)", fontWeight: 650 }}>
            {reactivando.phone}
            {reactivando.contactName ? ` · ${reactivando.contactName}` : ""}
          </p>
        )}
        <Campo label={t("campanas.bajas.reactivarMotivo")} htmlFor="rc-react-motivo">
          <textarea
            id="rc-react-motivo"
            value={motivoReactivar}
            maxLength={300}
            onChange={(e) => setMotivoReactivar(e.target.value)}
            style={areaBase}
          />
        </Campo>
      </Modal>
    </Tarjeta>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Reseñas en Google
   ═══════════════════════════════════════════════════════════════════════ */

function ResenasTab({
  t,
  ajustes,
  puedeEnviar,
  faltaSql,
  onGuardado,
  onError,
  onNota,
  onCampanas,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  ajustes: RealtyGrowthSettingsDTO | null;
  puedeEnviar: boolean;
  faltaSql: boolean;
  onGuardado: (s: RealtyGrowthSettingsDTO) => void;
  onError: (s: string | null) => void;
  onNota: (s: string) => void;
  onCampanas: () => void | Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [creando, setCreando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (ajustes) setUrl(ajustes.googleReviewUrl ?? "");
  }, [ajustes]);

  if (!ajustes) return null;

  // La MISMA lista blanca que aplica el servidor, aquí para avisar antes de
  // mandar. La de verdad es la del servidor: esta solo evita el viaje.
  const urlMala = url.trim().length > 0 && !isRealtyGoogleReviewUrl(url.trim());

  return (
    <Tarjeta titulo={t("campanas.resenas.title")} sub={t("campanas.resenas.sub")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <Campo
          label={t("campanas.resenas.liga")}
          hint={t("campanas.resenas.ligaHint")}
          error={urlMala ? t("campanas.resenas.ligaInvalida") : null}
          htmlFor="rc-google"
        >
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="rc-google"
              type="url"
              inputMode="url"
              placeholder="https://g.page/r/..."
              disabled={!puedeEnviar}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={inputBase}
            />
            <Boton
              disabled={
                !puedeEnviar ||
                faltaSql ||
                guardando ||
                urlMala ||
                url.trim() === (ajustes.googleReviewUrl ?? "")
              }
              onClick={async () => {
                setGuardando(true);
                onError(null);
                const r = await apiJson<{ settings: RealtyGrowthSettingsDTO }>(
                  "/api/realty/campaigns/settings",
                  { method: "PATCH", json: { googleReviewUrl: url.trim() || null } },
                );
                setGuardando(false);
                if (!r.ok || !r.data?.settings) {
                  onError(r.error ?? t("errores.red"));
                  return;
                }
                onGuardado(r.data.settings);
              }}
            >
              {guardando ? t("comun.guardando") : t("comun.guardar")}
            </Boton>
          </div>
        </Campo>

        <Aviso tono="info">
          <strong>{t("campanas.resenas.comoObtener")}</strong> —{" "}
          {t("campanas.resenas.comoObtenerPasos")}
        </Aviso>

        <Interruptor
          checked={ajustes.reviewsEnabled}
          disabled={!puedeEnviar || faltaSql || !ajustes.googleReviewUrl}
          label={t("campanas.resenas.activo")}
          hint={!ajustes.googleReviewUrl ? t("campanas.resenas.sinLiga") : undefined}
          onChange={async (v) => {
            onError(null);
            const r = await apiJson<{ settings: RealtyGrowthSettingsDTO }>(
              "/api/realty/campaigns/settings",
              { method: "PATCH", json: { reviewsEnabled: v } },
            );
            if (!r.ok || !r.data?.settings) {
              onError(r.error ?? t("errores.red"));
              return;
            }
            onGuardado(r.data.settings);
          }}
        />

        <div>
          <Boton
            tono="primario"
            disabled={!puedeEnviar || faltaSql || creando || !ajustes.googleReviewUrl}
            onClick={async () => {
              setCreando(true);
              onError(null);
              const r = await apiJson("/api/realty/campaigns/settings", {
                method: "POST",
                json: { withinDays: 60 },
              });
              setCreando(false);
              if (!r.ok) {
                onError(r.error ?? t("errores.red"));
                return;
              }
              onNota(t("campanas.nueva.avisoBorrador"));
              await onCampanas();
            }}
          >
            <Star size={13} aria-hidden="true" />
            {creando ? t("campanas.resenas.creando") : t("campanas.resenas.crear")}
          </Boton>
        </div>
      </div>
    </Tarjeta>
  );
}
