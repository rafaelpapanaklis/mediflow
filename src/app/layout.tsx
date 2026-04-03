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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${sora.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var saved = localStorage.getItem('theme');
              var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
              if (saved === 'dark' || (!saved && prefersDark)) {
                document.documentElement.classList.add('dark');
              }
            } catch(e) {}
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
