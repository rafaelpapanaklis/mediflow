import Link from "next/link";
import { Instagram, Facebook, Linkedin } from "lucide-react";
import { SalesLogo } from "./logo";

export function SalesFooter() {
  return (
    <footer className="mfh-foot">
      <div className="mfh-container">
        <div className="mfh-foot__top">
          <div className="mfh-foot__about">
            <SalesLogo />
            <p className="mfh-foot__tag">
              El software todo-en-uno para clínicas dentales en México. Agenda, expedientes,
              radiografías con IA y facturación CFDI 4.0 en un solo lugar.
            </p>
            <div className="mfh-foot__soc">
              <a href="https://instagram.com" aria-label="Instagram" target="_blank" rel="noopener noreferrer"><Instagram /></a>
              <a href="https://facebook.com" aria-label="Facebook" target="_blank" rel="noopener noreferrer"><Facebook /></a>
              <a href="https://linkedin.com" aria-label="LinkedIn" target="_blank" rel="noopener noreferrer"><Linkedin /></a>
            </div>
          </div>

          <div className="mfh-foot__col">
            <h4>Producto</h4>
            <a href="#funciones">Funciones</a>
            <a href="#producto">Radiografías con IA</a>
            <a href="#producto">Mi Clínica Visual</a>
            <a href="#precios">Planes</a>
          </div>

          <div className="mfh-foot__col">
            <h4>Empresa</h4>
            <a href="#clientes">Clientes</a>
            <a href="#funciones">Por qué MediFlow</a>
            <Link href="/login">Iniciar sesión</Link>
            <Link href="/signup">Crear cuenta</Link>
          </div>

          <div className="mfh-foot__col">
            <h4>Legal</h4>
            <Link href="/legal/privacy">Aviso de privacidad</Link>
            <a href="#precios">Términos del servicio</a>
            <a href="#producto">CFDI 4.0 · NOM-024</a>
          </div>
        </div>

        <div className="mfh-foot__bottom">
          <span className="mfh-foot__legal">© 2026 MediFlow. Todos los derechos reservados.</span>
          <span className="mfh-foot__made">Hecho con cariño en México 🇲🇽</span>
        </div>
      </div>
    </footer>
  );
}
