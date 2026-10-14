import { AdminNav } from "@/components/admin-nav";
import { LocalTime } from "@/components/local-time";
import { TopBar } from "@/components/top-bar";
import { listAudit } from "@/lib/accounts";
import { requireOrgAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requireOrgAdmin();
  const entries = await listAudit(200);

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-4">
          <h1 className="font-serif text-4xl tracking-tight">Audit log</h1>
          <AdminNav current="/admin/audit" />
          <p className="text-muted">The latest 200 sign-ins and changes, newest first.</p>
        </div>
        <section className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Who</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Workspace</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3">
                    <LocalTime iso={entry.at} />
                  </td>
                  <td className="px-4 py-3">{entry.userEmail ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{entry.action}</td>
                  <td className="px-4 py-3">{entry.workspaceName ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {entry.targetType ? `${entry.targetType}:${entry.targetId}` : "—"}
                  </td>
                  <td className="max-w-xs break-words px-4 py-3 font-mono text-xs text-muted">
                    {entry.details ? JSON.stringify(entry.details) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 ? <p className="px-4 py-6 text-muted">Nothing yet.</p> : null}
        </section>
      </main>
    </>
  );
}
