import { redirect } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { requireUser, workspacesWith } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Opens the parameters of the first workspace the user can manage.
export default async function ParametersIndex() {
  const user = await requireUser();
  const [first] = await workspacesWith(user, "parameters.manage");
  if (first) redirect(`/workspaces/${first.id}/parameters`);

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-4 px-6 py-10">
        <h1 className="font-serif text-4xl tracking-tight">Tracking parameters</h1>
        <p className="empty-state">
          You are not in any workspace yet. Ask an org admin to add you.
        </p>
      </main>
    </>
  );
}
