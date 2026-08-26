"use client";

// ═══════════════════════════════════════════════════════════════════════
// A — PUBLICAR EN LA BOLSA.
//
// El interruptor de "compartir en la bolsa" con lo que de verdad se
// negocia: CUÁNTO DE LA COMISIÓN SE COMPARTE (es lo primero que otro asesor
// mira, así que va arriba y en grande), las condiciones de colaboración y
// qué campos se enseñan.
//
// 🔴 LOS CAMPOS SON UNA LISTA BLANCA QUE SOLO SE PUEDE RECORTAR. Lo que se
// pinta aquí es REALTY_MLS_PUBLIC_FIELDS entera; quitar es posible, agregar
// no existe. El servidor vuelve a sanear lo que llegue
// (`sanitizeExposedFields`), así que esta pantalla es comodidad, no
// seguridad: quien mande "internalNotes" a mano se lo descartan en
// silencio.
//
// Apagar el interruptor retira la ficha de la bolsa de TODAS las cuentas en
// la siguiente consulta. Sin caché, sin trabajo diferido, sin nada que
// pueda quedarse atrás.
// ═══════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Handshake,
  Loader2,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { REALTY_OPERATION_LABELS } from "@/lib/realty/types";
import {
  REALTY_MLS_PUBLIC_FIELDS,
  REALTY_MLS_REQUIRED_FIELDS,
  type RealtyMlsField,
  type RealtyMlsMineDTO,
} from "@/components/realty/mls/mls-contract";
import {
  Aviso,
  Boton,
  Campo,
  Chip,
  ComisionChip,
  Interruptor,
  Modal,
  Rejilla,
  Selector,
  Tarjeta,
  Texto,
  AreaTexto,
  Vacio,
  fechaCorta,
  money,
} from "@/components/realty/mls/mls-ui";

type CarteraItem = { id: string; title: string; city: string | null; compartido: boolean };

type Borrador = {
  propertyId: string;
  pct: string;
  acepta: boolean;
  exige: boolean;
  campos: Set<RealtyMlsField>;
  notas: string;
  /** true cuando se está editando algo que YA está compartido. */
  editando: boolean;
};

