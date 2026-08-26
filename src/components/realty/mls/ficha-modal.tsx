"use client";

// ═══════════════════════════════════════════════════════════════════════
// LA FICHA de un inmueble AJENO, y lo que se puede hacer con ella:
// contactar al asesor, proponerle colaborar y ponerla en mi web.
//
// 🔴 TODO lo que se pinta aquí llegó ya recortado por la lista blanca del
// servidor (REALTY_MLS_PUBLIC_FIELDS). Este componente NO decide qué se
// enseña: decide cómo. Si un campo llega en null es porque su dueño no lo
// autorizó, y entonces no se pinta — jamás se rellena con un "no
// disponible" que invite a preguntar por él.
//
// El teléfono y el correo son los DEL NEGOCIO que comparte, los mismos que
// ya publica en su web. Nunca los del propietario del inmueble, que este
// módulo ni siquiera lee de la base.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import {
  Bath,
  BedDouble,
  Building2,
  Car,
  CheckCircle2,
  Globe,
  Handshake,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Ruler,
  ShieldAlert,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { normalizarTelefonoWeb } from "@/lib/realty/landing";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  realtyAmenityLabel,
} from "@/lib/realty/types";
import type { RealtyMlsListingDTO } from "@/components/realty/mls/mls-contract";
import {
  Aviso,
  Boton,
  Campo,
  Chip,
  ComisionChip,
  Modal,
  Texto,
  AreaTexto,
  fechaCorta,
  m2,
  money,
  pctText,
} from "@/components/realty/mls/mls-ui";

