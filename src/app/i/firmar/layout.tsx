import type { Metadata } from "next";
import "@/app/inmobiliaria/realty-theme.css";
// El CSS va AQUÍ y no solo en el cliente de firma: la pantalla de "esta
// liga no está disponible" la pinta el servidor, sin montar ese cliente, y
// sin esta línea saldría sin un solo estilo. Un aviso desmaquetado a
// alguien que esperaba un contrato parece una página rota, no un aviso.
import "@/components/realty/contracts/contracts.css";

/* ═══════════════════════════════════════════════════════════════════════
   /i/firmar — LA PANTALLA DE FIRMA. La abre quien NO es cliente nuestro:
   un inquilino, un aval, un comprador. Casi siempre en su celular.

   Convive con la web pública de cada inmobiliaria (/i/[slug]) y con el
   portal del cliente (/i/portal): "firmar" es un segmento ESTÁTICO y Next
   resuelve lo estático antes que lo dinámico. Mismo criterio, misma nota
   que dejó el portal: si algún día /i/ gana un layout propio con la piel
   de la mini-web, este seguirá pintando el suyo por debajo.

   NO HAY GUARD, y no puede haberlo: quien firma no tiene sesión ni cuenta
   en el producto. Lo único que autoriza es el token de la liga, y eso se
   resuelve contra la base en la página.

   🔴 noindex, nofollow. Aquí se enseña un contrato con nombres, montos y
   domicilios. Que un buscador indexe una de estas páginas sería una fuga
   de datos personales, no un descuido de SEO.

   El tema verde pino + arena sale de .realty-shell (realty-theme.css). La
   clase `dark` solo se aplica en /dashboard y /admin, así que esto es
   SIEMPRE claro — lo correcto para algo que se abre a mediodía en la calle
   y para un documento que se va a leer completo.
   ═══════════════════════════════════════════════════════════════════════ */

export const metadata: Metadata = {
  title: "Documento para firmar",
  robots: { index: false, follow: false },
};

export default function FirmarLayout({ children }: { children: React.ReactNode }) {
  return <div className="realty-shell">{children}</div>;
}