export function CompartirTab({
  dict,
  timezone,
  puedeEditar,
  onCambio,
}: {
  dict: Dictionary;
  timezone: string;
  /** false cuando falta properties.edit: se ve la lista, no se toca. */
  puedeEditar: boolean;
  onCambio: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [compartidos, setCompartidos] = useState<RealtyMlsMineDTO[]>([]);
  const [cartera, setCartera] = useState<CarteraItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/mls/listings", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      setCompartidos((json.compartidos ?? []) as RealtyMlsMineDTO[]);
      setCartera((json.cartera ?? []) as CarteraItem[]);
    } catch {
      setError(t("acciones.error"));
    } finally {
      setCargando(false);
    }
  }, [t]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function abrirNuevo() {
    const libre = cartera.find((c) => !c.compartido) ?? cartera[0];
    setBorrador({
      propertyId: libre?.id ?? "",
      pct: "50",
      acepta: true,
      exige: false,
      campos: new Set(REALTY_MLS_PUBLIC_FIELDS),
      notas: "",
      editando: false,
    });
  }

  function abrirEdicion(row: RealtyMlsMineDTO) {
    setBorrador({
      propertyId: row.propertyId,
      pct: String(row.comisionCompartida),
      acepta: row.aceptaColaboracion,
      exige: row.exigeClienteDelSocio,
      campos: new Set(row.campos),
      notas: row.recado ?? "",
      editando: true,
    });
  }

  async function guardar() {
    if (!borrador || !borrador.propertyId) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/mls/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: borrador.propertyId,
          sharedCommissionPct: Number(borrador.pct || 0),
          acceptsCollaboration: borrador.acepta,
          requiresBuyerFromPartner: borrador.exige,
          exposedFields: Array.from(borrador.campos),
          notes: borrador.notas.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      setBorrador(null);
      setFlash(t("acciones.guardado"));
      await cargar();
      onCambio();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setGuardando(false);
    }
  }

  async function alternar(row: RealtyMlsMineDTO) {
    setError(null);
    try {
      const res = await fetch(`/api/realty/mls/listings/${row.listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : t("acciones.error"));
        return;
      }
      setFlash(row.active ? t("compartir.retirado") : t("acciones.guardado"));
      await cargar();
      onCambio();
    } catch {
      setError(t("acciones.error"));
    }
  }

  const sinCartera = cartera.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tarjeta
        titulo={t("compartir.title")}
        sub={t("compartir.subtitle")}
        padded={false}
        accion={
          puedeEditar && !sinCartera ? (
            <Boton variante="primario" onClick={abrirNuevo}>
              <Plus size={14} />
              {t("compartir.agregar")}
            </Boton>
          ) : undefined
        }
      >
        {cargando ? (
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
        ) : compartidos.length === 0 ? (
          sinCartera ? (
            <Vacio
              icono={<Building2 size={26} />}
              titulo={t("compartir.carteraVaciaTitle")}
              cuerpo={t("compartir.carteraVaciaBody")}
              accion={
                <a href="/inmobiliaria/inmuebles" style={{ textDecoration: "none" }}>
                  <Boton>{t("compartir.carteraVaciaCta")}</Boton>
                </a>
              }
            />
          ) : (
            <Vacio
              icono={<Handshake size={26} />}
              titulo={t("compartir.vacioTitle")}
              cuerpo={t("compartir.vacioBody")}
              accion={
                puedeEditar ? (
                  <Boton variante="primario" onClick={abrirNuevo}>
                    <Plus size={14} />
                    {t("compartir.agregar")}
                  </Boton>
                ) : undefined
              }
            />
          )
        ) : (
          <div style={{ padding: 18 }}>
            <Rejilla min={278}>
              {compartidos.map((row) => (
                <MiFichaCard
                  key={row.listingId}
                  row={row}
                  dict={dict}
                  timezone={timezone}
                  puedeEditar={puedeEditar}
                  onEditar={() => abrirEdicion(row)}
                  onAlternar={() => void alternar(row)}
                />
              ))}
            </Rejilla>
          </div>
        )}
      </Tarjeta>

      {/* Lo que el otro asesor ve — y lo que NO ve. Va en la pantalla y no
          en una ayuda escondida: es la pregunta que todo el mundo hace antes
          de compartir su primer inmueble. */}
      <Tarjeta titulo={t("privacidad.title")}>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.7 }}>
          {t("privacidad.body")}
        </p>
      </Tarjeta>

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

      {borrador ? (
        <Modal
          open
          onClose={() => setBorrador(null)}
          title={borrador.editando ? t("compartir.modalTitleEditar") : t("compartir.modalTitle")}
          ancho={640}
          pie={
            <>
              <Boton onClick={() => setBorrador(null)} disabled={guardando}>
                {t("acciones.cancelar")}
              </Boton>
              <Boton
                variante="primario"
                onClick={guardar}
                disabled={guardando || !borrador.propertyId}
              >
                {guardando
                  ? t("compartir.guardando")
                  : borrador.editando
                    ? t("compartir.guardarEditar")
                    : t("compartir.guardar")}
              </Boton>
            </>
          }
        >
          <FormCompartir
            dict={dict}
            borrador={borrador}
            cartera={cartera}
            onChange={setBorrador}
          />
        </Modal>
      ) : null}
    </div>
  );
}

// ── El formulario ──────────────────────────────────────────────────────

function FormCompartir({
  dict,
  borrador,
  cartera,
  onChange,
}: {
  dict: Dictionary;
  borrador: Borrador;
  cartera: CarteraItem[];
  onChange: (b: Borrador) => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const set = (patch: Partial<Borrador>) => onChange({ ...borrador, ...patch });

  function alternarCampo(f: RealtyMlsField) {
    // Los obligatorios no se pueden quitar: sin ellos el resultado no es una
    // ficha, es una fila en blanco que ensucia el buscador de todos.
    if (REALTY_MLS_REQUIRED_FIELDS.includes(f)) return;
    const next = new Set(borrador.campos);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    set({ campos: next });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!borrador.editando ? (
        <Campo label={t("compartir.inmueble")}>
          <Selector
            value={borrador.propertyId}
            onChange={(v) => set({ propertyId: v })}
            options={[
              ...(borrador.propertyId ? [] : [{ value: "", label: t("compartir.elegirInmueble") }]),
              ...cartera.map((c) => ({
                value: c.id,
                label: `${c.title}${c.city ? ` — ${c.city}` : ""}${
                  c.compartido ? ` ${t("compartir.yaCompartido")}` : ""
                }`,
              })),
            ]}
          />
        </Campo>
      ) : null}

      {/* 🔴 La comisión compartida va PRIMERO y con su explicación en pesos
          reales: es lo único que el otro asesor mira antes de decidir. */}
      <Campo label={t("compartir.pct")} ayuda={t("compartir.pctAyuda")}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 110 }}>
            <Texto
              value={borrador.pct}
              onChange={(v) => set({ pct: v })}
              type="number"
              min={0}
              max={100}
              step={5}
            />
          </div>
          <ComisionChip pct={Number(borrador.pct) || 0} cero={t("ficha.comparteCero")} />
        </div>
      </Campo>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Interruptor
          checked={borrador.acepta}
          onChange={(v) => set({ acepta: v })}
          label={t("compartir.aceptaColaboracion")}
          ayuda={t("compartir.aceptaColaboracionAyuda")}
        />
        <Interruptor
          checked={borrador.exige}
          onChange={(v) => set({ exige: v })}
          label={t("compartir.exigeCliente")}
          ayuda={t("compartir.exigeClienteAyuda")}
          disabled={!borrador.acepta}
        />
      </div>

      <Campo label={t("compartir.notas")} ayuda={t("compartir.notasAviso")}>
        <AreaTexto
          value={borrador.notas}
          onChange={(v) => set({ notas: v })}
          placeholder={t("compartir.notasPlaceholder")}
          maxLength={400}
        />
      </Campo>

      {/* ── Los campos ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
            {t("compartir.campos")}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => set({ campos: new Set(REALTY_MLS_PUBLIC_FIELDS) })}
              style={MINI_BTN}
            >
              {t("compartir.camposTodos")}
            </button>
            <button
              type="button"
              onClick={() => set({ campos: new Set(REALTY_MLS_REQUIRED_FIELDS) })}
              style={MINI_BTN}
            >
              {t("compartir.camposMinimos")}
            </button>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55 }}>
          {t("compartir.camposAyuda")}
        </p>
        <div
          style={{
            display: "grid",
            gap: 6,
            gridTemplateColumns: "repeat(auto-fill, minmax(min(150px, 100%), 1fr))",
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--border-soft)",
            background: "var(--bg-elev-2)",
          }}
        >
          {REALTY_MLS_PUBLIC_FIELDS.map((f) => {
            const obligatorio = REALTY_MLS_REQUIRED_FIELDS.includes(f);
            const on = borrador.campos.has(f) || obligatorio;
            return (
              <label
                key={f}
                title={obligatorio ? t("compartir.campoObligatorio") : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 12,
                  color: obligatorio ? "var(--text-3)" : "var(--text-1)",
                  cursor: obligatorio ? "default" : "pointer",
                  minWidth: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={obligatorio}
                  onChange={() => alternarCampo(f)}
                  style={{ width: 14, height: 14, accentColor: "var(--brand)", flexShrink: 0 }}
                />
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {t(`compartir.camposLabels.${f}`)}
                </span>
              </label>
            );
          })}
        </div>
        {borrador.campos.has("direccion") || borrador.campos.has("lat") ? (
          <Aviso tono="neutro" icono={<Eye size={13} />}>
            {t("compartir.direccionAviso")}
          </Aviso>
        ) : null}
      </div>
    </div>
  );
}

// ── La tarjeta de lo que comparto ──────────────────────────────────────

function MiFichaCard({
  row,
  dict,
  timezone,
  puedeEditar,
  onEditar,
  onAlternar,
}: {
  row: RealtyMlsMineDTO;
  dict: Dictionary;
  timezone: string;
  puedeEditar: boolean;
  onEditar: () => void;
  onAlternar: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 14,
        overflow: "hidden",
        opacity: row.active ? 1 : 0.72,
      }}
    >
      <div style={{ display: "flex", gap: 11, padding: 12 }}>
        {row.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.coverUrl}
            alt=""
            width={66}
            height={66}
            style={{ borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 66,
              height: 66,
              borderRadius: 10,
              background: "var(--bg-elev-2)",
              color: "var(--text-4)",
              flexShrink: 0,
            }}
          >
            <Building2 size={20} />
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--text-1)",
              lineHeight: 1.35,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {row.titulo}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
            {money(row.precio, row.moneda)} ·{" "}
            {REALTY_OPERATION_LABELS[row.operation] ?? row.operation}
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <ComisionChip pct={row.comisionCompartida} cero={t("ficha.comparteCero")} />
            <Chip tono={row.active ? "ok" : "neutro"}>
              {row.active ? t("compartir.estadoActivo") : t("compartir.estadoInactivo")}
            </Chip>
          </div>
        </div>
      </div>

      {/* El pulso: sin esto, compartir es un acto a ciegas. */}
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "9px 12px",
          borderTop: "1px solid var(--border-soft)",
          fontSize: 11.5,
          color: "var(--text-3)",
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Globe size={12} />
          {row.adopciones === 0
            ? t("compartir.pulso.adopcionesCero")
            : row.adopciones === 1
              ? t("compartir.pulso.adopcionesUno")
              : t("compartir.pulso.adopciones", { n: row.adopciones })}
        </span>
        {row.acuerdosPendientes > 0 ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "var(--brand)",
              fontWeight: 600,
            }}
          >
            <Users size={12} />
            {row.acuerdosPendientes === 1
              ? t("compartir.pulso.pendientesUno")
              : t("compartir.pulso.pendientes", { n: row.acuerdosPendientes })}
          </span>
        ) : null}
        {row.acuerdosActivos > 0 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Handshake size={12} />
            {row.acuerdosActivos === 1
              ? t("compartir.pulso.activosUno")
              : t("compartir.pulso.activos", { n: row.acuerdosActivos })}
          </span>
        ) : null}
      </div>

      {puedeEditar ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 12px",
            borderTop: "1px solid var(--border-soft)",
            flexWrap: "wrap",
          }}
        >
          <Boton onClick={onEditar}>{t("compartir.editar")}</Boton>
          <Boton
            onClick={onAlternar}
            variante={row.active ? "peligro" : "ghost"}
            title={row.active ? t("compartir.retirarConfirm") : undefined}
          >
            {row.active ? <EyeOff size={13} /> : <Eye size={13} />}
            {row.active ? t("compartir.retirar") : t("compartir.reactivar")}
          </Boton>
        </div>
      ) : null}

      <div style={{ padding: "0 12px 10px", fontSize: 10.5, color: "var(--text-4)" }}>
        {fechaCorta(row.compartidoEn, timezone)}
      </div>
    </article>
  );
}

const MINI_BTN: React.CSSProperties = {
  padding: "4px 9px",
  borderRadius: 7,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)",
  color: "var(--text-2)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};
