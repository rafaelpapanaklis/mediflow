import Link from "next/link";

/**
 * Lockup de marca MediFlow para fondo claro: marca cuadrada violeta con un
 * diente estilizado + wordmark en tinta oscura. `invert` para fondos oscuros
 * (footer/CTA no lo usan, pero queda disponible).
 */
export function SalesLogo({ invert = false }: { invert?: boolean }) {
  return (
    <Link href="/" className={`mfh-logo${invert ? " mfh-logo--invert" : ""}`} aria-label="MediFlow — inicio">
      <span className="mfh-logo__mark" aria-hidden="true">
        <ToothGlyph />
      </span>
      <span className="mfh-logo__name">MediFlow</span>
    </Link>
  );
}

/** Diente simple monocromo para el mark del logo (no confundir con el diente 3D del hero). */
export function ToothGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3.2c-2 0-3-1-5-1C4.7 2.2 3 4 3 7c0 2.3.8 3.7 1.4 6 .5 1.9.7 4.3 1.5 6.4.4 1 .9 1.6 1.6 1.6.9 0 1.2-.9 1.4-2 .3-1.4.5-3 1.6-3s1.3 1.6 1.6 3c.2 1.1.5 2 1.4 2 .7 0 1.2-.6 1.6-1.6.8-2.1 1-4.5 1.5-6.4C20.2 10.7 21 9.3 21 7c0-3-1.7-4.8-4-4.8-2 0-3 1-5 1Z"
        fill="currentColor"
      />
    </svg>
  );
}
