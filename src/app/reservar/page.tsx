import { redirect } from "next/navigation";

// /reservar without a slug → redirect to clinic directory
export default function ReservarIndexPage() {
  redirect("/clinicas");
}
