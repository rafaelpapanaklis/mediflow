"use client";

// La barra de herramientas del editor de documentos y sus barras contextuales
// (tabla, imagen, línea de firma). Cada botón es un comando de Tiptap; el estado
// (qué está activo) sale de `useEditorState`, que solo vuelve a pintar cuando
// cambia algo de lo que se mira. mousedown con preventDefault: la hoja nunca
// pierde la selección al pulsar un botón.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, BetweenHorizontalEnd, BetweenHorizontalStart,
  BetweenVerticalEnd, BetweenVerticalStart, Bold, Columns2, Columns3, Eye, EyeOff, ImagePlus,
  IndentDecrease, IndentIncrease, Italic, List, ListOrdered, Loader2, Merge, PanelTop, PenLine,
  Redo2, ScissorsLineDashed, Table, Tag, Trash2, Underline, Undo2, X, type LucideIcon,
} from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { TAMANOS, TAMANO_BASE, type Alineacion, type Tamano } from "./contrato";
import type { MarcadorEditor } from "./tipos";

type Estilos = Record<string, string>;

export interface BarraProps {
  editor: Editor;
  s: Estilos;
  marcadores: readonly MarcadorEditor[];
  /** Hay forma de subir imágenes (onSubirImagen): si no, el botón no se muestra. */
  conImagen: boolean;
  subiendoImagen: boolean;
  onElegirImagen: () => void;
  /** El micrófono real (DictationMic) o nada. */
  dictado?: ReactNode;
  conDatos: boolean;
  onConDatos: (on: boolean) => void;
  desactivado?: boolean;
}

const ALINEACIONES: { v: Alineacion; icono: LucideIcon; clave: string }[] = [
  { v: "izquierda", icono: AlignLeft, clave: "alinearIzquierda" },
  { v: "centro", icono: AlignCenter, clave: "centrar" },
  { v: "derecha", icono: AlignRight, clave: "alinearDerecha" },
  { v: "justificado", icono: AlignJustify, clave: "justificar" },
];

function Boton({
  s, icono: Icono, etiqueta, activo, desactivado, onClick, texto, atajo, className,
}: {
  s: Estilos;
  icono?: LucideIcon;
  etiqueta: string;
  activo?: boolean;
  desactivado?: boolean;
  onClick: () => void;
  texto?: string;
  atajo?: string;
  className?: string;
}) {
  const titulo = atajo ? `${etiqueta} (${atajo})` : etiqueta;
  return (
    <button
      type="button"
      className={[s.boton, texto ? s.botonTexto : "", activo ? s.botonActivo : "", className ?? ""].join(" ")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={desactivado}
      aria-pressed={activo === undefined ? undefined : activo}
      aria-label={titulo}
      title={titulo}
    >
      {Icono ? <Icono size={18} aria-hidden /> : null}
      {texto ? <span>{texto}</span> : null}
    </button>
  );
}

/** Un botón con desplegable. Se cierra al pulsar fuera, con Escape o al elegir. */
function Menu({
  s, icono: Icono, etiqueta, texto, children, desactivado,
}: {
  s: Estilos;
  icono: LucideIcon;
  etiqueta: string;
  texto?: string;
  children: (cerrar: () => void) => ReactNode;
  desactivado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);
  return (
    <div className={s.menu} ref={raiz}>
      <button
        type="button"
        className={[s.boton, texto ? s.botonTexto : "", abierto ? s.botonActivo : ""].join(" ")}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAbierto((v) => !v)}
        disabled={desactivado}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label={etiqueta}
        title={etiqueta}
      >
        <Icono size={18} aria-hidden />
        {texto ? <span>{texto}</span> : null}
      </button>
      {abierto ? (
        <div className={s.desplegable} role="menu" onMouseDown={(e) => e.preventDefault()}>
          {children(() => setAbierto(false))}
        </div>
      ) : null}
    </div>
  );
}

