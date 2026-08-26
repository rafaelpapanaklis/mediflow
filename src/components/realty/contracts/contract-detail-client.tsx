"use client";

// ═══════════════════════════════════════════════════════════════════════
// EL CONTRATO — /inmobiliaria/contratos/[id]
//
// Aquí pasa todo lo que importa del módulo, y la pantalla está armada
// alrededor de UNA idea: el momento en que se manda a firmar es un punto
// de no retorno, y tiene que verse como tal.
//
//   BORRADOR → el texto se edita, las personas se cambian, se puede borrar.
//   ENVIADO  → el texto está CONGELADO. Ya no hay botón de editar; hay una
//              nota que dice por qué y qué hacer si de verdad hay que
//              cambiarlo (anular y generar uno nuevo).
//
// 🔴 LA PANTALLA NO ES LA REJA. Cada UPDATE del servidor lleva su
// condición en el WHERE (`sealedAt IS NULL`), así que aunque esta pantalla
// se equivocara —o alguien llamara a la API a mano— la base sigue diciendo
// que no. Lo de aquí es que el asesor ENTIENDA el estado, no que se lo
// impida.
//
// ── LO QUE SE DICE Y NO SE DISIMULA ───────────────────────────────────
// · Las ligas salen EN CLARO una sola vez y se enseñan para copiar. Es la
//   única vez que existen: en la base va su sha256.
// · De cada envío se dice si SALIÓ o NO SALIÓ, con el motivo que devuelve
//   el canal. Un "enviado" que en realidad no llegó es peor que un error.
// · Reenviarle a una persona invalida SOLO su liga. Se dice antes, porque
//   lo contrario —matarle la liga al inquilino por reenviarle al aval— es
//   exactamente lo que nadie entendería.
//
// i18n CONVENCIÓN B: el servidor ya recortó el sub-árbol; prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  Archive,
  ArrowLeft,
  Ban,
  Copy,
  FileText,
  Mail,
  MessageCircle,
  PenLine,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { Card, Field, Modal, Note, Pill, type Tone } from "../rentals/ui";
import "../rentals/rentals.css";
import "./contracts.css";
import {
  CONTRACT_STATUS_TONE,
  MAX_PARTIES,
  REALTY_PARTY_ROLES,
  ROLES_BY_KIND,
  isSealed,
  type ContractDetailDTO,
  type ContractPartyDTO,
  type RealtyPartyRole,
} from "./shared";

/** Lo que devuelve /enviar por cada persona. Se declara aquí y no se
 *  importa de la ruta: `_delivery.ts` es server-only y esto es un JSON. */
interface EnvioResultado {
  partyId: string;
  partyName: string;
  channel: "whatsapp" | "correo" | "copiada";
  delivered: boolean;
  detail: string;
  url: string;
  expiresAt: string;
}

type Canal = "whatsapp" | "correo" | "copiada";

const LINK_TONE: Record<ContractPartyDTO["link"], Tone> = {
  SIN_ENVIAR: "neutral",
  ENVIADA: "info",
  VENCIDA: "warning",
  USADA: "success",
};

/** Fila editable del modal de personas. */
interface ParteEdit {
  role: string;
  name: string;
  email: string;
  phone: string;
  mustSign: boolean;
}

