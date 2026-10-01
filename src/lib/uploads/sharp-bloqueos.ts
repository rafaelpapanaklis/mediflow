import sharp from "sharp";

// ═══════════════════════════════════════════════════════════════════════════
// Cargadores de libvips que sharp NO debe usar (ws1-t12, auditoría H4).
//
// sharp 0.34.5 trae libheif y libvips con avisos que solo se arreglan en
// sharp 0.35 (cambios incompatibles, tarea aparte): GHSA-rgj7 (libheif, con
// posible ejecución de código) y GHSA-f88m (libvips). La mitigación oficial sin
// cambiar de versión es apagar esos cargadores:
//
//  · VipsForeignLoadHeif — AVIF/HEIF. El HEIC de iPhone ya no se decodificaba
//    (el libheif empaquetado no trae HEVC); AVIF solo lo admitía la subida de
//    fotos de ortodoncia, y ahora `validarArchivo` lo rechaza con un motivo
//    claro antes de llegar aquí.
//  · VipsForeignLoadVips — el formato nativo `.v`/`.vips` de libvips, que
//    nadie sube.
//
// Solo se bloquea LEER. Escribir AVIF sigue funcionando, y JPG, PNG, WebP, GIF
// y TIFF (logos, fotos clínicas, radiografías, miniaturas) no cambian.
//
// El bloqueo es de todo el proceso: lo aplica UNA vez `src/instrumentation.ts`
// al arrancar el servidor, antes de atender la primera petición, y cubre
// también al optimizador de imágenes de Next, que usa la misma sharp.
// ═══════════════════════════════════════════════════════════════════════════

export const CARGADORES_BLOQUEADOS = ["VipsForeignLoadHeif", "VipsForeignLoadVips"];

export function bloquearCargadoresDeSharp(): void {
  sharp.block({ operation: CARGADORES_BLOQUEADOS });
}
