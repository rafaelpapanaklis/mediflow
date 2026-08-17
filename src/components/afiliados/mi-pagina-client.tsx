"use client";

/**
 * Panel del afiliado — "Mi página".
 *
 * El socio edita TRES cosas de su /socio/<slug>: su foto, una presentación
 * escrita con su voz y qué secciones se ven y en qué orden. Ni el hero, ni los
 * colores, ni la tipografía: eso es de DaleControl y no se toca.
 *
 * Nada de lo que hace aquí sale publicado. Todo entra a un BORRADOR y espera a
 * que Rafael lo apruebe, porque la página vive en dalecontrol.com y lo que
 * diga se lee como dicho por DaleControl. Mientras tanto —y también si le
 * rechazan— su página pública sigue mostrando lo último aprobado.
 *
 * La foto se guarda SOLA al subirla (es una subida, no un campo de texto); el
 * texto y las secciones esperan al botón de guardar. Cada tarjeta lo dice.
 */
import { useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ArrowDown, ArrowUp, ExternalLink, Lock, Trash2, Upload } from "lucide-react";
import {
  BIO_MAX_CHARS,
  MOVABLE_SECTIONS,
  PARTNER_SECTIONS,
  bioLength,
  sectionDef,
  type PartnerPageState,
  type SectionSetting,
} from "@/lib/affiliates/page-config";
import { Chip, Eyebrow, Note, PageHead, PanelCard } from "@/components/afiliados/ui/panel-ui";
import { PartnerIntro } from "@/components/socio/partner-intro";

type Busy = null | "save" | "submit" | "cancel" | "photo";

/** Huella de las secciones para detectar cambios sin comparar objetos. */
function sectionsKey(list: SectionSetting[]): string {
  return list.map((s) => `${s.id}:${s.visible ? 1 : 0}`).join("|");
}

/**
 * Día y mes, sin la hora. Con la hora, es-MX cierra en "p.m." y la frase que
 * la envuelve termina con "p.m..": el día es lo único que el socio necesita
 * saber de su envío, así que se queda solo el día.
 */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long" }).format(d);
  } catch {
    return "";
  }
}

