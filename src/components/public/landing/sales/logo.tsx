import Link from "next/link";
import { BrandGlyph, BRAND } from "../primitives/logo";

/**
 * Lockup de marca DaleControl (kit "logo 105"): capas apiladas a color +
 * wordmark bicolor (Dale morado, Control tinta). `invert` para fondos oscuros
 * (icono y texto en blanco).
 */
export function SalesLogo({ invert = false }: { invert?: boolean }) {
  return (
    <Link href="/" className={`mfh-logo${invert ? " mfh-logo--invert" : ""}`} aria-label="DaleControl — inicio">
      <BrandGlyph size={28} mono={invert ? "#fff" : undefined} />
      <span className="mfh-logo__name">
        {!invert && <span style={{ color: BRAND.morado }}>Dale</span>}
        {invert ? "DaleControl" : "Control"}
      </span>
    </Link>
  );
}
