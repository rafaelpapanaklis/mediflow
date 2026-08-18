"use client";
/* ============================================================
   EL RUNTIME DE EDICIÓN. Vive DENTRO del iframe.

   Aquí están las afordancias: el texto que se convierte en campo al
   hacer clic y la botonera de cada foto. Están dentro del iframe a
   propósito — es un documento nuestro y del mismo origen, así que no
   hay que remapear ninguna coordenada, no hay overlay en el padre y
   no hay que reenviar la rueda ni el táctil. El archivo que se suelta
   aterriza donde vive el File.

   ── TEXTO ────────────────────────────────────────────────────
   Al hacer clic, el nodo SE SUSTITUYE EN FLUJO por un <textarea> con
   los estilos calculados copiados inline. Nada de contentEditable:
   ahí viven el caret, el pegado con HTML de Word, el IME español y el
   undo del navegador peleando con el nuestro.

   El campo es NO CONTROLADO (defaultValue): mientras se escribe no
   sale ni un mensaje, así que no hay eco, no hay debounce y el cursor
   no puede rebotar. Esc cancela; Enter (una línea) o salir del campo
   confirma, y ahí sí sale UN mensaje.

   ── QUÉ NO SE GUARDA ─────────────────────────────────────────
   Vaciar un campo manda null, nunca el texto por defecto de la
   plantilla. El default se ve atenuado como marcador de posición. Si
   se guardara, cambiar de plantilla arrastraría el copy de la
   anterior.

   ── CARGA ────────────────────────────────────────────────────
   Este archivo NO se importa nunca de forma estática: LivePreviewBridge
   lo trae con import() y solo bajo ?edit=1. Su chunk no toca /[slug].
   ============================================================ */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import {
  EditProviderRaw,
  type EditApi, type FotoParaEditar, type TextoParaEditar,
} from "./edit-context";
import { avisarAlEditor, leerRespuestaDeFoto } from "./edit-bus";
/* El manifiesto entra AQUÍ y no en las plantillas: este archivo solo se carga
   con import() dinámico bajo ?edit=1, así que ni él ni las ~230 etiquetas de
   los campos tocan nunca el bundle de /[slug]. */
import { etiquetaDeCampo, ranuraDeFoto } from "./edit-labels";

/* ------------------------------------------------------------------
   Estado compartido de la sesión de edición
   ------------------------------------------------------------------ */

interface Interno {
  slug: string;
  /** Qué plantilla se está pintando: decide cómo se llama cada campo. */
  tpl?: string | null;
  /** Hay un archivo sobrevolando el lienzo: las zonas de soltar se encienden. */
  arrastrando: boolean;
  /** Vista previa local por ranura, mientras el padre comprime y sube. */
  previas: Record<string, string>;
  mandarFoto: (slot: string, file: File) => void;
  quitarFoto: (slot: string) => void;
  mandarTexto: (campo: string, valor: string | null) => void;
}

const InternoCtx = createContext<Interno>(null as unknown as Interno);

const AZUL = "#2563eb";

/* ------------------------------------------------------------------
   TEXTO
   ------------------------------------------------------------------ */

/** Las propiedades que hacen que el <textarea> se lea igual que el nodo. */
const HEREDADAS = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariantNumeric",
  "lineHeight", "letterSpacing", "textAlign", "textTransform", "color",
  "wordSpacing",
  // El ancho: un titular con max-width:16ch se estiraría a todo el contenedor
  // y el texto cambiaría de saltos de línea al empezar a escribir.
  "maxWidth",
] as const;

function copiarEstilos(el: HTMLElement): CSSProperties {
  const c = window.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const k of HEREDADAS) out[k] = c[k as any] as string;
  return out as CSSProperties;
}

function margenesDe(el: HTMLElement): CSSProperties {
  const c = window.getComputedStyle(el);
  return { marginTop: c.marginTop, marginRight: c.marginRight, marginBottom: c.marginBottom, marginLeft: c.marginLeft };
}

