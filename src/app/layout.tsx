import type { Metadata } from "next";
import { Sora, JetBrains_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const sora = Sora({ subsets: ["latin"], variable: "--font-sora", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "MediFlow — Software médico para clínicas",
  description: "Gestiona citas, pacientes, expedientes y facturación en un solo lugar.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // prevents iOS double-tap zoom
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sora.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Default: DARK mode. Only switch to light if user explicitly chose light. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var saved = localStorage.getItem('theme');
              if (saved === 'light') {
                document.documentElement.classList.remove('dark');
              } else {
                document.documentElement.classList.add('dark');
                if (!saved) localStorage.setItem('theme', 'dark');
              }
            } catch(e) {
              document.documentElement.classList.add('dark');
            }
          })();
        `}} />
      </head>
      <body className="antialiased font-sans bg-background text-foreground">
        <Toaster position="top-right" toastOptions={{ className: "text-sm font-medium" }} />
        {children}
      </body>
    </html>
  );
}
