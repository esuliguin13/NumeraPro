import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Authenticated route group layout.
 * Auth check only — each child page manages its own sidebar/layout
 * to allow workspace-specific sidebar context.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <>{children}</>;
}