/** La rejilla para elegir filas × columnas de una tabla nueva. */
function RejillaTabla({ s, onElegir }: { s: Estilos; onElegir: (filas: number, columnas: number) => void }) {
  const t = useT();
  const [sobre, setSobre] = useState<{ f: number; c: number }>({ f: 3, c: 3 });
  const FILAS = 5;
  const COLS = 6;
  return (
    <div>
      <div className={s.rejillaTexto}>
        {t("editorDocumento.barra.insertarTabla")} · {sobre.f} × {sobre.c}
      </div>
      <div className={s.rejilla} role="grid" aria-label={t("editorDocumento.barra.insertarTabla")}>
        {Array.from({ length: FILAS * COLS }, (_, i) => {
          const f = Math.floor(i / COLS) + 1;
          const c = (i % COLS) + 1;
          const on = f <= sobre.f && c <= sobre.c;
          return (
            <button
              type="button"
              key={i}
              role="gridcell"
              className={[s.rejillaCelda, on ? s.rejillaOn : ""].join(" ")}
              aria-label={`${f} × ${c}`}
              onMouseEnter={() => setSobre({ f, c })}
              onFocus={() => setSobre({ f, c })}
              onClick={() => onElegir(f, c)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function Barra({
  editor, s, marcadores, conImagen, subiendoImagen, onElegirImagen, dictado, conDatos, onConDatos, desactivado,
}: BarraProps) {
  const t = useT();
  const estado = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      estilo: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      tamano: (e.getAttributes("tamano").tamano as string | undefined) ?? TAMANO_BASE,
      alineacion: ((e.getAttributes("paragraph").alineacion ?? e.getAttributes("heading").alineacion) as
        | Alineacion
        | undefined) ?? "izquierda",
      puedeDeshacer: e.can().undo(),
      puedeRehacer: e.can().redo(),
      enTabla: e.isActive("table"),
      enFirma: e.isActive("lineaFirma"),
      ladoFirma: (e.getAttributes("lineaFirma").lado as string | undefined) ?? "izquierda",
      imagen: e.state.selection instanceof NodeSelection && e.state.selection.node.type.name === "imagen",
      anchoImagen: (e.getAttributes("imagen").ancho as string | undefined) ?? "medio",
      ladoImagen: (e.getAttributes("imagen").alineacion as string | undefined) ?? "centro",
      enLista: e.isActive("listItem"),
      enColumnas: e.isActive("columnas"),
    }),
  });
  const ch = () => editor.chain().focus();
  const B = (k: string) => t(`editorDocumento.barra.${k}`);

  return (
    <>
      <div className={s.barra} role="toolbar" aria-label={B("formato")} aria-disabled={desactivado || undefined}>
        <div className={s.grupo}>
          <Boton s={s} icono={Undo2} etiqueta={B("deshacer")} atajo="Ctrl Z" desactivado={desactivado || !estado.puedeDeshacer} onClick={() => ch().undo().run()} />
          <Boton s={s} icono={Redo2} etiqueta={B("rehacer")} atajo="Ctrl Y" desactivado={desactivado || !estado.puedeRehacer} onClick={() => ch().redo().run()} />
        </div>

        <div className={s.grupo}>
          <select
            className={s.selector}
            value={estado.estilo}
            disabled={desactivado}
            aria-label={B("estilo")}
            title={B("estilo")}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") ch().setParagraph().run();
              else ch().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
            }}
          >
            <option value="p">{B("estiloNormal")}</option>
            <option value="h1">{B("estiloTitulo")}</option>
            <option value="h2">{B("estiloSubtitulo")}</option>
            <option value="h3">{B("estiloApartado")}</option>
          </select>
          <select
            className={[s.selector, s.selectorTamano].join(" ")}
            value={estado.tamano}
            disabled={desactivado}
            aria-label={B("tamano")}
            title={B("tamano")}
            onChange={(e) => ch().setTamano(e.target.value as Tamano).run()}
          >
            {TAMANOS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>

        <div className={s.grupo}>
          <Boton s={s} icono={Bold} etiqueta={B("negrita")} atajo="Ctrl B" activo={estado.bold} desactivado={desactivado} onClick={() => ch().toggleBold().run()} />
          <Boton s={s} icono={Italic} etiqueta={B("cursiva")} atajo="Ctrl I" activo={estado.italic} desactivado={desactivado} onClick={() => ch().toggleItalic().run()} />
          <Boton s={s} icono={Underline} etiqueta={B("subrayado")} atajo="Ctrl U" activo={estado.underline} desactivado={desactivado} onClick={() => ch().toggleUnderline().run()} />
        </div>

        <div className={s.grupo}>
          {ALINEACIONES.map((a) => (
            <Boton key={a.v} s={s} icono={a.icono} etiqueta={B(a.clave)} activo={estado.alineacion === a.v} desactivado={desactivado} onClick={() => ch().alinear(a.v).run()} />
          ))}
        </div>

        <div className={s.grupo}>
          <Boton s={s} icono={IndentDecrease} etiqueta={B("quitarSangria")} atajo="Shift Tab" desactivado={desactivado} onClick={() => (estado.enLista ? ch().liftListItem("listItem").run() : ch().sangriaMenos().run())} />
          <Boton s={s} icono={IndentIncrease} etiqueta={B("sangria")} atajo="Tab" desactivado={desactivado} onClick={() => (estado.enLista ? ch().sinkListItem("listItem").run() : ch().sangriaMas().run())} />
          <Boton s={s} icono={List} etiqueta={B("vinetas")} activo={estado.bullet} desactivado={desactivado} onClick={() => ch().toggleBulletList().run()} />
          <Boton s={s} icono={ListOrdered} etiqueta={B("numerada")} activo={estado.ordered} desactivado={desactivado} onClick={() => ch().toggleOrderedList().run()} />
        </div>

        <div className={s.grupo}>
          <Menu s={s} icono={Table} etiqueta={B("tabla")} desactivado={desactivado}>
            {(cerrar) => (
              <RejillaTabla
                s={s}
                onElegir={(filas, columnas) => {
                  ch().insertTable({ rows: filas, cols: columnas, withHeaderRow: true }).run();
                  cerrar();
                }}
              />
            )}
          </Menu>
          <Menu s={s} icono={Columns2} etiqueta={B("columnas")} desactivado={desactivado}>
            {(cerrar) => (
              <>
                <button type="button" role="menuitem" className={s.opcion} onClick={() => { ch().insertarColumnas(2).run(); cerrar(); }}>
                  <Columns2 size={16} aria-hidden /> {B("dosColumnas")}
                </button>
                <button type="button" role="menuitem" className={s.opcion} onClick={() => { ch().insertarColumnas(3).run(); cerrar(); }}>
                  <Columns3 size={16} aria-hidden /> {B("tresColumnas")}
                </button>
                <div className={s.separador} role="separator" />
                <button type="button" role="menuitem" className={s.opcion} disabled={!estado.enColumnas} onClick={() => { ch().quitarColumnas().run(); cerrar(); }}>
                  <X size={16} aria-hidden /> {B("quitarColumnas")}
                </button>
              </>
            )}
          </Menu>
          {conImagen ? (
            <Boton
              s={s}
              icono={subiendoImagen ? Loader2 : ImagePlus}
              etiqueta={subiendoImagen ? t("editorDocumento.imagen.subiendo") : B("imagen")}
              desactivado={desactivado || subiendoImagen}
              onClick={onElegirImagen}
              className={subiendoImagen ? s.girando : ""}
            />
          ) : null}
          <Boton s={s} icono={PenLine} etiqueta={B("lineaFirma")} activo={estado.enFirma} desactivado={desactivado} onClick={() => ch().insertarLineaFirma(t("editorDocumento.firma.textoInicial")).run()} />
          <Boton s={s} icono={ScissorsLineDashed} etiqueta={B("saltoPagina")} atajo="Ctrl Enter" desactivado={desactivado} onClick={() => ch().insertarSalto().run()} />
        </div>

        <div className={s.grupo}>
          <Menu s={s} icono={Tag} etiqueta={B("menuMarcadores")} texto={B("marcador")} desactivado={desactivado}>
            {(cerrar) => (
              <>
                {marcadores.map((m) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={m.clave}
                    className={s.opcion}
                    data-marcador={m.clave}
                    onClick={() => {
                      ch().insertarMarcador(m.clave).run();
                      cerrar();
                    }}
                  >
                    <Tag size={14} aria-hidden />
                    <span>{m.etiqueta}</span>
                    <small>{m.ejemplo}</small>
                  </button>
                ))}
              </>
            )}
          </Menu>
          {dictado ? <span className={s.dictado}>{dictado}</span> : null}
        </div>

        <div className={s.grupo}>
          <Boton
            s={s}
            icono={conDatos ? EyeOff : Eye}
            etiqueta={conDatos ? B("verMarcadores") : B("verConDatos")}
            texto={conDatos ? B("verMarcadores") : B("verConDatos")}
            activo={conDatos}
            onClick={() => onConDatos(!conDatos)}
          />
        </div>
      </div>

      {estado.enTabla ? (
        <div className={s.contextual} role="toolbar" aria-label={t("editorDocumento.tabla.titulo")}>
          <b>{t("editorDocumento.tabla.titulo")}</b>
          <Boton s={s} icono={BetweenHorizontalStart} etiqueta={t("editorDocumento.tabla.filaArriba")} onClick={() => ch().addRowBefore().run()} />
          <Boton s={s} icono={BetweenHorizontalEnd} etiqueta={t("editorDocumento.tabla.filaAbajo")} onClick={() => ch().addRowAfter().run()} />
          <Boton s={s} icono={BetweenVerticalStart} etiqueta={t("editorDocumento.tabla.columnaIzquierda")} onClick={() => ch().addColumnBefore().run()} />
          <Boton s={s} icono={BetweenVerticalEnd} etiqueta={t("editorDocumento.tabla.columnaDerecha")} onClick={() => ch().addColumnAfter().run()} />
          <Boton s={s} etiqueta={t("editorDocumento.tabla.quitarFila")} texto={t("editorDocumento.tabla.quitarFilaCorto")} onClick={() => ch().deleteRow().run()} />
          <Boton s={s} etiqueta={t("editorDocumento.tabla.quitarColumna")} texto={t("editorDocumento.tabla.quitarColumnaCorto")} onClick={() => ch().deleteColumn().run()} />
          <Boton s={s} icono={PanelTop} etiqueta={t("editorDocumento.tabla.encabezado")} onClick={() => ch().toggleHeaderRow().run()} />
          <Boton s={s} icono={Merge} etiqueta={t("editorDocumento.tabla.unir")} onClick={() => ch().mergeOrSplit().run()} />
          <Boton s={s} icono={Trash2} etiqueta={t("editorDocumento.tabla.quitarTabla")} onClick={() => ch().deleteTable().run()} />
        </div>
      ) : null}

      {estado.imagen ? (
        <div className={s.contextual} role="toolbar" aria-label={t("editorDocumento.imagen.titulo")}>
          <b>{t("editorDocumento.imagen.titulo")}</b>
          {(["chico", "medio", "completo"] as const).map((v) => (
            <Boton key={v} s={s} etiqueta={t(`editorDocumento.imagen.${v}`)} texto={t(`editorDocumento.imagen.${v}`)} activo={estado.anchoImagen === v} onClick={() => ch().anchoImagen(v).run()} />
          ))}
          <span className={s.separadorVertical} aria-hidden />
          <Boton s={s} icono={AlignLeft} etiqueta={t("editorDocumento.imagen.izquierda")} activo={estado.ladoImagen === "izquierda"} onClick={() => ch().ladoImagen("izquierda").run()} />
          <Boton s={s} icono={AlignCenter} etiqueta={t("editorDocumento.imagen.centro")} activo={estado.ladoImagen === "centro"} onClick={() => ch().ladoImagen("centro").run()} />
          <Boton s={s} icono={AlignRight} etiqueta={t("editorDocumento.imagen.derecha")} activo={estado.ladoImagen === "derecha"} onClick={() => ch().ladoImagen("derecha").run()} />
          <Boton s={s} icono={Trash2} etiqueta={t("editorDocumento.imagen.quitar")} onClick={() => ch().deleteSelection().run()} />
        </div>
      ) : null}

      {estado.enFirma ? (
        <div className={s.contextual} role="toolbar" aria-label={t("editorDocumento.firma.titulo")}>
          <b>{t("editorDocumento.firma.titulo")}</b>
          {(["izquierda", "centro", "derecha"] as const).map((v) => (
            <Boton key={v} s={s} etiqueta={t(`editorDocumento.firma.${v}`)} texto={t(`editorDocumento.firma.${v}`)} activo={estado.ladoFirma === v} onClick={() => ch().ladoFirma(v).run()} />
          ))}
          <Boton s={s} icono={Trash2} etiqueta={t("editorDocumento.firma.quitar")} onClick={() => ch().quitarLineaFirma().run()} />
          <span className={s.contextualAyuda}>{t("editorDocumento.firma.ayuda")}</span>
        </div>
      ) : null}
    </>
  );
}
