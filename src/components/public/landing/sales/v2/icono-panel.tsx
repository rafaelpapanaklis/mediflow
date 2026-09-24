/**
 * Ícono de Material Symbols Rounded (fuente de ligaduras del menú real, ver
 * `src/components/dashboard/menu-dos-niveles/iconos.ts`): el texto ES el ícono.
 * La caja es de 1em × 1em y recorta, así que si la fuente aún no cargó nunca se
 * ve la palabra desbordando. Módulo aparte y sin `next/font` para que lo puedan
 * importar por igual el marco (servidor) y la conversación (cliente).
 */
export function IconoPanel({ nombre, size = 20, className }: { nombre: string; size?: number; className?: string }) {
  return (
    <span aria-hidden="true" translate="no" className={`dcv4-mi${className ? ` ${className}` : ""}`} style={{ fontSize: size }}>
      {nombre}
    </span>
  );
}