export function FichaModal({
  dict,
  ficha,
  timezone,
  puedeAdoptar,
  onClose,
  onCambio,
}: {
  dict: Dictionary;
  ficha: RealtyMlsListingDTO | null;
  timezone: string;
  /** false cuando el usuario no tiene web.edit: el botón no se pinta. */
  puedeAdoptar: boolean;
  onClose: () => void;
  /** Se llama tras proponer o adoptar, para que la lista se refresque. */
  onCambio: () => void;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const [proponiendo, setProponiendo] = useState(false);
  const [pct, setPct] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  // Al abrir OTRA ficha se reinicia todo: sin esto, el porcentaje tecleado
  // en la ficha anterior se quedaría escrito en la siguiente.
  useEffect(() => {
    setProponiendo(false);
    setPct(ficha ? String(ficha.comisionCompartida || 0) : "");
    setMensaje("");
    setError(null);
    setHecho(null);
  }, [ficha]);

  if (!ficha) return null;

  const ag = ficha.quienComparte;
  const tel = normalizarTelefonoWeb(ag.telefono);
  const portada = ficha.fotos[0]?.url ?? "";

  async function proponer() {
    if (!ficha) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/realty/mls/acuerdos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: ficha.listingId,
          agreedPct: pct.trim() === "" ? undefined : Number(pct),
          message: mensaje.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.code === "ALREADY"
            ? t("proponer.yaExiste")
            : typeof data.error === "string"
              ? data.error
              : t("acciones.error"),
        );
        return;
      }
      setHecho(t("proponer.listo"));
      setProponiendo(false);
      onCambio();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setGuardando(false);
    }
  }

  async function adoptar() {
    if (!ficha) return;
    setGuardando(true);
    setError(null);
    try {
      const res = ficha.adoptado
        ? null
        : await fetch("/api/realty/mls/adopciones", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listingId: ficha.listingId }),
          });
      // Quitar de la web se hace desde "Mis colaboraciones", donde está el
      // id de la adopción. Aquí solo se agrega: la ficha de la bolsa no
      // conoce ese id y pedirlo obligaría a una ruta más.
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("acciones.error"));
        return;
      }
      setHecho(t("ficha.adoptado"));
      onCambio();
    } catch {
      setError(t("acciones.error"));
    } finally {
      setGuardando(false);
    }
  }

  const datos: Array<{ icono: React.ReactNode; valor: string; label: string }> = [];
  if (ficha.recamaras) {
    datos.push({
      icono: <BedDouble size={14} />,
      valor: String(ficha.recamaras),
      label: t("ficha.recamaras"),
    });
  }
  if (ficha.banos) {
    datos.push({
      icono: <Bath size={14} />,
      valor: String(ficha.banos),
      label: t("ficha.banos"),
    });
  }
  if (ficha.cocheras) {
    datos.push({
      icono: <Car size={14} />,
      valor: String(ficha.cocheras),
      label: t("ficha.cocheras"),
    });
  }
  const construido = m2(ficha.construidoM2);
  if (construido) {
    datos.push({
      icono: <Ruler size={14} />,
      valor: construido,
      label: t("ficha.construido"),
    });
  }
  const terreno = m2(ficha.terrenoM2);
  if (terreno) {
    datos.push({ icono: <Ruler size={14} />, valor: terreno, label: t("ficha.terreno") });
  }

  const ubicacion = [ficha.direccion, ficha.colonia, ficha.ciudad, ficha.estado]
    .filter((s): s is string => !!s)
    .join(", ");

  return (
    <Modal
      open
      onClose={onClose}
      title={ficha.titulo}
      ancho={720}
      pie={
        <>
          <Boton onClick={onClose}>{t("acciones.cerrar")}</Boton>
          {puedeAdoptar && !ficha.adoptado ? (
            <Boton onClick={adoptar} disabled={guardando}>
              <Globe size={14} />
              {t("ficha.adoptar")}
            </Boton>
          ) : null}
          {ficha.aceptaColaboracion && !ficha.miAcuerdo ? (
            <Boton variante="primario" onClick={() => setProponiendo(true)} disabled={guardando}>
              <Handshake size={14} />
              {t("ficha.proponer")}
            </Boton>
          ) : null}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ── Quién lo tiene y en qué términos ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 12,
            borderRadius: 12,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            flexWrap: "wrap",
          }}
        >
          {ag.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ag.logoUrl}
              alt=""
              width={38}
              height={38}
              style={{ borderRadius: 9, objectFit: "cover", flexShrink: 0 }}
            />
          ) : (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: 9,
                background: "var(--brand-soft)",
                color: "var(--brand)",
                flexShrink: 0,
              }}
            >
              <Building2 size={18} />
            </span>
          )}
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-1)" }}>
              {ag.nombre}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {[ag.ciudad, ag.estado].filter(Boolean).join(", ") ||
                t("ficha.publicado", { fecha: fechaCorta(ficha.compartidoEn, timezone) })}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <ComisionChip pct={ficha.comisionCompartida} cero={t("ficha.comparteCero")} />
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
              {ficha.comisionCompartida > 0
                ? t("ficha.compartePct", { pct: pctText(ficha.comisionCompartida) })
                : ""}
            </div>
          </div>
        </div>

        {/* ── Portada ── */}
        {portada ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={portada}
            alt={ficha.titulo}
            style={{
              width: "100%",
              maxHeight: 300,
              objectFit: "cover",
              borderRadius: 12,
              border: "1px solid var(--border-soft)",
            }}
          />
        ) : null}

        {/* ── Precio y clasificación ── */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: "var(--text-1)", letterSpacing: "-0.02em" }}>
            {money(ficha.precio, ficha.moneda)}
          </span>
          {ficha.precioRenta ? (
            <span style={{ fontSize: 13, color: "var(--text-3)" }}>
              {money(ficha.precioRenta, ficha.moneda)}
            </span>
          ) : null}
          <Chip tono="neutro">{REALTY_PROPERTY_KIND_LABELS[ficha.kind] ?? ficha.kind}</Chip>
          <Chip tono="neutro">{REALTY_OPERATION_LABELS[ficha.operation] ?? ficha.operation}</Chip>
          <Chip tono={ficha.status === "DISPONIBLE" ? "ok" : "aviso"}>
            {t(`ficha.estado.${ficha.status}`)}
          </Chip>
          {ficha.folio ? (
            <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>
              {t("ficha.folio")} {ficha.folio}
            </span>
          ) : null}
        </div>

        {/* ── Datos duros ── */}
        {datos.length > 0 ? (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {datos.map((d, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 12.5,
                  color: "var(--text-2)",
                }}
              >
                <span style={{ color: "var(--text-4)" }}>{d.icono}</span>
                <strong style={{ fontWeight: 700, color: "var(--text-1)" }}>{d.valor}</strong>
                {d.label}
              </span>
            ))}
          </div>
        ) : null}

        {/* ── Ubicación ── */}
        {ubicacion ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                color: "var(--text-2)",
              }}
            >
              <MapPin size={14} style={{ color: "var(--text-4)" }} />
              {ubicacion}
            </span>
            {!ficha.direccion ? (
              <span style={{ fontSize: 11.5, color: "var(--text-4)", paddingLeft: 20 }}>
                {t("ficha.direccionOculta")}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* ── Descripción ── */}
        {ficha.descripcion ? (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {ficha.descripcion}
          </p>
        ) : null}

        {/* ── Amenidades ── */}
        {ficha.amenidades.length > 0 ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 6 }}>
              {t("ficha.amenidades")}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ficha.amenidades.map((a) => (
                <Chip key={a} tono="neutro">
                  {realtyAmenityLabel(a)}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── Términos de la colaboración ── */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip tono={ficha.aceptaColaboracion ? "ok" : "neutro"}>
            {ficha.aceptaColaboracion
              ? t("ficha.aceptaColaboracion")
              : t("ficha.noAceptaColaboracion")}
          </Chip>
          {ficha.exigeClienteDelSocio ? (
            <Chip tono="aviso" title={t("ficha.exigeClienteAyuda")}>
              {t("ficha.exigeCliente")}
            </Chip>
          ) : null}
          {ficha.miAcuerdo ? (
            <Chip tono={ficha.miAcuerdo === "ACEPTADO" ? "ok" : "neutro"}>
              {t(`ficha.miAcuerdo.${ficha.miAcuerdo}`)}
            </Chip>
          ) : null}
          {ficha.adoptado ? (
            <Chip tono="brand">
              <Globe size={11} />
              {t("ficha.adoptado")}
            </Chip>
          ) : null}
        </div>

        {ficha.recado ? (
          <Aviso tono="neutro" icono={<ShieldAlert size={14} />}>
            <strong style={{ display: "block", marginBottom: 2 }}>{t("ficha.recado")}</strong>
            {ficha.recado}
          </Aviso>
        ) : null}

        {/* ── Contacto ── */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginBottom: 7 }}>
            {t("ficha.contactar")}
          </div>
          {tel || ag.correo ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {tel ? (
                <>
                  <a
                    href={`https://wa.me/${tel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={LINK_BTN}
                  >
                    <MessageCircle size={14} />
                    {t("ficha.whatsapp")}
                  </a>
                  <a href={`tel:+${tel}`} style={LINK_BTN}>
                    <Phone size={14} />
                    {t("ficha.llamar")}
                  </a>
                </>
              ) : null}
              {ag.correo ? (
                <a href={`mailto:${ag.correo}`} style={LINK_BTN}>
                  <Mail size={14} />
                  {t("ficha.correo")}
                </a>
              ) : null}
              {ag.slug ? (
                <a
                  href={`/i/${ag.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={LINK_BTN}
                >
                  <Globe size={14} />
                  {t("ficha.verEnSuWeb", { agencia: ag.nombre })}
                </a>
              ) : null}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>
              {t("ficha.sinContacto")}
            </p>
          )}
        </div>

        {/* ── Proponer colaboración ── */}
        {proponiendo ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: 14,
              borderRadius: 12,
              border: "1px solid var(--border-brand)",
              background: "var(--brand-softer)",
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text-1)" }}>
                {t("proponer.title")}
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>
                {t("proponer.body", { agencia: ag.nombre })}
              </p>
            </div>
            <Campo label={t("proponer.pct")} ayuda={t("proponer.pctAyuda")}>
              <Texto value={pct} onChange={setPct} type="number" min={0} max={100} step={0.5} />
            </Campo>
            <Campo label={t("proponer.mensaje")} ayuda={t("proponer.mensajeAviso")}>
              <AreaTexto
                value={mensaje}
                onChange={setMensaje}
                placeholder={t("proponer.mensajePlaceholder")}
                maxLength={600}
              />
            </Campo>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <Boton onClick={() => setProponiendo(false)} disabled={guardando}>
                {t("acciones.cancelar")}
              </Boton>
              <Boton variante="primario" onClick={proponer} disabled={guardando}>
                {guardando ? t("proponer.enviando") : t("proponer.enviar")}
              </Boton>
            </div>
          </div>
        ) : null}

        {hecho ? (
          <Aviso tono="ok" icono={<CheckCircle2 size={14} />}>
            {hecho}
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

const LINK_BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 9,
  border: "1px solid var(--border-soft)",
  background: "var(--bg-elev)",
  color: "var(--text-2)",
  fontSize: 12.5,
  fontWeight: 600,
  textDecoration: "none",
};
