import Link from "next/link";
import { Mail, Phone, MapPin } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-[#080b16] text-white pt-16 pb-8 border-t border-[rgba(99,102,241,0.08)]">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="grid md:grid-cols-5 gap-10 mb-12">
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-indigo-600 rounded-xl flex items-center justify-center">
                <span className="text-white font-black text-lg">M</span>
              </div>
              <span className="font-bold text-xl">MediFlow</span>
            </Link>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
              Software de gestión para clínicas de salud, estética y belleza en México.
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sm text-slate-300">Especialidades</h4>
            <ul className="space-y-2 text-slate-500 text-sm">
              <li><Link href="/dental" className="hover:text-white transition-colors">Dental</Link></li>
              <li><Link href="/medicina-general" className="hover:text-white transition-colors">Medicina General</Link></li>
              <li><Link href="/nutricion" className="hover:text-white transition-colors">Nutrición</Link></li>
              <li><Link href="/psicologia" className="hover:text-white transition-colors">Psicología</Link></li>
              <li><Link href="/medicina-estetica" className="hover:text-white transition-colors">Medicina Estética</Link></li>
              <li><Link href="/fisioterapia" className="hover:text-white transition-colors">Fisioterapia</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sm text-slate-300">Producto</h4>
            <ul className="space-y-2 text-slate-500 text-sm">
              <li><a href="#funciones" className="hover:text-white transition-colors">Funciones</a></li>
              <li><a href="#precios" className="hover:text-white transition-colors">Precios</a></li>
              <li><a href="#especialidades" className="hover:text-white transition-colors">Especialidades</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-sm text-slate-300">Contacto</h4>
            <ul className="space-y-3 text-slate-500 text-sm">
              <li className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-600" />
                <a href="mailto:hola@mediflow.app" className="hover:text-white transition-colors">hola@mediflow.app</a>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-600" />
                <a href="tel:+525512345678" className="hover:text-white transition-colors">+52 55 1234 5678</a>
              </li>
              <li className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-600" />
                <span>Ciudad de México</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="divider-glow mb-6" />

        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-slate-600 text-sm">
            © 2026 MediFlow. Todos los derechos reservados.
          </p>
          <div className="flex gap-6 text-slate-600 text-sm">
            <a href="#" className="hover:text-white transition-colors">Privacidad</a>
            <a href="#" className="hover:text-white transition-colors">Términos</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
