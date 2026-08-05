"use client";

// Multi-links con campaña: crear, copiar, QR descargable y stats por link.
// Arriba de la lista va el LINK BASE (sin campaña), marcado aparte para que el
// afiliado lo distinga de un vistazo.
//
// Este componente NUNCA arma una URL: todas llegan resueltas del servidor
// (`link.url` de la route, `baseUrl` por prop). link-url.ts —la fuente única—
// importa prisma y crypto, así que no puede cruzar al cliente.
//
// El TÍTULO que escribió el afiliado ("Facebook") es lo que se muestra en el
// panel junto a clics y registros: opaco hacia afuera, legible hacia adentro.
//
// Estilo: lenguaje del panel (src/app/afiliados/panel.css, namespace `dcafp`).
// El link base usa la caja morada `dcafp-linkhero` del diseño y cada link con
// campaña una superficie anidada; las URLs van en `dcafp-urlbox` y los botones
// en `dcafp-btn` (44px táctiles). Lo que solo pasa una vez —el ancho base de
// la caja de URL, el tinte de "Copiado"— va inline con tokens `--dcafp-*`.
//
// Confirmaciones con el toast del panel (la píldora oscura del diseño, que es
// donde el usuario mira cuando acaba de copiar); los ERRORES siguen en
// react-hot-toast, que sí tiene tono de error.
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, Plus, Trash2, MousePointerClick, UserPlus, Link2 } from "lucide-react";
import { QrDownloadButton } from "@/components/afiliados/tools/qr-download-button";
import { Chip, EmptyState, Note } from "@/components/afiliados/ui/panel-ui";
import { showPanelToast } from "@/components/afiliados/ui/panel-toast";
import type { ToolLink } from "@/app/api/afiliados/links/route";

export type { ToolLink };

// La caja de URL crece, pero con un ancho base propio: sin él `flex:1` la
// dejaría en 0 y a 375px el botón "Copiar" se comería el renglón entero.
const urlBoxStyle: React.CSSProperties = { flexBasis: 220 };

// Fila de URL + acciones. Envuelve a propósito: a 375px los botones caen bajo
// la caja en vez de desbordar el ancho de la tarjeta.
const actionsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  minWidth: 0,
};

// Superficie anidada de cada link con campaña (misma receta que .dcafp-planbox,
// con el aire que piden dos renglones).
const linkBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 9,
  minWidth: 0,
  padding: "13px 15px",
  borderRadius: "var(--dcafp-r-box)",
  background: "var(--dcafp-surface-2)",
  border: "1px solid var(--dcafp-line-nested)",
};

// Tinte verde del botón mientras dura el "Copiado". Es un estado de 2 s, no un
// patrón: por eso va inline y no como clase.
const copiedBtnStyle: React.CSSProperties = {
  background: "var(--dcafp-ok-bg)",
  borderColor: "var(--dcafp-ok-line)",
  color: "var(--dcafp-ok-ink)",
};

