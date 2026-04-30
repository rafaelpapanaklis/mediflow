import "server-only";
import { walkFiles, readFileText, relPath, makeItem, safeSnippet } from "../helpers";
import type { BugItem } from "../types";

/**
 * 4.1 TypeScript any/unknown — `: any`, `as any`, `<any>`.
 * LOW por default; HIGH si está en input de auth o handlers de API.
 */
export async function scanTypeScriptAny(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    if (rel.endsWith(".d.ts")) continue;
    const txt = await readFileText(f);
    const lines = txt.split("\n");
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
      // Match `: any`, `as any`, `<any>`.
      if (/(^|[^a-zA-Z0-9_])(:\s*any\b|as\s+any\b|<any>)/.test(line)) {
        const isAuth = /\/auth\/|getCurrentUser|getAuthContext|loadClinicSession/.test(rel);
        items.push(
          makeItem({
            category: "ts-any",
            severity: isAuth ? "high" : "low",
            file: rel,
            line: i + 1,
            title: "Uso de `any` en TypeScript",
            description:
              "any anula el sistema de tipos. En handlers de auth o validación de body, perder los tipos puede dejar pasar datos malformados.",
            suggestion:
              "Reemplazá por un tipo específico, `unknown` con type narrowing, o un schema Zod (`z.infer<typeof Schema>`).",
            code_snippet: safeSnippet(line),
          }),
        );
      }
    });
  }
  return items;
}

/**
 * 4.6 console.log en producción (excluye console.error en catch).
 */
export async function scanConsoleLogs(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    const lines = txt.split("\n");
    let inCatch = false;
    let catchDepth = 0;
    lines.forEach((line, i) => {
      // Track simple catch blocks (heurística de 1 línea).
      if (/\bcatch\s*\(/.test(line)) {
        inCatch = true;
        catchDepth = 0;
      }
      if (inCatch) {
        for (const ch of line) {
          if (ch === "{") catchDepth++;
          else if (ch === "}") {
            catchDepth--;
            if (catchDepth <= 0) inCatch = false;
          }
        }
      }
      if (inCatch && /console\.error\s*\(/.test(line)) return; // OK
      if (/console\.log\s*\(/.test(line) || /console\.warn\s*\(/.test(line)) {
        // Skip logs en libs de auditoría (esto mismo).
        if (rel.includes("/bug-audit/")) return;
        items.push(
          makeItem({
            category: "console-log",
            severity: "low",
            file: rel,
            line: i + 1,
            title: "console.log/warn dejado en código",
            description:
              "Los console.log en producción contaminan los logs de Vercel y pueden filtrar datos sensibles si se imprime un objeto entero.",
            suggestion:
              "Eliminá el log o reemplazá por un logger estructurado. console.error en bloque catch es OK.",
            code_snippet: safeSnippet(line),
          }),
        );
      }
    });
  }
  return items;
}

/**
 * 4.7 TODO / FIXME / HACK / XXX en código.
 */
export async function scanTodos(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    const lines = txt.split("\n");
    lines.forEach((line, i) => {
      const m = /\b(TODO|FIXME|HACK|XXX)\b[:\s]([^\n]{0,140})/.exec(line);
      if (m) {
        items.push(
          makeItem({
            category: "todo",
            severity: "low",
            file: rel,
            line: i + 1,
            title: `${m[1]} en código`,
            description: `Marcador "${m[1]}" sin issue tracker asociado: ${m[2].trim()}`,
            suggestion:
              "Convertilo en un issue de GitHub (enlazado desde el comentario) o resolvelo. Marcadores que se acumulan rotan.",
            code_snippet: safeSnippet(line),
          }),
        );
      }
    });
  }
  return items;
}

/**
 * 4.3 Errores tragados — catch vacío o catch que solo console.log y
 * sigue (no rethrow ni return error response).
 */
export async function scanSwallowedErrors(): Promise<BugItem[]> {
  const items: BugItem[] = [];
  const files = await walkFiles("src");
  for (const f of files) {
    const rel = relPath(f);
    const txt = await readFileText(f);
    // Match `catch (X) { }` empty + `catch (X) { /* comment */ }`.
    const reEmpty = /catch\s*\(\s*\w*\s*\)\s*\{\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*)?\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = reEmpty.exec(txt)) !== null) {
      const ln = txt.slice(0, m.index).split("\n").length;
      items.push(
        makeItem({
          category: "swallowed-error",
          severity: "medium",
          file: rel,
          line: ln,
          title: "catch vacío — error tragado silente",
          description:
            "El catch no hace nada. Errores que ocurren dentro del try desaparecen sin loguearse, sin alertar al usuario, sin rollback.",
          suggestion:
            "Logueá el error (`console.error`), notificá al usuario (toast.error), o re-throw si el caller debería manejarlo.",
          code_snippet: safeSnippet(m[0]),
        }),
      );
    }
  }
  return items;
}
