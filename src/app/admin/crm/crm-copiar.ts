// ═══════════════════════════════════════════════════════════════════════
// Copiar al portapapeles, con el plan B.
//
// `navigator.clipboard` sólo existe en contexto seguro (https o
// localhost). En un panel que se abre por IP o por http de una red local
// —cosa que pasa cuando se enseña el producto desde otra máquina— no
// existe, y sin plan B el botón "Copiar" no haría absolutamente nada sin
// decir por qué.
//
// Plan B: un <textarea> fuera de pantalla + document.execCommand("copy").
// Está obsoleto, sí, y sigue funcionando en todos los navegadores de
// escritorio. Como último recurso se devuelve false y quien llama avisa,
// en vez de fingir que copió.
// ═══════════════════════════════════════════════════════════════════════

export async function crmCopiar(texto: string): Promise<boolean> {
  const contenido = String(texto ?? "");
  if (!contenido) return false;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(contenido);
      return true;
    }
  } catch {
    // Permiso denegado o contexto inseguro: se intenta el plan B.
  }

  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = contenido;
    // Fuera de la vista pero DENTRO del documento y sin display:none:
    // un elemento oculto de verdad no se puede seleccionar, y sin
    // selección execCommand("copy") no copia nada.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.left = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, contenido.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
