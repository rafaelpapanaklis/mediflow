"use client";

// ═══════════════════════════════════════════════════════════════════════
// La libreta de textos: escribir, editar, borrar, ordenar y copiar.
//
// ── POR QUÉ AGRUPADOS POR GIRO Y NO POR ETAPA ──────────────────────────
// Lo que cambia de raíz entre un texto y otro es QUÉ se vende: a una
// escuela de odontología no se le manda ni de lejos el mensaje de una
// barbería, y eso ya vive en el catálogo (cada giro trae su `producto`).
// La etapa del embudo cambia el MOMENTO, casi nunca las palabras — el
// mismo "te vuelvo a escribir por si no lo viste" sirve en Contactado y en
// Propuesta. Por eso la etapa va como ETIQUETA (filtra, ordena las
// sugerencias) pero no parte la lista en ocho pedazos donde los tres
// textos de dental quedarían desperdigados. La decisión y su motivo viven
// en crmAgruparTextos, para que no se pueda cambiar en un solo lado.
//
// ── EL ORDEN ───────────────────────────────────────────────────────────
// Con ↑ y ↓, no arrastrando: arrastrar no funciona con teclado ni bien en
// móvil, y aquí no hay una segunda vía como la tiene el tablero. Al mover
// se manda la lista COMPLETA de ids en su orden nuevo y el servidor
// reescribe todos los `sortOrder`; intercambiar dos valores fallaría con
// los textos recién creados, que nacen todos con el mismo.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { crmEtapa, crmVertical, CRM_ETAPAS, CRM_VERTICALES } from "@/lib/admin/crm/crm-core";
import {
  crmAgruparTextos,
  crmOrdenarTextos,
  crmRellenarTexto,
  crmTextoCoincide,
  crmValidarTexto,
  CRM_HUECOS,
  CRM_PROSPECTO_EJEMPLO,
  CRM_TEXTO_CUERPO_MAX,
  type CrmTextoDTO,
} from "@/lib/admin/crm/textos-core";
import type { CrmTextosListado } from "@/lib/admin/crm/textos-service";
import { crmCopiar } from "../crm-copiar";
import {
  actualizarTextoAccion,
  crearTextoAccion,
  eliminarTextoAccion,
  reordenarTextosAccion,
} from "../textos-actions";

