/**
 * Scanner I — Accesibilidad básica (WCAG AA).
 *
 *   I.1 <img>/<Image> sin alt.
 *   I.2 <button> con solo icono y sin aria-label / texto visible.
 *   I.3 Combinaciones de Tailwind con contraste sospechoso (gray-400 sobre
 *       white, white sobre yellow-300, etc.).
 *   I.4 <input>/<select>/<textarea> sin <label htmlFor> ni aria-label.
 *   I.5 onClick en <div>/<span> sin role="button" ni tabIndex.
 *
 * Nota: regex sobre JSX es imperfecto. Damos LOW por hallazgo (cada uno es
 * pequeño) salvo I.1 que es MEDIUM (es escándalo de accesibilidad).
 */

import path from "node:path";
import type { BugItem } from "../../types";
import { repoRoot, walk, readManyAbs, findLineMatches, safeSnippet , makeItem } from "../../helpers";

// Cap por tipo para no inundar el reporte si hay 200 violaciones.
const MAX_PER_TYPE = 30;

export async function runA11yScan(): Promise<BugItem[]> {  const items: BugItem[] = [];

  const tsxFiles = await readManyAbs(await walk(path.join(repoRoot(), "src"), [".tsx"]));

  let imgCount = 0, btnCount = 0, contrastCount = 0, inputCount = 0, divClickCount = 0;

  for (const f of tsxFiles) {
    // I.1 — img sin alt
    if (imgCount < MAX_PER_TYPE) {
      const imgs = findLineMatches(f.content, /<(img|Image)\b[^>]*>/g);
      for (const m of imgs) {
        if (imgCount >= MAX_PER_TYPE) break;
        if (!/\balt\s*=/.test(m.text)) {
          items.push(makeItem({
            category: "a11y",
            severity: "medium",
            file: f.rel,
            line: m.line,
            title: "<img> sin atributo alt",
            description:
              "Imagen sin alt. Lectores de pantalla anuncian solo la URL, lo que es ruido inútil. WCAG 1.1.1.",
            suggestion:
              `Agrega alt="..." descriptivo. Si la imagen es decorativa (icono visual sin info), usa alt="" para que el lector la salte.`,
            code_snippet: safeSnippet(m.text.trim()),
          }));
          imgCount++;
        }
      }
    }

    // I.2 — botón solo icono sin aria-label
    if (btnCount < MAX_PER_TYPE) {
      // Match <button ...>...<Icon|svg/></button> donde no hay texto visible.
      const buttonBlockRe = /<button\b[\s\S]*?<\/button>/g;
      const matches = f.content.match(buttonBlockRe) ?? [];
      for (const block of matches) {
        if (btnCount >= MAX_PER_TYPE) break;
        // Busca aria-label, title, o texto visible (chars no-tag fuera de <Icon/>)
        const hasAria = /\baria-label\s*=/.test(block);
        const hasTitle = /\btitle\s*=/.test(block);
        // Texto visible: cualquier texto fuera de tags, excluyendo whitespace
        const inner = block.replace(/<[^>]+>/g, " ").trim();
        if (!hasAria && !hasTitle && inner.length === 0) {
          // Encuentra la línea
          const idx = f.content.indexOf(block);
          const line = f.content.slice(0, idx).split("\n").length;
          items.push(makeItem({
            category: "a11y",
            severity: "low",
            file: f.rel,
            line,
            title: "<button> solo icono sin aria-label",
            description:
              "Botón con icono pero sin texto ni aria-label. Lectores anuncian 'botón sin nombre'. WCAG 4.1.2.",
            suggestion:
              `Agrega aria-label="Acción descriptiva" o un <span className="sr-only">Acción</span> dentro del botón.`,
            code_snippet: safeSnippet(block),
          }));
          btnCount++;
        }
      }
    }

    // I.3 — contraste sospechoso (heurística)
    if (contrastCount < MAX_PER_TYPE) {
      const sus = findLineMatches(
        f.content,
        /(text-(gray|slate|zinc)-(300|400)\s+[^"]*\bbg-(white|gray-50|slate-50|zinc-50)|text-white\s+[^"]*\bbg-(yellow|amber|lime)-(200|300|400)|text-(yellow|amber)-(200|300)\s+[^"]*\bbg-white)/g,
      );
      for (const m of sus) {
        if (contrastCount >= MAX_PER_TYPE) break;
        items.push(makeItem({
          category: "a11y",
          severity: "low",
          file: f.rel,
          line: m.line,
          title: "Contraste de texto/fondo sospechoso",
          description:
            "Combinación Tailwind que probablemente tiene contraste < 4.5:1 (texto normal) o < 3:1 (texto grande). WCAG 1.4.3.",
          suggestion:
            "Sube el peso del color del texto (text-gray-700 mínimo sobre bg blanco) o cambia el fondo. Valida con WebAIM Contrast Checker.",
          code_snippet: safeSnippet(m.text.trim()),
        }));
        contrastCount++;
      }
    }

    // I.4 — input sin label
    if (inputCount < MAX_PER_TYPE) {
      const inputs = findLineMatches(
        f.content,
        /<(input|select|textarea)\b[^>]*>/g,
      );
      for (const m of inputs) {
        if (inputCount >= MAX_PER_TYPE) break;
        const hasAria = /\baria-label\s*=/.test(m.text);
        const hasAriaBy = /\baria-labelledby\s*=/.test(m.text);
        const hasId = /\bid\s*=/.test(m.text);
        // Conservador: si tiene id, asumimos hay un <label htmlFor> en otro lado.
        if (!hasAria && !hasAriaBy && !hasId) {
          items.push(makeItem({
            category: "a11y",
            severity: "low",
            file: f.rel,
            line: m.line,
            title: "Input sin label asociado",
            description:
              "<input>/<select>/<textarea> sin id (que un <label htmlFor> pueda referenciar) ni aria-label. Usuarios de lector de pantalla no saben qué pedir.",
            suggestion:
              `Agrega id={someId} y un <label htmlFor={someId}>...</label>, o usa aria-label="Descripción" si el label visible no aplica.`,
            code_snippet: safeSnippet(m.text.trim()),
          }));
          inputCount++;
        }
      }
    }

    // I.5 — onClick en <div>/<span> sin role/tabIndex
    if (divClickCount < MAX_PER_TYPE) {
      const divClicks = findLineMatches(
        f.content,
        /<(div|span)\b[^>]*\bonClick\s*=/g,
      );
      for (const m of divClicks) {
        if (divClickCount >= MAX_PER_TYPE) break;
        const hasRole = /\brole\s*=\s*["']button["']/.test(m.text);
        const hasTab = /\btabIndex\s*=/.test(m.text);
        if (!hasRole || !hasTab) {
          items.push(makeItem({
            category: "a11y",
            severity: "low",
            file: f.rel,
            line: m.line,
            title: "<div>/<span> con onClick no es focusable por teclado",
            description:
              `Click handler en un elemento no interactivo. Sin role="button" ni tabIndex={0}, no hay forma de activarlo con teclado. WCAG 2.1.1.`,
            suggestion:
              `Si es un botón real: usa <button>. Si tiene que ser <div>: agrega role="button" tabIndex={0} y un onKeyDown que reaccione a Enter/Space.`,
            code_snippet: safeSnippet(m.text.trim()),
          }));
          divClickCount++;
        }
      }
    }
  }

  return items;
}
