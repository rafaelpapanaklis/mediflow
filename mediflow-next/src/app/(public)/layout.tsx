import { PublicNavbar } from "@/components/layout/public-navbar";
import { PublicFooter } from "@/components/layout/public-footer";

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PublicNavbar />
      <main className="pt-16">{children}</main>
      <PublicFooter />
    </>
  );
}