export function ContractDetailClient({
  dict,
  contract,
  timeZone,
}: {
  dict: Dictionary;
  contract: ContractDetailDTO;
  timeZone: string;
}) {
  const t = makeRealtyT(dict);
  const router = useRouter();

  const [c, setC] = useState<ContractDetailDTO>(contract);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(c.body);
  const [titulo, setTitulo] = useState(c.title);
  const [ocupado, setOcupado] = useState(false);
  const [envios, setEnvios] = useState<EnvioResultado[]>([]);
  const [anularAbierto, setAnularAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [partesAbierto, setPartesAbierto] = useState(false);
  const [partesEdit, setPartesEdit] = useState<ParteEdit[]>([]);

  const sellado = isSealed(c.status);
  const anulado = c.status === "ANULADO";
  const archivado = c.status === "ARCHIVADO";
  const pendientes = useMemo(
    () => c.parties.filter((p) => p.mustSign && !p.signedAt),
    [c.parties],
  );
  // Se puede mandar mientras quede alguien por firmar y el contrato siga
  // vivo. Un archivado hay que sacarlo del archivo primero, y eso lo dice
  // el servidor con su propio mensaje.
  const sePuedeMandar = pendientes.length > 0 && !anulado && !archivado;

  const fecha = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("es-MX", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      });
    } catch {
      return null;
    }
  }, [timeZone]);

  function fechaHora(iso: string | null): string {
    if (!iso) return t("comun.sinDato");
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t("comun.sinDato");
    return fecha ? fecha.format(d) : iso.slice(0, 16).replace("T", " ");
  }

  function fechaCorta(iso: string | null): string {
    if (!iso) return t("comun.sinDato");
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return t("comun.sinDato");
    try {
      return new Intl.DateTimeFormat("es-MX", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone,
      }).format(d);
    } catch {
      return iso.slice(0, 10);
    }
  }

  async function patch(payload: Record<string, unknown>, exito?: string): Promise<boolean> {
    if (ocupado) return false;
    setOcupado(true);
    try {
      const res = await fetch(`/api/realty/contracts/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : t("comun.error"));
        return false;
      }
      if (data.contract) setC(data.contract as ContractDetailDTO);
      if (exito) toast.success(exito);
      router.refresh();
      return true;
    } catch {
      toast.error(t("comun.error"));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function guardarTexto() {
    const ok = await patch(
      { action: "editar", body: borrador, title: titulo },
      t("detalle.guardado"),
    );
    if (ok) setEditando(false);
  }

  async function mandar(canal: Canal, partyIds?: string[]) {
    if (ocupado) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/realty/contracts/${c.id}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal, partyIds: partyIds ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : t("comun.error"));
        return;
      }
      if (data.contract) setC(data.contract as ContractDetailDTO);
      const outcomes: EnvioResultado[] = Array.isArray(data.outcomes) ? data.outcomes : [];
      // Se REEMPLAZA, no se acumula: las ligas de un envío anterior a esta
      // misma persona ya no sirven, y dejarlas a la vista invita a copiar
      // una muerta.
      setEnvios(outcomes);
      const fallaron = outcomes.filter((o) => !o.delivered).length;
      if (fallaron === 0) toast.success(t("detalle.enviar.entregado"));
      else toast.error(t("detalle.enviar.noEntregado"));
      router.refresh();
    } catch {
      toast.error(t("comun.error"));
    } finally {
      setOcupado(false);
    }
  }

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("comun.copiado"));
    } catch {
      toast.error(t("comun.copiarFalla"));
    }
  }

  async function borrar() {
    if (ocupado) return;
    if (!window.confirm(t("detalle.acciones.borrarConfirm"))) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/realty/contracts/${c.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : t("comun.error"));
        return;
      }
      toast.success(t("detalle.acciones.borrado"));
      router.push("/inmobiliaria/contratos");
      router.refresh();
    } catch {
      toast.error(t("comun.error"));
    } finally {
      setOcupado(false);
    }
  }

  function abrirPartes() {
    setPartesEdit(
      c.parties.map((p) => ({
        role: p.role,
        name: p.name,
        email: p.email ?? "",
        phone: p.phone ?? "",
        mustSign: p.mustSign,
      })),
    );
    setPartesAbierto(true);
  }

  async function guardarPartes() {
    const ok = await patch(
      { action: "partes", parties: partesEdit },
      t("detalle.partesModal.guardado"),
    );
    if (ok) setPartesAbierto(false);
  }

  const rolesSugeridos: RealtyPartyRole[] = ROLES_BY_KIND[c.kind] ?? REALTY_PARTY_ROLES;

  return (
    <div className="ctr">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{c.title}</h1>
            <p className="rnt-head__sub">
              {c.folio} · {t(`kinds.${c.kind}`)} ·{" "}
              {t("detalle.partes.resumen", {
                firmadas: String(c.signed),
                requeridas: String(c.required),
              })}
            </p>
          </div>
          <div className="rnt-head__actions">
            <Link className="rnt-btn" href="/inmobiliaria/contratos">
              <ArrowLeft size={14} />
              {t("detalle.volver")}
            </Link>
            <a
              className="rnt-btn"
              href={`/api/realty/contracts/${c.id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <FileText size={14} />
              {t("detalle.pdf")}
            </a>
            {!sellado && !editando ? (
              <button type="button" className="rnt-btn rnt-btn--primary" onClick={() => setEditando(true)}>
                <PenLine size={14} />
                {t("detalle.editar")}
              </button>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Pill tone={CONTRACT_STATUS_TONE[c.status]} dot>
            {t(`status.${c.status}`)}
          </Pill>
          {c.propertyTitle ? <span className="rnt-card__sub">{c.propertyTitle}</span> : null}
        </div>
      </header>

      {anulado ? (
        <Note tone="danger">
          <strong>{t("detalle.anuladoTitle")}</strong>
          {" · "}
          {t("detalle.anuladoMotivo")}: {c.voidReason || t("comun.sinDato")}
        </Note>
      ) : null}

      <div className="ctr-split">
        {/* ── Columna 1: el documento ───────────────────────────────── */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card
            title={t("detalle.documento")}
            action={
              editando ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--sm"
                    onClick={() => {
                      setBorrador(c.body);
                      setTitulo(c.title);
                      setEditando(false);
                    }}
                  >
                    {t("detalle.cancelarEdicion")}
                  </button>
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--sm rnt-btn--primary"
                    onClick={guardarTexto}
                    disabled={ocupado}
                  >
                    <Save size={13} />
                    {ocupado ? t("comun.guardando") : t("comun.guardar")}
                  </button>
                </div>
              ) : undefined
            }
          >
            <div style={{ marginBottom: 12 }}>
              <Note tone={sellado ? "info" : "warning"}>
                {sellado ? t("detalle.selladoAviso") : t("detalle.borradorAviso")}
              </Note>
            </div>

            {editando ? (
              <>
                <Field label={t("nuevo.titulo")} hint={t("nuevo.tituloHint")}>
                  <input
                    className="rnt-input"
                    value={titulo}
                    maxLength={160}
                    onChange={(e) => setTitulo(e.target.value)}
                  />
                </Field>
                <div style={{ marginTop: 12 }}>
                  <textarea
                    className="ctr-paper-edit"
                    value={borrador}
                    spellCheck={false}
                    onChange={(e) => setBorrador(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="ctr-paper">{c.body}</div>
            )}
          </Card>
        </div>

        {/* ── Columna 2: ficha, firmantes y evidencia ───────────────── */}
        <div style={{ display: "grid", gap: 16 }}>
          <Card title={t("detalle.ficha.title")}>
            <dl className="ctr-def">
              <div>
                <dt>{t("detalle.ficha.tipo")}</dt>
                <dd>{t(`kinds.${c.kind}`)}</dd>
              </div>
              <div>
                <dt>{t("detalle.ficha.inmueble")}</dt>
                <dd>{c.propertyTitle || t("comun.sinDato")}</dd>
              </div>
              <div>
                <dt>{t("detalle.ficha.vigencia")}</dt>
                <dd>
                  {c.effectiveFrom || c.effectiveTo
                    ? `${fechaCorta(c.effectiveFrom)} — ${fechaCorta(c.effectiveTo)}`
                    : t("detalle.ficha.sinVigencia")}
                </dd>
              </div>
              <div>
                <dt>{t("detalle.ficha.creado")}</dt>
                <dd>{fechaHora(c.createdAt)}</dd>
              </div>
              {c.signedAt ? (
                <div>
                  <dt>{t("detalle.ficha.firmado")}</dt>
                  <dd>{fechaHora(c.signedAt)}</dd>
                </div>
              ) : null}
            </dl>
            <div style={{ marginTop: 12 }}>
              <div className="rnt-card__sub">{t("detalle.ficha.huella")}</div>
              <div className="ctr-hash">{c.documentHash}</div>
              <p className="rnt-field__hint" style={{ marginTop: 6 }}>
                {t("detalle.ficha.huellaHint")}
              </p>
            </div>
          </Card>

          <Card
            title={t("detalle.partes.title")}
            sub={t("detalle.partes.sub")}
            action={
              !sellado ? (
                <button type="button" className="rnt-btn rnt-btn--sm" onClick={abrirPartes}>
                  {t("detalle.partes.editar")}
                </button>
              ) : undefined
            }
          >
            {c.parties.map((p) => (
              <div className="ctr-party" key={p.id}>
                <div className="ctr-party__main">
                  <div className="ctr-party__name">{p.name}</div>
                  <div className="ctr-party__meta">
                    {t(`roles.${p.role}`)}
                    {" · "}
                    {p.email || t("detalle.partes.sinCorreo")}
                    {" · "}
                    {p.phone || t("detalle.partes.sinTelefono")}
                  </div>
                  <div className="ctr-party__meta">
                    {p.signedAt
                      ? `${t("detalle.partes.firmoEl")} ${fechaHora(p.signedAt)}`
                      : p.mustSign
                        ? t("detalle.partes.pendiente")
                        : t("detalle.partes.noFirma")}
                  </div>
                </div>
                <Pill tone={LINK_TONE[p.link]} dot>
                  {t(`detalle.link.${p.link}`)}
                </Pill>
                {p.mustSign && !p.signedAt && sePuedeMandar ? (
                  <div className="ctr-party__actions">
                    <button
                      type="button"
                      className="rnt-btn rnt-btn--sm"
                      disabled={ocupado || !p.phone}
                      title={p.phone ? undefined : t("detalle.partes.sinTelefono")}
                      onClick={() => mandar("whatsapp", [p.id])}
                    >
                      <MessageCircle size={13} />
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      className="rnt-btn rnt-btn--sm"
                      disabled={ocupado || !p.email}
                      title={p.email ? undefined : t("detalle.partes.sinCorreo")}
                      onClick={() => mandar("correo", [p.id])}
                    >
                      <Mail size={13} />
                      {t("detalle.enviar.correo")}
                    </button>
                    <button
                      type="button"
                      className="rnt-btn rnt-btn--sm"
                      disabled={ocupado}
                      onClick={() => mandar("copiada", [p.id])}
                    >
                      <Copy size={13} />
                      {t("detalle.enviar.copiar")}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}

            {sePuedeMandar ? (
              <div style={{ marginTop: 14 }}>
                <Note tone={sellado ? "info" : "warning"}>
                  {sellado ? t("detalle.enviar.soloEsta") : t("detalle.enviar.avisoSellado")}
                </Note>
                <div className="ctr-party__actions" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--primary"
                    disabled={ocupado}
                    onClick={() => mandar("whatsapp")}
                  >
                    <Send size={14} />
                    {ocupado ? t("detalle.enviar.enviando") : t("detalle.enviar.whatsapp")}
                  </button>
                  <button
                    type="button"
                    className="rnt-btn"
                    disabled={ocupado}
                    onClick={() => mandar("correo")}
                  >
                    <Mail size={14} />
                    {t("detalle.enviar.correo")}
                  </button>
                  <button
                    type="button"
                    className="rnt-btn"
                    disabled={ocupado}
                    onClick={() => mandar("copiada")}
                  >
                    <Copy size={14} />
                    {t("detalle.enviar.copiar")}
                  </button>
                </div>
              </div>
            ) : null}

            {envios.length > 0 ? (
              <div style={{ marginTop: 14 }}>
                <div className="rnt-card__sub">{t("detalle.enviar.ligas")}</div>
                <p className="rnt-field__hint" style={{ margin: "4px 0 8px" }}>
                  {t("detalle.enviar.ligasHint")}
                </p>
                {envios.map((o) => (
                  <div className="ctr-link" key={o.partyId}>
                    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                      <div className="ctr-party__name">
                        {o.partyName}{" "}
                        <Pill tone={o.delivered ? "success" : "danger"}>
                          {o.delivered ? t("detalle.enviar.entregado") : t("detalle.enviar.noEntregado")}
                        </Pill>
                      </div>
                      <div className="ctr-party__meta">{o.detail}</div>
                      <div className="ctr-link__url">{o.url}</div>
                      <div className="ctr-party__meta">
                        {t("detalle.enviar.vence")} {fechaCorta(o.expiresAt)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rnt-btn rnt-btn--sm"
                      onClick={() => copiar(o.url)}
                    >
                      <Copy size={13} />
                      {t("comun.copiar")}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card title={t("detalle.evidencia.title")} sub={t("detalle.evidencia.sub")}>
            {c.signatures.length === 0 ? (
              <p className="rnt-field__hint">{t("detalle.evidencia.vacia")}</p>
            ) : (
              c.signatures.map((s) => (
                <div
                  className={s.matchesCurrent ? "ctr-evidence" : "ctr-evidence ctr-evidence--alert"}
                  key={s.id}
                >
                  <div className="ctr-evidence__who">{s.signerName}</div>
                  <div className="ctr-evidence__line">
                    {t("detalle.evidencia.firmadoEl")} {fechaHora(s.signedAt)}
                  </div>
                  {s.ip ? (
                    <div className="ctr-evidence__line">
                      {t("detalle.evidencia.ip")} {s.ip}
                    </div>
                  ) : null}
                  {s.userAgent ? (
                    <div className="ctr-evidence__line">
                      {t("detalle.evidencia.dispositivo")}: {s.userAgent}
                    </div>
                  ) : null}
                  <div className="ctr-evidence__line ctr-hash">
                    {t("detalle.evidencia.huella")}: {s.documentHash}
                  </div>
                  {!s.matchesCurrent ? (
                    <div className="ctr-evidence__line" style={{ color: "var(--danger)" }}>
                      {t("detalle.evidencia.alerta")}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </Card>

          <Card>
            <div className="ctr-party__actions">
              <button
                type="button"
                className="rnt-btn rnt-btn--sm"
                disabled={ocupado}
                onClick={() =>
                  patch(
                    { action: archivado ? "desarchivar" : "archivar" },
                    archivado ? t("detalle.acciones.desarchivado") : t("detalle.acciones.archivado"),
                  )
                }
              >
                <Archive size={13} />
                {archivado ? t("detalle.acciones.desarchivar") : t("detalle.acciones.archivar")}
              </button>
              {!anulado ? (
                <button
                  type="button"
                  className="rnt-btn rnt-btn--sm"
                  disabled={ocupado}
                  onClick={() => setAnularAbierto(true)}
                >
                  <Ban size={13} />
                  {t("detalle.acciones.anular")}
                </button>
              ) : null}
              {!sellado ? (
                <button
                  type="button"
                  className="rnt-btn rnt-btn--sm rnt-btn--danger"
                  disabled={ocupado}
                  onClick={borrar}
                >
                  <Trash2 size={13} />
                  {t("detalle.acciones.borrar")}
                </button>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Anular ─────────────────────────────────────────────────── */}
      <Modal
        open={anularAbierto}
        title={t("detalle.anular.title")}
        sub={t("detalle.anular.sub")}
        onClose={() => setAnularAbierto(false)}
        closeLabel={t("comun.cerrar")}
        footer={
          <>
            <button type="button" className="rnt-btn" onClick={() => setAnularAbierto(false)}>
              {t("comun.cancelar")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--danger"
              disabled={ocupado || !motivo.trim()}
              onClick={async () => {
                const ok = await patch(
                  { action: "anular", reason: motivo },
                  t("detalle.anular.hecho"),
                );
                if (ok) {
                  setAnularAbierto(false);
                  setMotivo("");
                }
              }}
            >
              {t("detalle.anular.confirmar")}
            </button>
          </>
        }
      >
        <Field label={t("detalle.anular.motivo")} hint={t("detalle.anular.motivoHint")}>
          <textarea
            className="rnt-textarea"
            value={motivo}
            maxLength={500}
            rows={4}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </Field>
      </Modal>

      {/* ── Quién firma ────────────────────────────────────────────── */}
      <Modal
        open={partesAbierto}
        title={t("detalle.partesModal.title")}
        sub={t("detalle.partesModal.sub")}
        size="wide"
        onClose={() => setPartesAbierto(false)}
        closeLabel={t("comun.cerrar")}
        footer={
          <>
            <button type="button" className="rnt-btn" onClick={() => setPartesAbierto(false)}>
              {t("comun.cancelar")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--primary"
              disabled={ocupado}
              onClick={guardarPartes}
            >
              {ocupado ? t("comun.guardando") : t("comun.guardar")}
            </button>
          </>
        }
      >
        <Note tone="info">{t("detalle.partesModal.aviso")}</Note>
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {partesEdit.map((p, i) => (
            <div className="ctr-party" key={i}>
              <div className="rnt-grid rnt-grid--auto" style={{ flex: "1 1 100%" }}>
                <Field label={t("detalle.partesModal.rol")}>
                  <select
                    className="rnt-select"
                    value={p.role}
                    onChange={(e) =>
                      setPartesEdit((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)),
                      )
                    }
                  >
                    {/* Primero los que tienen sentido en ESTE tipo de
                        contrato; los demás siguen disponibles porque una
                        operación real siempre trae una excepción. */}
                    {rolesSugeridos.map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                    {REALTY_PARTY_ROLES.filter((r) => !rolesSugeridos.includes(r)).map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("detalle.partesModal.nombre")}>
                  <input
                    className="rnt-input"
                    value={p.name}
                    maxLength={160}
                    onChange={(e) =>
                      setPartesEdit((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Field label={t("detalle.partesModal.correo")}>
                  <input
                    className="rnt-input"
                    value={p.email}
                    maxLength={160}
                    inputMode="email"
                    onChange={(e) =>
                      setPartesEdit((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Field label={t("detalle.partesModal.telefono")}>
                  <input
                    className="rnt-input"
                    value={p.phone}
                    maxLength={40}
                    inputMode="tel"
                    onChange={(e) =>
                      setPartesEdit((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
              </div>
              <label className="ctr-party__meta" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={p.mustSign}
                  onChange={(e) =>
                    setPartesEdit((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, mustSign: e.target.checked } : x)),
                    )
                  }
                />
                {t("detalle.partesModal.firma")}
              </label>
              <button
                type="button"
                className="rnt-btn rnt-btn--sm"
                onClick={() => setPartesEdit((prev) => prev.filter((_, j) => j !== i))}
              >
                <X size={13} />
                {t("detalle.partesModal.quitar")}
              </button>
            </div>
          ))}
        </div>
        {partesEdit.length < MAX_PARTIES ? (
          <button
            type="button"
            className="rnt-btn"
            style={{ marginTop: 12 }}
            onClick={() =>
              setPartesEdit((prev) => [
                ...prev,
                { role: rolesSugeridos[0], name: "", email: "", phone: "", mustSign: true },
              ])
            }
          >
            <Plus size={14} />
            {t("detalle.partesModal.agregar")}
          </button>
        ) : null}
      </Modal>
    </div>
  );
}