export function MiPaginaClient({
  name,
  slug,
  initialState,
}: {
  name: string;
  slug: string;
  initialState: PartnerPageState;
}) {
  const [state, setState] = useState<PartnerPageState>(initialState);
  const [bio, setBio] = useState(initialState.draft.bio ?? "");
  const [sections, setSections] = useState<SectionSetting[]>(initialState.draft.sections);
  const [busy, setBusy] = useState<Busy>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const editable = state.status !== "pending";
  const photoUrl = state.draft.photoUrl;
  const publicHref = `/socio/${slug}`;

  // "Sin guardar" = lo que hay en pantalla difiere de lo que ya está en el
  // borrador del servidor. El bio se compara recortado porque el servidor lo
  // recorta al guardar: sin esto, un espacio al final dejaría el aviso de
  // cambios pendientes encendido para siempre.
  const dirty = useMemo(() => {
    if (bio.trim() !== (state.draft.bio ?? "")) return true;
    return sectionsKey(sections) !== sectionsKey(state.draft.sections);
  }, [bio, sections, state.draft]);

  const bioChars = bioLength(bio);
  const bioOver = bioChars > BIO_MAX_CHARS;

  /** Toda respuesta del servidor devuelve el estado completo: se adopta tal cual. */
  function applyState(next: PartnerPageState) {
    setState(next);
    setBio(next.draft.bio ?? "");
    setSections(next.draft.sections);
  }

  async function readError(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => null as any);
    return body?.error ?? fallback;
  }

  async function saveDraft(silent = false): Promise<PartnerPageState | null> {
    const res = await fetch("/api/afiliados/pagina", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio, sections }),
    });
    if (!res.ok) {
      toast.error(await readError(res, "No se pudo guardar tu borrador."));
      return null;
    }
    const next: PartnerPageState = await res.json();
    applyState(next);
    if (!silent) toast.success("Borrador guardado");
    return next;
  }

  async function handleSave() {
    if (busy) return;
    setBusy("save");
    try {
      await saveDraft();
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit() {
    if (busy) return;
    setBusy("submit");
    try {
      // Se guarda SIEMPRE antes de enviar, aunque no parezca haber cambios:
      // así lo que Rafael recibe es exactamente lo que el socio tiene en
      // pantalla, y no una versión anterior que se quedó sin guardar.
      const saved = await saveDraft(true);
      if (!saved) return;

      const res = await fetch("/api/afiliados/pagina/revision", { method: "POST" });
      if (!res.ok) {
        toast.error(await readError(res, "No se pudo enviar a revisión."));
        return;
      }
      applyState(await res.json());
      toast.success("Enviada a revisión");
    } finally {
      setBusy(null);
    }
  }

  async function handleCancelReview() {
    if (busy) return;
    setBusy("cancel");
    try {
      const res = await fetch("/api/afiliados/pagina/revision", { method: "DELETE" });
      const body = await res.json().catch(() => null as any);
      if (!res.ok) {
        // El 409 llega cuando Rafael ya la revisó: trae el estado real para
        // que la pantalla se ponga al día en vez de quedarse mintiendo.
        if (body?.state) applyState(body.state);
        toast.error(body?.error ?? "No se pudo retirar el envío.");
        return;
      }
      applyState(body);
      toast.success("Envío retirado. Puedes seguir editando.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePhoto(file: File) {
    if (busy) return;
    setBusy("photo");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/afiliados/pagina/foto", { method: "POST", body: form });
      if (!res.ok) {
        toast.error(await readError(res, "No se pudo subir la foto."));
        return;
      }
      applyState(await res.json());
      toast.success("Foto guardada en tu borrador");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleRemovePhoto() {
    if (busy) return;
    setBusy("photo");
    try {
      const res = await fetch("/api/afiliados/pagina/foto", { method: "DELETE" });
      if (!res.ok) {
        toast.error(await readError(res, "No se pudo quitar la foto."));
        return;
      }
      applyState(await res.json());
      toast.success("Foto quitada del borrador");
    } finally {
      setBusy(null);
    }
  }

  function moveSection(id: string, dir: -1 | 1) {
    setSections((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next.map((s, k) => ({ ...s, orden: k + 1 }));
    });
  }

  function toggleSection(id: string) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)));
  }

  /* ── El orden final de la página ────────────────────────────────────────
     Las fijas de arriba, luego el bloque que el socio ordena, luego las fijas
     de abajo. Se pinta la lista COMPLETA —fijas incluidas— para que vea su
     página entera y entienda dónde cae lo que mueve. */
  const topFixed = PARTNER_SECTIONS.filter((s) => s.slot === "top");
  const bottomFixed = PARTNER_SECTIONS.filter((s) => s.slot === "bottom");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 860 }}>
      <PageHead
        title="Mi página"
        sub="Personaliza tu página pública de socio. Todo pasa por revisión antes de publicarse."
        action={
          <a
            href={publicHref}
            target="_blank"
            rel="noopener noreferrer"
            className="dcafp-btn dcafp-btn--outline dcafp-btn--sm"
          >
            Ver mi página <ExternalLink size={15} />
          </a>
        }
      />

      <StatusBanner
        state={state}
        busy={busy}
        dirty={dirty}
        onCancelReview={handleCancelReview}
      />

      {/* ── Foto ─────────────────────────────────────────────────────── */}
      <PanelCard
        title="Tu foto"
        sub="Se recorta en un cuadrado centrado y se publica redonda. Se guarda en tu borrador en cuanto la subes."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div
            aria-hidden={!photoUrl}
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              flex: "0 0 auto",
              background: photoUrl ? "transparent" : "var(--dcafp-brand-50)",
              border: `1px solid ${photoUrl ? "var(--dcafp-line)" : "var(--dcafp-brand-100)"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              color: "var(--dcafp-ink-4)",
              fontSize: 12,
              textAlign: "center",
              padding: 8,
            }}
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Tu foto de perfil"
                width={96}
                height={96}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              "Sin foto"
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="dcafp-btn dcafp-btn--outline dcafp-btn--sm"
                disabled={!editable || busy != null}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={15} /> {photoUrl ? "Cambiar foto" : "Subir foto"}
              </button>
              {photoUrl ? (
                <button
                  type="button"
                  className="dcafp-btn dcafp-btn--ghost dcafp-btn--sm"
                  disabled={!editable || busy != null}
                  onClick={handleRemovePhoto}
                >
                  <Trash2 size={15} /> Quitar
                </button>
              ) : null}
            </div>
            <p className="dcafp-hint" style={{ margin: 0 }}>
              JPG, PNG o WebP, hasta 5 MB. {busy === "photo" ? "Subiendo…" : null}
            </p>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePhoto(file);
            }}
          />
        </div>
      </PanelCard>

      {/* ── Presentación ─────────────────────────────────────────────── */}
      <PanelCard
        title="Tu presentación"
        sub="Cuéntale a quien llegue quién eres y por qué recomiendas DaleControl. Se publica con tu nombre."
      >
        <label className="dcafp-label" htmlFor="mp-bio">
          Presentación
        </label>
        <textarea
          id="mp-bio"
          className="dcafp-textarea"
          rows={6}
          value={bio}
          disabled={!editable}
          maxLength={BIO_MAX_CHARS * 2}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Ej. Llevo doce años trabajando con clínicas dentales en Guadalajara y recomiendo DaleControl porque…"
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginTop: 6,
            flexWrap: "wrap",
          }}
        >
          <p className="dcafp-hint" style={{ margin: 0, maxWidth: 520 }}>
            Se publica como texto plano: las etiquetas de HTML o de markdown se leerían
            tal cual, no se convierten en formato.
          </p>
          <span
            className="dcafp-hint"
            style={{ margin: 0, color: bioOver ? "var(--dcafp-danger)" : undefined }}
          >
            {bioChars} / {BIO_MAX_CHARS}
          </span>
        </div>
        {bioOver ? (
          <Note tone="warn">
            Te pasaste del límite. Si guardas así, se recortará en {BIO_MAX_CHARS} caracteres.
          </Note>
        ) : null}
      </PanelCard>

      {/* ── Secciones ────────────────────────────────────────────────── */}
      <PanelCard
        title="Secciones de tu página"
        sub="Enciende, apaga y reordena lo que quieras enseñar. Las fijas llevan un botón de registro con tu código."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {topFixed.map((def) => (
            <FixedRow key={def.id} id={def.id} />
          ))}

          {sections.map((s, i) => (
            <MovableRow
              key={s.id}
              setting={s}
              index={i}
              total={sections.length}
              disabled={!editable || busy != null}
              onToggle={() => toggleSection(s.id)}
              onMove={(dir) => moveSection(s.id, dir)}
            />
          ))}

          {bottomFixed.map((def) => (
            <FixedRow key={def.id} id={def.id} />
          ))}
        </div>
      </PanelCard>

      {/* ── Vista previa ─────────────────────────────────────────────── */}
      <PanelCard
        title="Vista previa"
        sub="Así queda tu página si se aprueban estos cambios. El resto del contenido no cambia."
      >
        <PagePreview name={name} slug={slug} photoUrl={photoUrl} bio={bio} sections={sections} />
      </PanelCard>

      {/* ── Acciones ─────────────────────────────────────────────────── */}
      {editable ? (
        <PanelCard>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="dcafp-btn dcafp-btn--primary"
              disabled={busy != null}
              onClick={handleSubmit}
            >
              {busy === "submit" ? "Enviando…" : "Enviar a revisión"}
            </button>
            <button
              type="button"
              className="dcafp-btn dcafp-btn--outline"
              disabled={busy != null || !dirty}
              onClick={handleSave}
            >
              {busy === "save" ? "Guardando…" : "Guardar borrador"}
            </button>
            <span className="dcafp-hint" style={{ margin: 0 }}>
              {dirty ? "Tienes cambios sin guardar." : "Todo tu borrador está guardado."}
            </span>
          </div>
        </PanelCard>
      ) : null}
    </div>
  );
}

/* ── Aviso de estado ────────────────────────────────────────────────────
   Es la pieza que responde la única pregunta que importa en esta pantalla:
   "¿qué está viendo ahora mismo la gente que entra a mi página?". */

function StatusBanner({
  state,
  busy,
  dirty,
  onCancelReview,
}: {
  state: PartnerPageState;
  busy: Busy;
  dirty: boolean;
  onCancelReview: () => void;
}) {
  const publicoDice = state.publishedEmpty
    ? "Tu página pública sigue viéndose como siempre, sin foto ni presentación."
    : "Tu página pública sigue mostrando lo último que se te aprobó.";

  if (state.status === "pending") {
    const cuando = formatDate(state.submittedAt);
    return (
      <Note tone="warn">
        <strong>Tu página está en revisión.</strong>{" "}
        {cuando ? `La enviaste el ${cuando}. ` : ""}
        Mientras la revisamos no puedes editarla, y {publicoDice.charAt(0).toLowerCase()}
        {publicoDice.slice(1)} Te avisamos por correo en cuanto haya respuesta.
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="dcafp-btn dcafp-btn--ghost dcafp-btn--sm"
            disabled={busy != null}
            onClick={onCancelReview}
          >
            {busy === "cancel" ? "Retirando…" : "Retirar el envío y seguir editando"}
          </button>
        </div>
      </Note>
    );
  }

  if (state.status === "rejected") {
    return (
      <Note tone="danger">
        <strong>No se aprobaron estos cambios.</strong>
        {state.rejectReason ? (
          <div style={{ marginTop: 6 }}>
            <Eyebrow>Motivo</Eyebrow>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{state.rejectReason}</p>
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          Tu borrador sigue aquí tal como lo dejaste: corrígelo y vuelve a enviarlo. {publicoDice}
        </div>
      </Note>
    );
  }

  if (state.status === "approved" && !dirty) {
    return (
      <Note tone="ok">
        <strong>Tu página está publicada.</strong> Lo que ves aquí abajo es justo lo que
        está en línea. Si cambias algo, vuelve a pasar por revisión antes de publicarse.
      </Note>
    );
  }

  if (state.hasDraft || dirty) {
    return (
      <Note tone="brand">
        <strong>Tienes cambios sin enviar.</strong> {publicoDice} Cuando termines, mándalos
        a revisión y te avisamos por correo en cuanto se resuelva.
      </Note>
    );
  }

  return (
    <Note tone="brand">
      Puedes ponerle tu foto, una presentación tuya y decidir qué secciones enseñas.
      Nada se publica hasta que lo revisemos: la página vive en dalecontrol.com y lo que
      dice se lee como dicho por DaleControl.
    </Note>
  );
}

/* ── Filas de la lista de secciones ─────────────────────────────────── */

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 14px",
  border: "1px solid var(--dcafp-line)",
  borderRadius: "var(--dcafp-r-box)",
  background: "var(--dcafp-surface)",
  minHeight: "var(--dcafp-tap)",
};

function FixedRow({ id }: { id: string }) {
  const def = sectionDef(id);
  if (!def) return null;
  return (
    <div style={{ ...rowStyle, background: "var(--dcafp-surface-2)" }}>
      <Lock size={15} style={{ flex: "0 0 auto", color: "var(--dcafp-ink-4)" }} aria-hidden />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13.5, color: "var(--dcafp-ink)" }}>{def.label}</strong>
          <Chip sm>Fija</Chip>
        </div>
        <p className="dcafp-hint" style={{ margin: "2px 0 0" }}>
          {def.hint} {def.fixedReason}
        </p>
      </div>
    </div>
  );
}

function MovableRow({
  setting,
  index,
  total,
  disabled,
  onToggle,
  onMove,
}: {
  setting: SectionSetting;
  index: number;
  total: number;
  disabled: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const def = sectionDef(setting.id);
  if (!def) return null;

  return (
    <div style={{ ...rowStyle, opacity: setting.visible ? 1 : 0.62 }}>
      <input
        type="checkbox"
        id={`sec-${setting.id}`}
        checked={setting.visible}
        disabled={disabled}
        onChange={onToggle}
        style={{
          width: 17,
          height: 17,
          flex: "0 0 auto",
          accentColor: "var(--dcafp-brand)",
          cursor: disabled ? "default" : "pointer",
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <label
          htmlFor={`sec-${setting.id}`}
          style={{
            fontSize: 13.5,
            fontWeight: 600,
            color: "var(--dcafp-ink)",
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {def.label}
        </label>
        <p className="dcafp-hint" style={{ margin: "2px 0 0" }}>
          {setting.visible ? def.hint : `Oculta. ${def.hint}`}
        </p>
      </div>
      <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
        <button
          type="button"
          className="dcafp-iconbtn"
          aria-label={`Subir ${def.label}`}
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp size={16} />
        </button>
        <button
          type="button"
          className="dcafp-iconbtn"
          aria-label={`Bajar ${def.label}`}
          disabled={disabled || index === total - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown size={16} />
        </button>
      </div>
    </div>
  );
}

/* ── Vista previa ───────────────────────────────────────────────────────
   El bloque de presentación se pinta con <PartnerIntro />, el MISMO componente
   que usa /socio/<slug>: no es una imitación, es la pieza real. El resto de la
   página se representa como una lista de bandas con su nombre — enseña el
   orden y qué queda dentro, que es lo único que el socio decide. */

function PagePreview({
  name,
  slug,
  photoUrl,
  bio,
  sections,
}: {
  name: string;
  slug: string;
  photoUrl: string | null;
  bio: string;
  sections: SectionSetting[];
}) {
  const cleanBio = bio.trim();
  const visibles = sections.filter((s) => s.visible);
  const ocultas = sections.length - visibles.length;

  return (
    <div>
      <div
        style={{
          border: "1px solid var(--dcafp-line)",
          borderRadius: "var(--dcafp-r-box)",
          overflow: "hidden",
          background: "#ffffff",
        }}
      >
        {/* Barra de navegador: deja claro que esto es la página pública. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "var(--dcafp-surface-2)",
            borderBottom: "1px solid var(--dcafp-line)",
          }}
        >
          <span
            className="dcafp-mono"
            style={{ fontSize: 11.5, color: "var(--dcafp-ink-3)", minWidth: 0 }}
          >
            dalecontrol.com/socio/{slug}
          </span>
        </div>

        <PreviewBand label="Portada" note={`«Recomendado por ${name}» y el botón de registro`} fixed />

        {photoUrl || cleanBio ? (
          <PartnerIntro name={name} photoUrl={photoUrl} bio={cleanBio || null} />
        ) : (
          <div style={{ padding: "18px 16px", borderBottom: "1px solid var(--dcafp-line-soft)" }}>
            <p className="dcafp-hint" style={{ margin: 0 }}>
              Tu presentación no aparecerá: no tienes foto ni texto. En cuanto pongas una de
              las dos, este bloque sale aquí.
            </p>
          </div>
        )}

        {visibles.map((s) => {
          const def = sectionDef(s.id);
          return def ? <PreviewBand key={s.id} label={def.label} note={def.hint} /> : null;
        })}

        <PreviewBand label="Calculadora de ahorro" note="Con su botón de registro" fixed />
        <PreviewBand label="Cierre e invitación" note="El último botón de registro" fixed />
        <PreviewBand label="Pie de página" note="Tu nombre y un enlace más" fixed last />
      </div>

      <p className="dcafp-hint" style={{ margin: "10px 0 0" }}>
        {ocultas === 0
          ? "Estás enseñando todas las secciones."
          : `${ocultas} ${ocultas === 1 ? "sección oculta" : "secciones ocultas"} de ${MOVABLE_SECTIONS.length}.`}
      </p>
    </div>
  );
}

function PreviewBand({
  label,
  note,
  fixed,
  last,
}: {
  label: string;
  note: string;
  fixed?: boolean;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: last ? "none" : "1px solid var(--dcafp-line-soft)",
        background: fixed ? "var(--dcafp-surface-2)" : "var(--dcafp-surface)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {fixed ? (
        <Lock size={13} style={{ flex: "0 0 auto", color: "var(--dcafp-ink-4)" }} aria-hidden />
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--dcafp-ink-2)" }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--dcafp-ink-4)" }}>{note}</div>
      </div>
    </div>
  );
}