/** Los "\n" del valor, pintados como <br/>. Igual que en edit-context.tsx. */
function conSaltos(s: string, multilinea?: boolean): ReactNode {
  if (!multilinea || !s.includes("\n")) return s;
  const out: ReactNode[] = [];
  s.split("\n").forEach((linea, i) => {
    if (i > 0) out.push(<br key={i} />);
    out.push(linea);
  });
  return out;
}

function TextoEditable({ t }: { t: TextoParaEditar }) {
  const { mandarTexto, slug, tpl } = useContext(InternoCtx);
  /* La etiqueta la resuelve el manifiesto por la dirección del campo. La
     plantilla solo la escribe cuando la dirección no basta. */
  const etq = t.etiqueta ?? etiquetaDeCampo(t.campo, tpl);
  const nodo = useRef<HTMLElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const [editando, setEditando] = useState(false);
  const [sobre, setSobre] = useState(false);
  const [largo, setLargo] = useState(0);
  const [estilos, setEstilos] = useState<{ texto: CSSProperties; margen: CSSProperties } | null>(null);

  /* Lo que se acaba de escribir, hasta que vuelve del padre por el parche.
     Sin esto se ve un fotograma con el texto viejo entre el clic fuera y el
     mensaje de vuelta. Se suelta en cuanto el valor de arriba coincide. */
  const [recien, setRecien] = useState<string | null | undefined>(undefined);
  useEffect(() => { setRecien(undefined); }, [t.valor]);
  useEffect(() => {
    if (recien === undefined) return;
    // Red de seguridad: si el padre descartó el cambio (un índice que ya no
    // existe), el valor de arriba no cambia nunca y esto se quedaría mintiendo.
    const id = setTimeout(() => setRecien(undefined), 2500);
    return () => clearTimeout(id);
  }, [recien]);

  const valorVivo = recien !== undefined ? recien : t.valor;
  /* Con valor propio se pinta ese; sin él, el texto por defecto de la
     plantilla — que es EXACTAMENTE lo que ve un paciente. Solo cuando no hay
     ni uno ni otro sale el marcador atenuado, que en la página pública no
     existe (ahí ese elemento sencillamente no se pinta). */
  const vacio = !(valorVivo && valorVivo.trim());
  const aPintar = !vacio ? (valorVivo as string) : (t.porDefecto ?? etq);
  const atenuado = vacio && t.porDefecto === null;

  function abrir() {
    const el = nodo.current;
    if (!el) return;
    setEstilos({ texto: copiarEstilos(el), margen: margenesDe(el) });
    setLargo((valorVivo ?? "").length);
    setEditando(true);
  }

  useEffect(() => {
    if (!editando) return;
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editando]);

  const cerrar = useCallback((confirmar: boolean) => {
    const el = campo.current;
    const crudo = el ? el.value : "";
    setEditando(false);
    if (!confirmar) return;
    const limpio = crudo.replace(/\r\n/g, "\n").trim();
    const nuevo = limpio === "" ? null : limpio;
    if (nuevo === null && t.requerido) {
      avisarAlEditor(slug, { kind: "aviso", texto: `«${etq}» no puede quedarse vacío.` });
      return;
    }
    if (nuevo === t.valor) return;
    setRecien(nuevo);
    mandarTexto(t.campo, nuevo);
  }, [mandarTexto, slug, t.campo, etq, t.requerido, t.valor]);

  if (editando && estilos) {
    const casiLleno = largo >= Math.floor(t.maxLen * 0.8);
    return (
      <span data-dc-ui="campo" style={{ position: "relative", display: "block", ...estilos.margen }}>
        <textarea
          ref={campo}
          defaultValue={valorVivo ?? ""}
          placeholder={etq}
          maxLength={t.maxLen}
          rows={1}
          spellCheck
          onInput={e => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
            setLargo(el.value.length);
          }}
          onBlur={() => cerrar(true)}
          onKeyDown={e => {
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrar(false); }
            else if (e.key === "Enter" && t.linea && !e.shiftKey) { e.preventDefault(); cerrar(true); }
          }}
          /* Nada de `font: inherit` aquí: la taquigrafía pisa fontSize,
             fontWeight y lineHeight, y un titular de 58 px se quedaba
             escribiéndose en 16. Los estilos copiados mandan. */
          style={{
            ...estilos.texto,
            display: "block", width: "100%", boxSizing: "border-box",
            margin: 0, padding: "2px 4px", border: 0, borderRadius: 4,
            background: "rgba(37,99,235,.07)", boxShadow: `0 0 0 2px ${AZUL}`,
            outline: "none", resize: "none", overflow: "hidden",
            minHeight: "1em",
          }}
        />
        {casiLleno && (
          <span style={{
            position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 60,
            font: "500 11px/1 ui-monospace, monospace", color: largo >= t.maxLen ? "#b91c1c" : "#6b7280",
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 4, padding: "3px 6px",
            whiteSpace: "nowrap",
          }}>
            {largo}/{t.maxLen}
          </span>
        )}
      </span>
    );
  }

  const { Tag, atributos } = t;
  const estiloBase = (atributos.style ?? {}) as CSSProperties;
  /* Lo pegado (`unido`) y los saltos de línea se pintan igual que en la
     página pública; el icono hermano (`antes`/`despues`) también, para que
     el botón se vea entero mientras no se está escribiendo. Cuando el texto
     está vacío y no hay default, sale el marcador atenuado a secas: pegarle
     un emoji o una flecha a "Escribe aquí" solo confunde. */
  const nucleo = atenuado
    ? aPintar
    : t.unido
      ? conSaltos(`${t.prefijo ?? ""}${aPintar}${t.sufijo ?? ""}`, t.multilinea)
      : (t.prefijo === undefined && t.sufijo === undefined)
        ? conSaltos(aPintar, t.multilinea)
        : <>{t.prefijo}{conSaltos(aPintar, t.multilinea)}{t.sufijo}</>;
  const hijo = atenuado || (t.antes === undefined && t.despues === undefined)
    ? nucleo
    : <>{t.antes}{nucleo}{t.despues}</>;

  return (
    <Tag
      {...atributos}
      ref={nodo}
      data-dc-txt={t.campo}
      title={`${etq} — clic para editar`}
      onClick={(e: any) => { e.preventDefault(); e.stopPropagation(); abrir(); }}
      onMouseEnter={() => setSobre(true)}
      onMouseLeave={() => setSobre(false)}
      style={{
        ...estiloBase,
        cursor: "text",
        borderRadius: 3,
        ...(atenuado ? { opacity: 0.55, fontStyle: "italic" } : null),
        ...(sobre ? { boxShadow: `0 0 0 2px ${AZUL}`, background: "rgba(37,99,235,.07)" } : null),
      }}
    >
      {hijo}
    </Tag>
  );
}

