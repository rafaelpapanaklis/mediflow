"use client";

// EditorDocumento: el mismo editor para plantillas, notas de evolución y
// consentimientos. Una hoja Carta de verdad (membrete de la clínica en todas las
// hojas, paciente/doctor solo en la primera, pie «clínica · tipo · Página n de m»),
// la barra completa, marcadores como fichas, dictado en el cursor y HTML
// normalizado al contrato al guardar. Tiptap 3 (MIT); nada de pago.
//
// Se carga SIEMPRE por `./index.tsx` (next/dynamic sin SSR): Tiptap necesita el
// DOM. Este archivo no se importa desde un server component.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import toast from "react-hot-toast";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { DictationMic } from "@/components/clinical/shared/dictation-mic";
import { textoParaInsertar } from "@/components/dashboard/nota-evolucion/dictado";
import { HOJA_CARTA, variablesCssHoja } from "@/lib/documentos/hoja-carta";
import { IMAGEN_MAX_BYTES, IMAGEN_MAX_POR_DOCUMENTO } from "@/lib/documentos/limites-imagen";
import { tipoDeclarado } from "@/lib/documentos/imagenes";
import { Barra } from "./barra";
import { contarImagenes, extensionesDocumento, type MedidaPaginacion } from "./extensiones";
import { estaVacioHtml, htmlParaEditor, normalizarParaGuardar } from "./html";
import { cerrarCorteSiBloqueVacio, limpiarPegado } from "./pegado";
import { mensajeDeSubida } from "./subida";
import type { EditorDocumentoApi, EditorDocumentoProps, EstadoEditor, MembreteDocumento } from "./tipos";
import s from "./editor-documento.module.css";

/** Por debajo de este ancho la hoja es fluida y no se dibujan los saltos de hoja. */
export const ANCHO_ANGOSTO_PX = 860;
const CONSULTA_ANGOSTO = `(max-width: ${ANCHO_ANGOSTO_PX}px)`;

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** El membrete de la clínica: logo (si hay), nombre, dirección y teléfono; la fecha a la derecha. */
export function Membrete({ membrete, etiquetaFecha }: { membrete: MembreteDocumento; etiquetaFecha: string }) {
  const m = membrete;
  return (
    <div className={s.membrete}>
      <div className={s.membreteIzq}>
        {m.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL del logo de la clínica, dominio no fijo
          <img src={m.logoUrl} alt="" className={s.logo} />
        ) : (
          <div className={s.logoIniciales} aria-hidden>
            {iniciales(m.clinicaNombre)}
          </div>
        )}
        <div className={s.membreteTextos}>
          <p className={s.clinica}>{m.clinicaNombre}</p>
          {m.clinicaDireccion ? <p className={s.clinicaDato}>{m.clinicaDireccion}</p> : null}
          {m.clinicaTelefono ? <p className={s.clinicaDato}>{m.clinicaTelefono}</p> : null}
        </div>
      </div>
      <div className={s.fecha}>
        <span className={s.etiqueta}>{etiquetaFecha}</span>
        <span className={s.valor}>{m.fecha}</span>
      </div>
    </div>
  );
}

