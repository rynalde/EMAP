import { redirect } from "next/navigation";
import { getProfile, getUser } from "@/lib/supabase/server";

// Segunda barreira além do proxy: nenhuma página do mapa renderiza sem sessão e conta aprovada.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getUser())) redirect("/login");
  if ((await getProfile())?.status !== "aprovado")
    redirect("/aguardando-aprovacao");
  return children;
}
