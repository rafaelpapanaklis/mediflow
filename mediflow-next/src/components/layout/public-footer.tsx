import Link from "next/link";
import { Separator } from "@/components/ui/separator";

const footerCols = [
  {
    title: "Producto",
    links: [
      { label: "Características", href: "/features" },
      { label: "Precios",         href: "/pricing"  },
      { label: "Changelog",       href: "#"         },
      { label: "Status",          href: "#"         },
      { label: "Roadmap",         href: "#"         },
    ],
  },
  {
    title: "Especialidades",
    links: [
      { label: "Odontólogos",   href: "#" },
      { label: "Médicos",       href: "#" },
      { label: "Nutriólogos",   href: "#" },
      { label: "Psicólogos",    href: "#" },
      { label: "Dermatólogos",  href: "#" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { label: "Sobre nosotros", href: "#" },
      { label: "Blog",           href: "#" },
      { label: "Contacto",       href: "/contact" },
      { label: "Afiliados",      href: "#" },
      { label: "Prensa",         href: "#" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacidad",      href: "#" },
      { label: "Términos",        href: "#" },
      { label: "Cookies",         href: "#" },
      { label: "Seguridad",       href: "#" },
      { label: "NOM-024 / RGPD",  href: "#" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="bg-slate-900 text-slate-300">
      <div className="container-wide py-16 px-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-3 lg:col-span-1">
            <div className="flex items-center gap-2 font-extrabold text-xl text-white mb-4">
              <span className="w-2 h-2 rounded-full bg-brand-500" />
              MediFlow
            </div>
            <p className="text-sm text-slate-400 leading-relaxed mb-5">
              El sistema operativo para clínicas modernas. Gestiona pacientes,
              agenda, expedientes y facturación desde un solo lugar.
            </p>
            <div className="flex gap-2">
              {["𝕏", "in", "▶"].map((icon) => (
                <button
                  key={icon}
                  className="w-9 h-9 rounded-lg bg-white/8 hover:bg-white/15 flex items-center justify-center text-sm transition-colors"
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Cols */}
          {footerCols.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-white mb-4">{col.title}</h4>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-400 hover:text-white transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className="my-10 bg-white/10" />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>© 2025 MediFlow. Todos los derechos reservados.</span>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Todos los sistemas operativos
            </span>
            <span>MX · AR · CO · ES · CL</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
