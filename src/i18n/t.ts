// src/i18n/t.ts
//
// Núcleo del motor i18n — SIN dependencias de React ni de servidor, así que se
// usa idéntico en componentes servidor (vía makeT) y cliente (el provider también
// llama makeT). Una sola implementación de lookup + interpolación para que
// servidor y cliente NUNCA divergan.

export type TVars = Record<string, string | number>;

// Diccionario anidado por namespaces. Las hojas son strings; un nodo objeto con
// las llaves { one, other } se trata como forma plural (ver selección por count).
export type Dictionary = { [key: string]: string | Dictionary };

function lookup(dict: Dictionary, key: string): string | Dictionary | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split(".")) {
    if (node == null || typeof node === "string") return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Construye la función `t` a partir de un diccionario ya resuelto al locale.
 *
 *   t("home.recep.todayTitle")             → "Agenda de hoy"
 *   t("home.recep.todayCount", { count })  → "3 citas"  (plural por count)
 *
 * Plural: si la llave resuelve a un objeto con { one, other }, elige `one` cuando
 * count === 1, si no `other`. Interpolación: reemplaza {var} por vars.var.
 * Fallback de seguridad: si la llave falta o no resuelve a string, devuelve la
 * propia llave (visible, nunca rompe el render).
 */
export function makeT(dict: Dictionary) {
  return function t(key: string, vars?: TVars): string {
    // Defensa: una llave undefined/no-string reventaba en lookup (key.split) y
    // tumbaba TODA la página (client-side exception). Nunca debe romper el render.
    if (typeof key !== "string") return "";
    let node = lookup(dict, key);

    if (node && typeof node === "object" && vars && "count" in vars) {
      const form = Number(vars.count) === 1 ? "one" : "other";
      node = (node[form] ?? node.other ?? node.one) as string | Dictionary | undefined;
    }

    if (typeof node !== "string") return key;
    return interpolate(node, vars);
  };
}

export type TFunction = ReturnType<typeof makeT>;