export function CrmTextosClient({ listado }: { listado: CrmTextosListado }) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const [, startTransition] = useTransition();

  // La verdad la manda el servidor; esto es el adelanto para que reordenar
  // se sienta instantáneo. Se vuelve a tomar en cada refresco — el mismo
  // criterio que el tablero de prospectos.
  const [textos, setTextos] = useState<CrmTextoDTO[]>(listado.textos);
  useEffect(() => {
    setTextos(listado.textos);
  }, [listado.textos]);

  const [q, setQ] = useState("");
  const [editando, setEditando] = useState<CrmTextoDTO | null>(null);
  const [creando, setCreando] = useState(false);

  const filtrados = useMemo(
    () => textos.filter((t) => crmTextoCoincide(t, q)),
    [textos, q],
  );
  const grupos = useMemo(() => crmAgruparTextos(filtrados), [filtrados]);

  /**
   * Mueve un texto una posición. El orden es GLOBAL aunque la lista se
   * pinte agrupada: se intercambian las dos posiciones en el arreglo
   * completo, así que lo que hay en medio se queda donde estaba y sólo
   * cambian de sitio los dos que se ven moverse.
   */
  function mover(id: string, hacia: -1 | 1) {
    const global = crmOrdenarTextos(textos);
    const i = global.findIndex((t) => t.id === id);
    if (i < 0) return;

    // El vecino DENTRO DEL MISMO GRUPO: en la pantalla los grupos están
    // separados, y una flecha que saltara de un giro a otro se leería como
    // un fallo. Sin vecino en su grupo, la flecha no debería haberse
    // pintado — por si acaso, no se hace nada.
    const grupoDe = (t: CrmTextoDTO) => t.vertical ?? "";
    const miGrupo = grupoDe(global[i]);
    let j = i + hacia;
    while (j >= 0 && j < global.length && grupoDe(global[j]) !== miGrupo) j += hacia;
    if (j < 0 || j >= global.length) return;

    const copia = [...global];
    const tmp = copia[i];
    copia[i] = copia[j];
    copia[j] = tmp;

    // Pintado optimista: se reescriben los sortOrder locales con la
    // posición nueva para que la lista no vuelva a saltar mientras el
    // servidor contesta.
    setTextos(copia.map((t, k) => ({ ...t, sortOrder: k })));

    startTransition(async () => {
      const r = await reordenarTextosAccion(copia.map((t) => t.id));
      if (!r.ok) {
        setTextos(global);
        toast.error(r.error ?? "No se pudo guardar el orden.");
        return;
      }
      router.refresh();
    });
  }

  async function borrar(t: CrmTextoDTO) {
    const ok = await askConfirm({
      title: `¿Borrar "${t.title}"?`,
      description:
        "Se borra el texto. No afecta a ningún prospecto —los mensajes que ya mandaste siguen mandados—, pero si lo vuelves a querer hay que reescribirlo.",
      variant: "danger",
      confirmText: "Borrar el texto",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await eliminarTextoAccion(t.id);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo borrar.");
        return;
      }
      toast.success(r.mensaje ?? "Borrado.");
      setTextos((prev) => prev.filter((x) => x.id !== t.id));
      router.refresh();
    });
  }

  // ── Falta el SQL ──────────────────────────────────────────────────────
  if (listado.falta) {
    return (
      <CardNew>
        <div style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
            Falta crear la tabla de los textos
          </h2>
          <p style={{ marginTop: 8, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            No se pudo leer la libreta. Lo más probable es que falte aplicar{" "}
            <code>sql/crm-textos.sql</code> en Supabase: es el que crea{" "}
            <code>crm_templates</code>. Se pega en el editor de SQL y se corre; es idempotente,
            así que no pasa nada si ya se había corrido. El detalle del error está en los logs
            del servidor.
          </p>
          <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.6 }}>
            El resto del CRM —el tablero, la lista, la bitácora— funciona igual sin esto. Lo
            único que no se puede es guardar textos.
          </p>
        </div>
      </CardNew>
    );
  }

  // ── Libreta vacía ─────────────────────────────────────────────────────
  if (textos.length === 0) {
    return (
      <>
        <CardNew>
          <div style={{ padding: "36px 20px", textAlign: "center", maxWidth: 620, margin: "0 auto" }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 12,
                margin: "0 auto 14px",
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                color: "var(--brand)",
              }}
            >
              <FileText size={22} />
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
              Todavía no tienes ningún texto
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-3)", margin: "8px 0 18px", lineHeight: 1.55 }}>
              Empieza por el primero que mandas cuando no te conocen de nada. Después, desde la
              ficha de cualquier prospecto, lo copias de un clic ya con su nombre y su ciudad
              puestos.
            </p>
            <ButtonNew variant="primary" icon={<Plus size={13} />} onClick={() => setCreando(true)}>
              Escribir el primero
            </ButtonNew>
          </div>
        </CardNew>
        {creando && (
          <TextoFormulario
            alCerrar={() => setCreando(false)}
            alGuardar={() => router.refresh()}
          />
        )}
      </>
    );
  }

  // ── La libreta ────────────────────────────────────────────────────────
  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200, maxWidth: 380 }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-4)",
              pointerEvents: "none",
            }}
          />
          <input
            className="input-new"
            style={{ paddingLeft: 30 }}
            placeholder="Buscar en mis textos…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar textos"
          />
        </div>
        <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>
          {textos.length} {textos.length === 1 ? "texto" : "textos"}
        </span>
        <ButtonNew
          variant="primary"
          icon={<Plus size={13} />}
          onClick={() => setCreando(true)}
          disabled={listado.lleno}
          title={listado.lleno ? "La libreta está llena. Borra alguno que ya no uses." : undefined}
          style={{ marginLeft: "auto" }}
        >
          Nuevo texto
        </ButtonNew>
      </div>

      {filtrados.length === 0 ? (
        <CardNew>
          <div style={{ padding: "30px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Ningún texto dice eso.
          </div>
        </CardNew>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {grupos.map((g) => (
            <CardNew
              key={g.verticalId || "__generico"}
              noPad
              title={g.titulo}
              sub={
                g.verticalId
                  ? `Se sugieren solos en los prospectos de ${crmVertical(g.verticalId).label.toLowerCase()}.`
                  : "Se sugieren en cualquier prospecto."
              }
            >
              <div>
                {g.textos.map((t, i) => (
                  <FilaTexto
                    key={t.id}
                    t={t}
                    primero={i === 0}
                    ultimo={i === g.textos.length - 1}
                    // Las flechas se apagan cuando hay una búsqueda puesta:
                    // reordenar sobre una lista filtrada movería el texto a
                    // un sitio que no se está viendo.
                    ordenable={!q.trim()}
                    alSubir={() => mover(t.id, -1)}
                    alBajar={() => mover(t.id, 1)}
                    alEditar={() => setEditando(t)}
                    alBorrar={() => borrar(t)}
                  />
                ))}
              </div>
            </CardNew>
          ))}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: "var(--text-4)", marginTop: 14, maxWidth: 760, lineHeight: 1.5 }}>
        Estos textos se copian y los pegas tú. No son plantillas de WhatsApp Business —esas se
        aprueban en Meta y las manda el producto—, así que aquí puedes escribir lo que quieras.
      </p>

      {creando && (
        <TextoFormulario alCerrar={() => setCreando(false)} alGuardar={() => router.refresh()} />
      )}
      {editando && (
        <TextoFormulario
          texto={editando}
          alCerrar={() => setEditando(null)}
          alGuardar={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function FilaTexto({
  t,
  primero,
  ultimo,
  ordenable,
  alSubir,
  alBajar,
  alEditar,
  alBorrar,
}: {
  t: CrmTextoDTO;
  primero: boolean;
  ultimo: boolean;
  ordenable: boolean;
  alSubir: () => void;
  alBajar: () => void;
  alEditar: () => void;
  alBorrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    // Se copia el texto CRUDO, con los huecos sin rellenar: aquí no hay
    // ningún prospecto abierto y rellenarlo con el de ejemplo mandaría
    // "Clínica Dental Sonrisa" a un cliente de verdad. Para copiarlo ya
    // relleno está la ficha del prospecto, que es donde tiene sentido.
    const ok = await crmCopiar(t.body);
    if (!ok) {
      toast.error("El navegador no dejó copiar. Ábrelo con Editar y usa Ctrl+C.");
      return;
    }
    setCopiado(true);
    toast.success(
      t.body.indexOf("{{") >= 0
        ? "Copiado tal cual, con los huecos sin rellenar."
        : "Copiado.",
    );
    window.setTimeout(() => setCopiado(false), 2200);
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 16px",
        borderTop: primero ? "none" : "1px solid var(--border-soft)",
        alignItems: "flex-start",
      }}
    >
      {ordenable && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, paddingTop: 1 }}>
          <BotonOrden icono={<ArrowUp size={12} />} label={`Subir ${t.title}`} onClick={alSubir} apagado={primero} />
          <BotonOrden icono={<ArrowDown size={12} />} label={`Bajar ${t.title}`} onClick={alBajar} apagado={ultimo} />
        </div>
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>{t.title}</span>
          {t.stage ? (
            <BadgeNew tone={crmEtapa(t.stage).tono}>{crmEtapa(t.stage).label}</BadgeNew>
          ) : (
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>Cualquier momento</span>
          )}
        </div>
        <p
          style={{
            margin: "5px 0 0",
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {t.body}
        </p>
      </div>

      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <ButtonNew
          size="sm"
          variant="ghost"
          icon={copiado ? <Check size={13} /> : <Copy size={13} />}
          onClick={copiar}
          aria-label={`Copiar ${t.title}`}
          title="Copiar tal cual, sin rellenar los huecos"
        />
        <ButtonNew
          size="sm"
          variant="ghost"
          icon={<Pencil size={13} />}
          onClick={alEditar}
          aria-label={`Editar ${t.title}`}
        />
        <ButtonNew
          size="sm"
          variant="ghost"
          icon={<Trash2 size={13} />}
          onClick={alBorrar}
          aria-label={`Borrar ${t.title}`}
        />
      </div>
    </div>
  );
}

function BotonOrden({
  icono,
  label,
  onClick,
  apagado,
}: {
  icono: React.ReactNode;
  label: string;
  onClick: () => void;
  apagado: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={apagado}
      aria-label={label}
      title={label}
      style={{
        width: 22,
        height: 18,
        display: "grid",
        placeItems: "center",
        border: "1px solid var(--border-soft)",
        borderRadius: 5,
        background: "var(--bg-elev-2)",
        color: "var(--text-3)",
        cursor: apagado ? "not-allowed" : "pointer",
        opacity: apagado ? 0.3 : 1,
        padding: 0,
      }}
    >
      {icono}
    </button>
  );
}

// ── El formulario ───────────────────────────────────────────────────────

function TextoFormulario({
  texto,
  alCerrar,
  alGuardar,
}: {
  /** Con texto = editar; sin él = uno nuevo. */
  texto?: CrmTextoDTO | null;
  alCerrar: () => void;
  alGuardar?: (t: CrmTextoDTO) => void;
}) {
  const editando = !!texto;
  const [title, setTitle] = useState(texto?.title ?? "");
  const [body, setBody] = useState(texto?.body ?? "");
  const [vertical, setVertical] = useState(texto?.vertical ?? "");
  const [stage, setStage] = useState(texto?.stage ?? "");
  const [pendiente, startTransition] = useTransition();

  const entrada = {
    title,
    body,
    vertical: vertical || null,
    stage: stage || null,
  };

  // La MISMA validación que corre el servidor. Si el formulario validara
  // por su cuenta, el botón se pondría verde y la acción reventaría luego.
  const invalido = crmValidarTexto(entrada);

  // La vista previa va con un prospecto de EJEMPLO, no con uno real: aquí
  // no hay ninguno abierto, y enseñar el de otro sería confuso.
  const previa = useMemo(
    () => crmRellenarTexto(body, { ...CRM_PROSPECTO_EJEMPLO, vertical: vertical || "DENTAL" }),
    [body, vertical],
  );

  function insertarHueco(clave: string) {
    setBody((prev) => `${prev}{{${clave}}}`);
  }

  function guardar() {
    if (invalido) {
      toast.error(invalido);
      return;
    }
    startTransition(async () => {
      const r = editando
        ? await actualizarTextoAccion(texto!.id, entrada)
        : await crearTextoAccion(entrada);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(r.mensaje ?? "Guardado.");
      if (r.datos) alGuardar?.(r.datos);
      alCerrar();
    });
  }

  return (
    <div className="modal-overlay" onClick={alCerrar}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-texto-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div className="modal__title" id="crm-texto-titulo">
            {editando ? `Editar "${texto?.title}"` : "Nuevo texto"}
          </div>
          <ButtonNew
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={alCerrar}
            aria-label="Cerrar"
          />
        </div>

        <div className="modal__body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field-new">
            <label className="field-new__label" htmlFor="crm-texto-title">
              Título <span className="req">*</span>
            </label>
            <input
              id="crm-texto-title"
              className="input-new"
              autoFocus
              placeholder="Primer contacto en frío"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "2px 0 0" }}>
              Es como lo vas a encontrar cuando tengas veinte. No lo ve el prospecto.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field-new">
              <label className="field-new__label" htmlFor="crm-texto-vertical">
                ¿Para qué giro?
              </label>
              <select
                id="crm-texto-vertical"
                className="input-new"
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
              >
                <option value="">Cualquiera</option>
                {CRM_VERTICALES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label" htmlFor="crm-texto-stage">
                ¿En qué momento?
              </label>
              <select
                id="crm-texto-stage"
                className="input-new"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
              >
                <option value="">Cualquiera</option>
                {CRM_ETAPAS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "-6px 0 0", lineHeight: 1.45 }}>
            Los dos sirven para que el texto se sugiera solo en el prospecto adecuado. Nunca
            esconden nada: desde cualquier prospecto se pueden ver todos.
          </p>

          <div className="field-new">
            <label className="field-new__label" htmlFor="crm-texto-body">
              El mensaje <span className="req">*</span>
            </label>
            <textarea
              id="crm-texto-body"
              className="input-new"
              style={{
                height: "auto",
                minHeight: 150,
                padding: "10px 12px",
                lineHeight: 1.5,
                resize: "vertical",
              }}
              maxLength={CRM_TEXTO_CUERPO_MAX}
              placeholder={"{{saludo}} le escribo de DaleControl…"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 11,
                color: "var(--text-4)",
              }}
            >
              <span>Empieza con &#123;&#123;saludo&#125;&#125; y no tendrás que resolver el «Hola» a mano.</span>
              <span className="mono">
                {body.length} / {CRM_TEXTO_CUERPO_MAX}
              </span>
            </div>
          </div>

          {/* ── Los huecos ─────────────────────────────────────────── */}
          <div>
            <div className="form-section__title">
              Huecos que se rellenan solos
              <span className="form-section__rule" />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CRM_HUECOS.map((h) => (
                <button
                  key={h.clave}
                  type="button"
                  onClick={() => insertarHueco(h.clave)}
                  title={`${h.etiqueta}${h.siempre ? "" : " — puede venir vacío"}. Ejemplo: ${h.ejemplo}`}
                  style={{
                    height: 26,
                    padding: "0 9px",
                    borderRadius: 99,
                    fontSize: 11,
                    cursor: "pointer",
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-elev-2)",
                    color: "var(--text-2)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <span className="mono">{`{{${h.clave}}}`}</span>
                  {!h.siempre && <span style={{ color: "var(--warning)" }}> ·</span>}
                </button>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "8px 0 0", lineHeight: 1.5 }}>
              Se sustituyen con los datos del prospecto que tengas abierto. Los marcados con{" "}
              <span style={{ color: "var(--warning)" }}>·</span> pueden venir vacíos si a ese
              prospecto le falta el dato; cuando pase, la pantalla te lo dice antes de copiar.
            </p>
          </div>

          {/* ── Vista previa ───────────────────────────────────────── */}
          {body.trim() && (
            <div>
              <div className="form-section__title">
                Cómo se va a ver
                <span className="form-section__rule" />
              </div>
              <div
                style={{
                  border: "1px solid var(--border-soft)",
                  borderRadius: 9,
                  background: "var(--bg-elev-2)",
                  padding: "10px 12px",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--text-1)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {previa.texto}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-4)", margin: "6px 0 0" }}>
                Con un prospecto de ejemplo (Clínica Dental Sonrisa, Dra. Ana Ruiz, Puebla). El de
                verdad se rellena desde su ficha.
              </p>
            </div>
          )}
        </div>

        <div className="modal__footer">
          {invalido && (
            <span style={{ fontSize: 11.5, color: "var(--danger)", marginRight: "auto" }}>
              {invalido}
            </span>
          )}
          <ButtonNew variant="ghost" onClick={alCerrar} disabled={pendiente}>
            Cancelar
          </ButtonNew>
          <ButtonNew variant="primary" onClick={guardar} disabled={pendiente || !!invalido}>
            {pendiente ? "Guardando…" : editando ? "Guardar cambios" : "Guardar texto"}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
