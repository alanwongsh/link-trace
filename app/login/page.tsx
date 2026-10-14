import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { SetupGuide } from "@/components/setup-guide";
import { countUsers } from "@/lib/accounts";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const config = getDb();
  if (!config.ok) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <SetupGuide message={config.message} />
      </main>
    );
  }

  let users: number;
  try {
    users = await countUsers();
  } catch (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <SetupGuide
          message={`The database is not ready: ${error instanceof Error ? error.message : "unknown error"}. Run npm run db:migrate.`}
        />
      </main>
    );
  }
  if (users === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");

  const params = await searchParams;
  const nextPath =
    params.next && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";
  return <LoginForm nextPath={nextPath} />;
}