export function EditorDocumentoInterno(props: EditorDocumentoProps) {
  const {
    contexto, html, membrete, tipoDocumento, titulo, primeraPagina, marcadores, onChange, onPaginas, alListo,
    onSubirImagen, dictado = true, desactivado = false, autoFoco = false, placeholder, idEtiqueta,
  } = props;
  const t = useT();
  const locale = useLocale();

  // Lo último de todo, para que las extensiones (creadas una vez) lean siempre lo de ahora.
  const ultimo = useRef({ membrete, tipoDocumento, t, onChange, onPaginas, alListo, onSubirImagen, locale });
  ultimo.current = { membrete, tipoDocumento, t, onChange, onPaginas, alListo, onSubirImagen, locale };

  const cabeceraRef = useRef<HTMLDivElement>(null);
  const primeraExtraRef = useRef<HTMLDivElement>(null);
  const rellenoRef = useRef<HTMLDivElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const angostoRef = useRef(false);
  const paginasRef = useRef(-1); // -1: la primera medida siempre avisa

  const [angosto, setAngosto] = useState(false);
  const [paginas, setPaginas] = useState(1);
  const [conDatos, setConDatos] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_ANGOSTO);
    const aplicar = () => {
      angostoRef.current = mq.matches;
      setAngosto(mq.matches);
    };
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  // Por contenido, no por identidad: quien monta el editor puede pasar un arreglo
  // nuevo en cada render, y eso NO debe rearmar el esquema (se perdería lo escrito).
  const claveMarcadores = JSON.stringify(marcadores);
  const etiquetas = useMemo(
    () => Object.fromEntries(marcadores.map((m) => [m.clave, { etiqueta: m.etiqueta, ejemplo: m.ejemplo }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claveMarcadores],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const claves = useMemo(() => marcadores.map((m) => m.clave), [claveMarcadores]);
  const editorRef = useRef<Editor | null>(null);

  const emitir = useCallback((e: Editor) => {
    const fn = ultimo.current.onChange;
    if (!fn) return;
    const limpio = normalizarParaGuardar(e.getHTML());
    const estado: EstadoEditor = { html: limpio, vacio: estaVacioHtml(limpio) };
    fn(estado);
  }, []);

  const alMedir = useCallback(({ paginas: n, relleno }: MedidaPaginacion) => {
    if (rellenoRef.current) rellenoRef.current.style.height = `${Math.max(0, Math.round(relleno))}px`;
    if (paginasRef.current !== n) {
      paginasRef.current = n;
      setPaginas(n);
      ultimo.current.onPaginas?.(n);
    }
  }, []);

  const extensions = useMemo(
    () =>
      extensionesDocumento({
        marcadores: etiquetas,
        textos: { placeholder: placeholder ?? t("editorDocumento.hoja.placeholder"), nuevaPagina: t("editorDocumento.hoja.nuevaPagina") },
        clases: { marcador: s.marcador, imagen: s.imagen, saltoManual: s.saltoManual, saltoRotulo: s.saltoRotulo },
        paginacion: {
          activa: () => !angostoRef.current,
          extraPrimera: () => primeraExtraRef.current?.getBoundingClientRect().height ?? 0,
          cabecera: () => cabeceraRef.current,
          textoPie: () => `${ultimo.current.membrete.clinicaNombre} · ${ultimo.current.tipoDocumento}`,
          textoPagina: (n, total) => ultimo.current.t("editorDocumento.hoja.pagina", { n, total }),
          alMedir,
          clases: { salto: s.saltoAuto, pieHoja: s.pieHoja, pieRenglon: s.pieRenglon, mesa: s.mesaEntre },
        },
      }),
    // El esquema se arma una vez por idioma (las etiquetas de las fichas van dentro).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, etiquetas],
  );

  // ── Imágenes: tipo, tamaño y tope por documento se miran ANTES de subir ──
  const subirImagen = useCallback(async (editor: Editor, archivo: File) => {
    const subir = ultimo.current.onSubirImagen;
    const tt = ultimo.current.t;
    if (!subir) return;
    // El tipo que DECLARA el archivo, como lo mira P4: un HEIC de Windows llega sin `type` y vale por su extensión.
    if (!tipoDeclarado(archivo)) {
      toast.error(tt("editorDocumento.imagen.tipoNoValido"));
      return;
    }
    if (archivo.size > IMAGEN_MAX_BYTES) {
      toast.error(tt("editorDocumento.imagen.demasiadoGrande", { mb: Math.round(IMAGEN_MAX_BYTES / (1024 * 1024)) }));
      return;
    }
    if (contarImagenes(editor.state.doc) >= IMAGEN_MAX_POR_DOCUMENTO) {
      toast.error(tt("editorDocumento.imagen.tope", { n: IMAGEN_MAX_POR_DOCUMENTO }));
      return;
    }
    setSubiendo(true);
    try {
      const { clave } = await subir(archivo);
      if (editor.isDestroyed) return;
      if (!editor.chain().focus().insertarImagen({ archivo: clave }).run()) {
        toast.error(tt("editorDocumento.imagen.errorSubida"));
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return; // la persona canceló
      console.error("[editor-documento] subir imagen:", err);
      toast.error(mensajeDeSubida(err, tt, ultimo.current.locale));
    } finally {
      setSubiendo(false);
    }
  }, []);

  const archivosDeImagen = (lista: FileList | File[] | null | undefined): File[] =>
    Array.from(lista ?? []).filter((f) => f.type.startsWith("image/") || tipoDeclarado(f) !== null);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions,
      content: htmlParaEditor(html, claves),
      editable: !desactivado,
      editorProps: {
        attributes: {
          class: s.prose,
          spellcheck: "true",
          lang: locale,
          role: "textbox",
          "aria-multiline": "true",
          ...(idEtiqueta ? { "aria-labelledby": idEtiqueta } : {}),
        },
        transformPastedHTML: limpiarPegado,
        transformPasted: cerrarCorteSiBloqueVacio,
        handlePaste: (view, evento) => {
          const archivos = archivosDeImagen(evento.clipboardData?.files);
          if (!archivos.length || !ultimo.current.onSubirImagen) return false;
          evento.preventDefault();
          const e = editorRef.current;
          if (e) void subirImagen(e, archivos[0]);
          return true;
        },
        handleDrop: (view, evento) => {
          const archivos = archivosDeImagen((evento as DragEvent).dataTransfer?.files);
          if (!archivos.length || !ultimo.current.onSubirImagen) return false;
          evento.preventDefault();
          const e = editorRef.current;
          if (!e) return true;
          const pos = view.posAtCoords({ left: (evento as DragEvent).clientX, top: (evento as DragEvent).clientY });
          if (pos) e.commands.setTextSelection(pos.pos);
          void subirImagen(e, archivos[0]);
          return true;
        },
      },
      onUpdate: ({ editor: e }) => emitir(e),
      onCreate: ({ editor: e }) => {
        editorRef.current = e;
        // El de fuera conoce desde el principio el HTML normalizado (para saber luego si cambió).
        emitir(e);
        if (autoFoco) e.commands.focus("start");
      },
    },
    [extensions],
  );
  editorRef.current = editor;

  // Lo que el de fuera puede pedir, entregado una vez que el editor existe.
  useEffect(() => {
    if (!editor) return;
    const api: EditorDocumentoApi = {
      obtenerHtml: () => normalizarParaGuardar(editor.getHTML()),
      estaVacio: () => estaVacioHtml(normalizarParaGuardar(editor.getHTML())),
      enfocar: () => editor.commands.focus(),
      insertarMarcador: (clave) => {
        editor.chain().focus().insertarMarcador(clave).run();
      },
      insertarTexto: (texto) => insertarTexto(editor, texto),
      verConDatos: (on) => setConDatos(on),
    };
    ultimo.current.alListo?.(api);
  }, [editor]);

  useEffect(() => {
    editor?.setEditable(!desactivado);
  }, [editor, desactivado]);

  // Lo dictado entra en el cursor (después de la selección, nunca encima) con el
  // espacio que haga falta; respeta el formato de alrededor.
  function insertarTexto(e: Editor, texto: string) {
    const { to } = e.state.selection;
    const antes = e.state.doc.textBetween(Math.max(0, to - 200), to, " ");
    const limpio = textoParaInsertar(antes, texto);
    if (!limpio) return;
    e.chain()
      .focus()
      .setTextSelection(to)
      .command(({ tr }) => {
        tr.insertText(limpio);
        return true;
      })
      .run();
  }

  const estiloHoja = useMemo(() => variablesCssHoja(HOJA_CARTA) as CSSProperties, []);
  const pie = `${membrete.clinicaNombre} · ${tipoDocumento}`;

  return (
    <div
      className={[CLASES_MENU, s.raiz, conDatos ? s.conDatos : "", angosto ? s.angosto : ""].join(" ")}
      data-contexto={contexto}
      style={estiloHoja}
    >
      {editor ? (
        <Barra
          editor={editor}
          s={s}
          marcadores={marcadores}
          conImagen={Boolean(onSubirImagen)}
          subiendoImagen={subiendo}
          onElegirImagen={() => archivoRef.current?.click()}
          dictado={dictado ? <DictationMic onText={(texto) => insertarTexto(editor, texto)} disabled={desactivado} /> : null}
          conDatos={conDatos}
          onConDatos={setConDatos}
          desactivado={desactivado}
        />
      ) : (
        <div className={s.barra} aria-hidden />
      )}
      {onSubirImagen ? (
        <input
          ref={archivoRef}
          type="file"
          accept={IMAGEN_TIPOS.join(",")}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f && editor) void subirImagen(editor, f);
          }}
        />
      ) : null}

      {angosto ? <p className={s.avisoAngosto}>{t("editorDocumento.hoja.avisoAngosto")}</p> : null}

      <div className={s.pila}>
        <div className={s.hoja} data-paginas={paginas || undefined}>
          <div className={s.cabecera} ref={cabeceraRef}>
            <Membrete membrete={membrete} etiquetaFecha={t("editorDocumento.hoja.fecha")} />
            <div className={s.filete} aria-hidden />
          </div>
          <div className={s.primeraExtra} ref={primeraExtraRef}>
            {primeraPagina ?? null}
            <p className={s.sello}>{tipoDocumento}</p>
            {titulo ?? null}
            <div className={s.separa} aria-hidden />
          </div>
          <div className={s.cuerpo}>
            {editor ? <EditorContent editor={editor} /> : <div className={s.esqueletoCuerpo} aria-hidden />}
          </div>
          <div className={s.rellenoFinal} ref={rellenoRef} aria-hidden />
          {!angosto ? (
            <div className={s.pieUltimo} aria-hidden>
              <div className={s.pieHoja}>
                <div className={s.pieRenglon}>
                  <span>{pie}</span>
                  <span>{t("editorDocumento.hoja.pagina", { n: paginas || 1, total: paginas || 1 })}</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

