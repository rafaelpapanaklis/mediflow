import "server-only";
import { walkFiles, readFileText, relPath, makeItem, safeSnippet } from "../helpers";
import type { BugItem } from "../types";

/**
 * 5 Botones rotos / forms sin handler / Links a páginas inexistentes.
 */
export async function scanBrokenButtons(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src", [".tsx", ".jsx"]);

  // Pre-cargar páginas existentes en /dashboard y /app para validar Links.
  const pageFiles = await walkFiles("src/app");
  const validPaths = new Set<string>();
  for (const p of pageFiles) {
    if (p.endsWith("/page.tsx") || p.endsWith("\\page.tsx")) {
      let r = relPath(p)
        .replace(/^src\/app/, "")
        .replace(/\/page\.tsx$/, "")
        .replace(/\\page\.tsx$/, "")
        .replace(/\\/g, "/")
        .replace(/\([^)]+\)/g, ""); // route groups (group)
      r = r.replace(/\/+/g, "/");
      if (r === "") r = "/";
      validPaths.add(r);
    }
  }

  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    const lines = txt.split("\n");

    lines.forEach((line, i) => {
      // 5.1 onClick={() => {}} vacío o noop.
      const noop1 = /onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(line);
      const noop2 = /onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*null\s*\}/.test(line);
      const noop3 = /onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*undefined\s*\}/.test(line);
      if (noop1 || noop2 || noop3) {
        items.push(
          makeItem({
            category: "broken-button",
            severity: "medium",
            file: rel,
            line: i + 1,
            title: "Botón con onClick no-op",
            description: "El onClick es una función vacía o devuelve null/undefined. El click no hace nada.",
            suggestion: "Asigná el handler real o eliminá el onClick si el botón no debe ser interactivo (mejor: <span> o disabled).",
            code_snippet: safeSnippet(line),
          }),
        );
      }
      // 5.2 onClick={() => console.log(...)} — placeholder olvidado.
      if (/onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*console\.(log|warn)\s*\(/.test(line)) {
        items.push(
          makeItem({
            category: "broken-button",
            severity: "low",
            file: rel,
            line: i + 1,
            title: "Botón con onClick de console.log (placeholder)",
            description: "Probable placeholder dejado durante desarrollo. El click solo imprime al console.",
            suggestion: "Reemplazá por el handler real de la acción.",
            code_snippet: safeSnippet(line),
          }),
        );
      }
      // 5.3 <Link href="..."> con path /dashboard/X que no existe en /app.
      const linkMatch = /<Link[^>]*\bhref\s*=\s*["']([^"']+)["']/.exec(line);
      if (linkMatch) {
        const href = linkMatch[1];
        if (href.startsWith("/dashboard/") && !href.includes("[")) {
          // Strip query and hash.
          const path = href.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
          // Cualquier substring pattern match: /dashboard/patients/[id] → /dashboard/patients/cm123.
          const matches = Array.from(validPaths).some((vp) => {
            if (vp === path) return true;
            // Reemplaza segmentos [param] del valid path con regex ".*?" y compara.
            const escaped = vp.replace(/\[[^/]+\]/g, "[^/]+");
            return new RegExp(`^${escaped}$`).test(path);
          });
          if (!matches) {
            items.push(
              makeItem({
                category: "broken-link",
                severity: "medium",
                file: rel,
                line: i + 1,
                title: `<Link> apunta a ruta inexistente: ${href}`,
                description: "No encontramos un page.tsx que matchee con ese path bajo src/app.",
                suggestion: "Verificá que el path está bien, o creá el page.tsx faltante. Si la ruta es dinámica, asegurate de que el [param] del path coincida con el segmento dinámico real.",
                code_snippet: safeSnippet(line),
              }),
            );
          }
        }
      }
    });

    // 5.4 form sin onSubmit handler.
    const reForm = /<form\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = reForm.exec(txt)) !== null) {
      const attrs = m[1];
      if (!/onSubmit\s*=/.test(attrs) && !/action\s*=/.test(attrs)) {
        const ln = txt.slice(0, m.index).split("\n").length;
        items.push(
          makeItem({
            category: "broken-button",
            severity: "low",
            file: rel,
            line: ln,
            title: "<form> sin onSubmit ni action",
            description: "El formulario no tiene handler. Submit del usuario causa navegación full-page o no-op silente.",
            suggestion: "Agregá `onSubmit={(e) => { e.preventDefault(); ... }}` o convertí el contenido en una <div> si no es un form real.",
            code_snippet: safeSnippet(m[0]),
          }),
        );
      }
    }
  }
  return items;
}