/* ------------------------------------------------------------------
   FOTO
   ------------------------------------------------------------------ */

const TIPOS_IMAGEN = /^image\//;

function Boton({ children, onClick, tono = "claro" }: { children: ReactNode; onClick: () => void; tono?: "claro" | "rojo" }) {
  return (
    <button
      type="button"
      data-dc-ui="foto"
      onClick={e => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      style={{
        pointerEvents: "auto", cursor: "pointer", border: 0, borderRadius: 7,
        font: "600 12.5px/1 var(--font-sans, system-ui)", padding: "8px 11px",
        background: tono === "rojo" ? "rgba(185,28,28,.92)" : "rgba(17,24,39,.86)",
        color: "#fff", backdropFilter: "blur(4px)", whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function FotoEditable({ f }: { f: FotoParaEditar }) {
  const { arrastrando, previas, mandarFoto, quitarFoto, slug, tpl } = useContext(InternoCtx);
  /* Igual que en el texto: el nombre de la ranura sale del manifiesto. */
  const meta = ranuraDeFoto(f.slot, tpl);
  const etq = f.etiqueta ?? meta.nombre;
  const ayuda = f.ayuda ?? meta.ayuda;
  const entrada = useRef<HTMLInputElement | null>(null);
  const [encima, setEncima] = useState(false);

  const url = previas[f.slot] ?? f.url;
  const subiendo = !!previas[f.slot];

  function tomar(file: File | null | undefined) {
    if (!file) return;
    if (!TIPOS_IMAGEN.test(file.type)) {
      avisarAlEditor(slug, { kind: "aviso", texto: "Eso no es una imagen. Sube un JPG, PNG o WebP." });
      return;
    }
    mandarFoto(f.slot, file);
  }

  const anclaje: CSSProperties =
    f.zona === "izquierda" ? { left: 0, width: "50%", top: 0, bottom: 0, alignItems: "flex-end", justifyContent: "flex-start" } :
    f.zona === "derecha"   ? { right: 0, width: "50%", top: 0, bottom: 0, alignItems: "flex-end", justifyContent: "flex-end" } :
                             { inset: 0, alignItems: "flex-start", justifyContent: "flex-start" };

  const zona = (
    <span
      data-dc-foto={f.slot}
      data-dc-zona={f.zona}
      /* El nombre de la ranura y su nota ("mismo encuadre que la de antes")
         estaban declarados en el manifiesto y no se enseñaban en ninguna
         parte. Ahora salen al pasar por encima del hueco. */
      title={ayuda ? `${etq} — ${ayuda}` : etq}
      onDragOver={e => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={e => {
        e.preventDefault();
        setEncima(false);
        tomar(e.dataTransfer?.files?.[0]);
      }}
      style={{
        position: "absolute", ...anclaje, zIndex: 30, display: "flex", gap: 8,
        padding: 12, borderRadius: 10,
        // Normalmente transparente a los clics: si no, taparía el texto que
        // hay encima de la foto (el titular del hero, por ejemplo). Solo se
        // vuelve zona de soltar mientras hay un archivo sobrevolando.
        pointerEvents: arrastrando ? "auto" : "none",
        background: encima ? "rgba(37,99,235,.28)" : "transparent",
        boxShadow: arrastrando ? `inset 0 0 0 2px ${encima ? AZUL : "rgba(37,99,235,.5)"}` : "none",
        transition: "background .12s",
      }}
    >
      <span style={{ display: "flex", gap: 8, alignItems: "center", pointerEvents: "none" }}>
        <Boton onClick={() => entrada.current?.click()}>
          {subiendo ? "Subiendo…" : f.url ? "Cambiar foto" : "Poner foto"}
        </Boton>
        {f.url && !subiendo && <Boton tono="rojo" onClick={() => quitarFoto(f.slot)}>Quitar</Boton>}
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          data-dc-ui="foto"
          onChange={e => { tomar(e.target.files?.[0]); e.target.value = ""; }}
          style={{ display: "none" }}
        />
      </span>
    </span>
  );

  const contenido = f.pintar(url);
  /* Sin foto, la plantilla no pinta nada y la caja se quedaría con 0 px de
     alto: no habría dónde soltar el archivo. El hueco punteado le da cuerpo
     y, de paso, dice que ahí va una foto. Solo en edición. */
  const hueco = !url && f.vacio
    ? <span aria-hidden="true" style={{
        display: "block", ...f.vacio,
        border: "2px dashed rgba(37,99,235,.45)", borderRadius: 12,
        background: "rgba(37,99,235,.05)",
      }} />
    : null;

  if (f.caja) {
    return <span style={{ display: "block", ...f.caja }}>{contenido}{hueco}{zona}</span>;
  }
  return <>{contenido}{hueco}{zona}</>;
}

/* ------------------------------------------------------------------
   EL PROVEEDOR
   ------------------------------------------------------------------ */

export function EditProvider({ slug, tpl, children }: { slug: string; tpl?: string | null; children: ReactNode }) {
  const [arrastrando, setArrastrando] = useState(false);
  const [previas, setPrevias] = useState<Record<string, string>>({});
  const previasRef = useRef(previas);
  useEffect(() => { previasRef.current = previas; }, [previas]);

  const soltarPrevia = useCallback((slot: string) => {
    setPrevias(p => {
      const anterior = p[slot];
      if (!anterior) return p;
      try { URL.revokeObjectURL(anterior); } catch { /* ya revocada */ }
      const { [slot]: _, ...resto } = p;
      return resto;
    });
  }, []);

  const mandarFoto = useCallback((slot: string, file: File) => {
    // Vista inmediata DENTRO del iframe: la clínica ve su foto antes de que
    // empiece a subir. El padre comprime y sube; al terminar contesta y
    // esta previa se suelta a favor de la url real.
    let local: string | null = null;
    try { local = URL.createObjectURL(file); } catch { local = null; }
    if (local) setPrevias(p => ({ ...p, [slot]: local as string }));
    avisarAlEditor(slug, { kind: "photo", slot, file });
  }, [slug]);

  const quitarFoto = useCallback((slot: string) => {
    soltarPrevia(slot);
    avisarAlEditor(slug, { kind: "photo-clear", slot });
  }, [slug, soltarPrevia]);

  const mandarTexto = useCallback((campo: string, valor: string | null) => {
    avisarAlEditor(slug, { kind: "edit", campo, valor });
  }, [slug]);

  /* ── el padre contesta cuando la foto subió (o no) ── */
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const r = leerRespuestaDeFoto(ev, slug);
      if (!r) return;
      soltarPrevia(r.slot);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [slug, soltarPrevia]);

  /* ── arrastrar un archivo enciende las zonas de soltar ── */
  useEffect(() => {
    let dentro = 0;
    const traeArchivo = (e: DragEvent) =>
      Array.prototype.includes.call(e.dataTransfer?.types ?? [], "Files");
    const entra = (e: DragEvent) => { if (traeArchivo(e)) { dentro++; setArrastrando(true); } };
    const sale  = () => { dentro = Math.max(0, dentro - 1); if (dentro === 0) setArrastrando(false); };
    const sobre = (e: DragEvent) => { if (traeArchivo(e)) e.preventDefault(); };
    const fin   = (e: DragEvent) => { dentro = 0; setArrastrando(false); e.preventDefault(); };
    window.addEventListener("dragenter", entra);
    window.addEventListener("dragleave", sale);
    window.addEventListener("dragover", sobre);
    window.addEventListener("drop", fin);
    return () => {
      window.removeEventListener("dragenter", entra);
      window.removeEventListener("dragleave", sale);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("drop", fin);
    };
  }, []);

  /* ── el lienzo no navega ────────────────────────────────────────
     Sin esto, editar el nombre de un servicio abre el modal de reserva y
     hacer clic en el menú se lleva el iframe a otra sección. En modo
     edición la página se mira y se edita, no se usa. Fase de captura para
     llegar antes que el onClick de la propia plantilla. */
  useEffect(() => {
    function guardia(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      if (t.closest("[data-dc-ui],[data-dc-txt]")) return;
      const interactivo = t.closest("a[href],button,summary,input,select,textarea,label");
      if (!interactivo) return;
      e.preventDefault();
      e.stopPropagation();
    }
    document.addEventListener("click", guardia, true);
    return () => document.removeEventListener("click", guardia, true);
  }, []);

  /* ── soltar las urls locales al desmontar ── */
  useEffect(() => () => {
    for (const u of Object.values(previasRef.current)) {
      try { URL.revokeObjectURL(u); } catch { /* ya revocada */ }
    }
  }, []);

  const interno = useMemo<Interno>(
    () => ({ slug, tpl, arrastrando, previas, mandarFoto, quitarFoto, mandarTexto }),
    [slug, tpl, arrastrando, previas, mandarFoto, quitarFoto, mandarTexto],
  );

  // Estable a propósito: todo el estado viaja por InternoCtx, así que cambiar
  // de foto o arrastrar un archivo no obliga a repintar la plantilla entera.
  const api = useMemo<EditApi>(() => ({
    texto: (t: TextoParaEditar) => <TextoEditable t={t} />,
    foto:  (f: FotoParaEditar) => <FotoEditable f={f} />,
  }), []);

  return (
    <InternoCtx.Provider value={interno}>
      <EditProviderRaw value={api}>{children}</EditProviderRaw>
    </InternoCtx.Provider>
  );
}

export default EditProvider;