function errorMessage(body: any, fallback: string): string {
  if (body?.error === "tools_not_ready") {
    return "Las herramientas aún no están activas en la base de datos.";
  }
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

// Id sintético del link base para reusar el mismo estado de "Copiado" que las
// filas reales. No choca con un cuid de AffiliateLink.
const BASE_ROW_ID = "__base__";

export function LinksManager({
  initialLinks,
  ready,
  baseUrl,
  referralCode,
}: {
  initialLinks: ToolLink[];
  ready: boolean; // false = SQL sin correr → deshabilita crear y muestra aviso
  baseUrl: string; // link base sin campaña, ya resuelto en el servidor
  referralCode: string; // solo para nombrar el archivo del QR y mostrarlo
}) {
  const [links, setLinks] = useState<ToolLink[]>(initialLinks);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canCreate = ready && !creating && name.trim().length >= 2;

  async function createLink() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const res = await fetch("/api/afiliados/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.link) {
        toast.error(errorMessage(body, "No se pudo crear el link"));
        return;
      }
      setLinks((prev) => [...prev, body.link as ToolLink]);
      setName("");
      showPanelToast("Link creado");
    } catch {
      toast.error("No se pudo crear el link");
    } finally {
      setCreating(false);
    }
  }

  // Una sola función para el link base y para los de campaña: el toast y el
  // Check de 2 s se comportan igual en toda la tarjeta.
  async function copy(rowId: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(rowId);
      showPanelToast("Enlace copiado");
      setTimeout(() => setCopiedId((id) => (id === rowId ? null : id)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  async function removeLink(link: ToolLink) {
    // Paso 1: armar confirmación (se desarma sola a los 4 s).
    if (confirmingId !== link.id) {
      setConfirmingId(link.id);
      setTimeout(() => setConfirmingId((id) => (id === link.id ? null : id)), 4000);
      return;
    }
    // Paso 2: eliminar de verdad.
    if (deletingId) return;
    setDeletingId(link.id);
    try {
      const res = await fetch(`/api/afiliados/links/${link.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(errorMessage(body, "No se pudo eliminar el link"));
        return;
      }
      setLinks((prev) => prev.filter((x) => x.id !== link.id));
      showPanelToast("Link eliminado");
    } catch {
      toast.error("No se pudo eliminar el link");
    } finally {
      setDeletingId(null);
      setConfirmingId((id) => (id === link.id ? null : id));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {!ready && (
        <Note tone="warn">
          Disponible en cuanto se active la base de datos (
          <span className="dcafp-mono">sql/afiliados-ventas.sql</span>).
        </Note>
      )}

      {/* Link BASE (sin campaña). Va arriba y sobre fondo violeta para que se
          distinga a simple vista de los links con campaña: es el que se
          reparte cuando no estás midiendo un canal concreto, y el único que
          no se puede eliminar. */}
      <div className="dcafp-linkhero">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
          <Link2 size={15} style={{ color: "var(--dcafp-brand)", flex: "0 0 auto" }} aria-hidden />
          <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)" }}>Tu link base</span>
          <Chip sm>sin campaña</Chip>
          <span className="dcafp-chip dcafp-chip--sm dcafp-mono" style={{ letterSpacing: "0.06em" }}>
            {referralCode}
          </span>
        </div>
        <div className="dcafp-linkhero__row" style={actionsRowStyle}>
          <input
            readOnly
            value={baseUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Tu link base sin campaña"
            className="dcafp-urlbox dcafp-mono"
            style={urlBoxStyle}
          />
          <button
            type="button"
            onClick={() => void copy(BASE_ROW_ID, baseUrl)}
            className="dcafp-btn dcafp-btn--primary"
            aria-label="Copiar tu link base"
          >
            {copiedId === BASE_ROW_ID ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copiedId === BASE_ROW_ID ? "Copiado" : "Copiar"}
          </button>
          <QrDownloadButton url={baseUrl} fileName={`qr-${referralCode.toLowerCase()}`} />
        </div>
        <p className="dcafp-hint" style={{ margin: 0 }}>
          Compártelo cuando no necesites medir un canal en concreto: deja tu referido guardado 90
          días. Los de abajo hacen lo mismo, pero cada uno cuenta sus clics y registros por separado.
        </p>
      </div>

      {/* Crear link */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void createLink();
        }}
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Facebook, WhatsApp, Expo dental..."
          aria-label="Nombre de la campaña"
          maxLength={40}
          disabled={!ready || creating}
          className="dcafp-input"
          style={{ flex: "1 1 220px", minWidth: 0, width: "auto", opacity: ready ? 1 : 0.55 }}
        />
        <button type="submit" disabled={!canCreate} className="dcafp-btn dcafp-btn--primary">
          <Plus size={16} aria-hidden />
          {creating ? "Creando..." : "Crear link"}
        </button>
      </form>

      {links.length === 0 ? (
        <EmptyState icon={<Link2 size={22} />} title="Todavía no tienes links por campaña">
          Crea tu primer link nombrado para saber qué canal te trae más clínicas.
        </EmptyState>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {links.map((l) => {
            const copied = copiedId === l.id;
            const confirming = confirmingId === l.id;
            const deleting = deletingId === l.id;
            return (
              <div key={l.id} style={linkBoxStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)", minWidth: 0 }}>
                    {l.name}
                  </span>
                  <Chip sm>
                    <MousePointerClick size={12} aria-hidden />
                    {l.clicks} clics
                  </Chip>
                  <Chip sm>
                    <UserPlus size={12} aria-hidden />
                    {l.conversions} registros
                  </Chip>
                </div>
                <div style={actionsRowStyle}>
                  <input
                    readOnly
                    value={l.url}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label={`Link de la campaña ${l.name}`}
                    className="dcafp-urlbox dcafp-mono"
                    style={urlBoxStyle}
                  />
                  <button
                    type="button"
                    onClick={() => void copy(l.id, l.url)}
                    className="dcafp-btn dcafp-btn--outline"
                    style={copied ? copiedBtnStyle : undefined}
                    aria-label={`Copiar el link de ${l.name}`}
                  >
                    {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                  <QrDownloadButton url={l.url} fileName={`qr-${l.campaign}`} />
                  {/* Sin confirmar es un botón cuadrado de icono; al confirmar
                      crece a botón con texto para que el paso destructivo
                      diga lo que hace. Ambos miden 44px de alto. */}
                  {confirming ? (
                    <button
                      type="button"
                      onClick={() => void removeLink(l)}
                      disabled={deleting}
                      className="dcafp-btn dcafp-btn--danger"
                      aria-label={`Confirmar la eliminación del link ${l.name}`}
                    >
                      <Trash2 size={16} aria-hidden />
                      {deleting ? "Eliminando..." : "¿Eliminar?"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void removeLink(l)}
                      className="dcafp-iconbtn"
                      aria-label={`Eliminar link ${l.name}`}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </div>
                {confirming && (
                  <Note tone="warn">
                    Se perderán los clics y registros de este link. Pulsa &quot;¿Eliminar?&quot; otra
                    vez para confirmar.
                  </Note>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
