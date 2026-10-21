// Paginación VISUAL: la hoja se ve como las hojas que serán. Un plugin de
// ProseMirror mide cada bloque de primer nivel y, donde la hoja se llena (o
// donde hay un «Nueva página»), pinta ENTRE bloques un salto de hoja: el pie de
// la hoja n, la mesa, y el membrete de la hoja n+1 (decisión 3 de Rafael:
// membrete completo en todas). Son decoraciones: no tocan el documento, no se
// guardan, y en papel no existen (el PDF corta con las mismas medidas).
//
// Dónde cortar lo decide `paginar` (src/lib/documentos/hoja-carta.ts), que es
// puro y está probado; aquí solo se mide el DOM y se pintan los widgets.
// Corta entre bloques, no dentro de un párrafo: un párrafo más alto que el hueco
// se va entero a la hoja siguiente (el PDF sí lo parte, con orphans/widows).

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { altoUtil, paginar, type BloqueMedido } from "@/lib/documentos/hoja-carta";

export interface MedidaPaginacion {
  /** Cuántas hojas se ven. 0 = la hoja es fluida (pantalla angosta) y no se pagina. */
  paginas: number;
  /** Lo que sobra en la última hoja, para que el papel termine donde termina. */
  relleno: number;
}

export interface PaginacionOptions {
  /** `false` en pantalla angosta: la hoja es fluida y no se dibujan saltos. */
  activa: () => boolean;
  /** Alto, en px, de lo que va en la primera hoja antes del texto (paciente/doctor, sello, título). */
  extraPrimera: () => number;
  /** El membrete (y su filete) de la hoja, para clonarlo en cada salto. */
  cabecera: () => HTMLElement | null;
  /** «Clínica Dental Altavista · Nota de evolución». */
  textoPie: () => string;
  /** «Página 2 de 3». */
  textoPagina: (n: number, total: number) => string;
  /** Se llama tras cada medición (puede ser con los mismos números). */
  alMedir: (m: MedidaPaginacion) => void;
  clases: { salto: string; pieHoja: string; pieRenglon: string; mesa: string };
}

export const clavePaginacion = new PluginKey<EstadoPaginacion>("paginacionDocumento");

interface EstadoPaginacion {
  saltos: number[];
  set: DecorationSet;
}

const px = (v: string) => parseFloat(v) || 0;

export const Paginacion = Extension.create<PaginacionOptions>({
  name: "paginacion",

  addOptions() {
    return {
      activa: () => true,
      extraPrimera: () => 0,
      cabecera: () => null,
      textoPie: () => "",
      textoPagina: (n, total) => `${n} / ${total}`,
      alMedir: () => {},
      clases: { salto: "saltoAuto", pieHoja: "pieHoja", pieRenglon: "pieRenglon", mesa: "mesaEntre" },
    };
  },

  addProseMirrorPlugins() {
    const opciones = this.options;

    const crearSalto = (n: number, total: number): HTMLElement => {
      const el = document.createElement("div");
      el.className = opciones.clases.salto;
      el.contentEditable = "false";
      el.setAttribute("aria-hidden", "true");
      const pie = document.createElement("div");
      pie.className = opciones.clases.pieHoja;
      const renglon = document.createElement("div");
      renglon.className = opciones.clases.pieRenglon;
      const izq = document.createElement("span");
      izq.textContent = opciones.textoPie();
      const der = document.createElement("span");
      der.textContent = opciones.textoPagina(n, total);
      renglon.append(izq, der);
      pie.appendChild(renglon);
      const mesa = document.createElement("div");
      mesa.className = opciones.clases.mesa;
      el.append(pie, mesa);
      const cab = opciones.cabecera();
      if (cab) {
        const clon = cab.cloneNode(true) as HTMLElement;
        clon.removeAttribute("id");
        el.appendChild(clon);
      }
      return el;
    };

    const decoraciones = (doc: Parameters<typeof DecorationSet.create>[0], saltos: number[]): DecorationSet => {
      const total = saltos.length + 1;
      return DecorationSet.create(
        doc,
        saltos.map((pos, i) =>
          Decoration.widget(pos, () => crearSalto(i + 1, total), { side: -1, key: `salto-${i}-${total}` }),
        ),
      );
    };

    return [
      new Plugin<EstadoPaginacion>({
        key: clavePaginacion,
        state: {
          init: () => ({ saltos: [], set: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(clavePaginacion) as { saltos: number[] } | undefined;
            if (meta) return { saltos: meta.saltos, set: decoraciones(tr.doc, meta.saltos) };
            if (tr.docChanged) return { saltos: prev.saltos, set: prev.set.map(tr.mapping, tr.doc) };
            return prev;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.set ?? DecorationSet.empty;
          },
        },
        view(view: EditorView) {
          let pendiente = 0;
          let viva = true;

          const medir = () => {
            pendiente = 0;
            if (!viva || view.isDestroyed) return;
            const prev = clavePaginacion.getState(view.state)?.saltos ?? [];
            if (!opciones.activa()) {
              if (prev.length) view.dispatch(view.state.tr.setMeta(clavePaginacion, { saltos: [] }));
              opciones.alMedir({ paginas: 0, relleno: 0 });
              return;
            }
            const bloques: BloqueMedido[] = [];
            const posiciones: number[] = [];
            view.state.doc.forEach((node, offset) => {
              const dom = view.nodeDOM(offset);
              let alto = 0;
              if (dom instanceof HTMLElement) {
                const cs = getComputedStyle(dom);
                alto = dom.getBoundingClientRect().height + px(cs.marginTop) + px(cs.marginBottom);
              }
              bloques.push({ alto, saltoManual: node.type.name === "saltoPagina" });
              posiciones.push(offset);
            });
            const r = paginar(bloques, { altoUtil: altoUtil(), extraPrimera: opciones.extraPrimera() });
            const saltos = r.saltosAntesDe.map((i) => posiciones[i]).filter((p) => typeof p === "number");
            const cambio = prev.length !== saltos.length || prev.some((p, i) => p !== saltos[i]);
            if (cambio) view.dispatch(view.state.tr.setMeta(clavePaginacion, { saltos }));
            opciones.alMedir({ paginas: r.paginas, relleno: r.relleno });
          };
          const programar = () => {
            if (!pendiente) pendiente = requestAnimationFrame(medir);
          };

          const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(programar) : null;
          ro?.observe(view.dom);
          window.addEventListener("resize", programar);
          // Una imagen que termina de cargar cambia el alto del bloque.
          view.dom.addEventListener("load", programar, true);
          // Las fuentes cambian las medidas al llegar.
          if (typeof document !== "undefined" && "fonts" in document) {
            (document as Document & { fonts: FontFaceSet }).fonts.ready.then(programar).catch(() => {});
          }
          programar();

          return {
            update: programar,
            destroy() {
              viva = false;
              if (pendiente) cancelAnimationFrame(pendiente);
              ro?.disconnect();
              window.removeEventListener("resize", programar);
              view.dom.removeEventListener("load", programar, true);
            },
          };
        },
      }),
    ];
  },
});
