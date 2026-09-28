// Ortodoncia — Parte 7 «Imagen y análisis», geometría corregida (ws1-t10,
// H19). Antes, PhotoLineAnalyzer marcaba los puntos en % de un recuadro
// 3:4 fijo, pintado con un <svg viewBox="0 0 100 100" preserveAspectRatio
// "none"> encima de una foto en object-contain: 1 % horizontal y 1 %
// vertical NO valen lo mismo salvo que la foto sea exactamente 3:4, así que
// cualquier medida que no fuera puramente horizontal o vertical salía
// deformada (mismo defecto que tenía CephalometricTracer, ver
// investigacion-trazado.md §2.3a).
//
// Aquí los puntos se guardan en px NATURALES de la foto (naturalWidth/
// naturalHeight) y esta es la ÚNICA conversión entre esas coordenadas y el
// rectángulo que pinta pantalla — la misma cuenta que hace el navegador
// para `object-fit: contain`, sin escalar x/y por separado.

export interface Size {
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Rectángulo donde `object-fit: contain` pinta `image` dentro de
 * `container` — centrado, escalado UNA sola vez (no por eje), con las
 * franjas negras que sobren a los lados o arriba/abajo.
 */
export function containRect(container: Size, image: Size): Rect {
  if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { left: 0, top: 0, width: Math.max(0, container.width), height: Math.max(0, container.height) };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { left: (container.width - width) / 2, top: (container.height - height) / 2, width, height };
}

/**
 * Convierte un punto en px del contenedor (p.ej. `clientX - rect.left`) a
 * px naturales de la imagen. `null` si el punto cae en la franja negra,
 * fuera de la foto — antes esos clics SÍ se aceptaban (mismo defecto que
 * el trazador cefalométrico).
 */
export function containerPointToImagePoint(point: Point2D, container: Size, image: Size): Point2D | null {
  const rect = containRect(container, image);
  if (rect.width <= 0 || rect.height <= 0) return null;
  const relX = point.x - rect.left;
  const relY = point.y - rect.top;
  if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return null;
  const scale = rect.width / image.width;
  return { x: relX / scale, y: relY / scale };
}

/** La conversión inversa: un punto en px naturales de la imagen a px del contenedor, para pintarlo. */
export function imagePointToContainerPoint(point: Point2D, container: Size, image: Size): Point2D {
  const rect = containRect(container, image);
  const scale = image.width > 0 ? rect.width / image.width : 1;
  return { x: rect.left + point.x * scale, y: rect.top + point.y * scale };
}
