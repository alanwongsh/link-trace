import { notFound } from "next/navigation";
import { FormSelect } from "@/components/form-select";
import { ActionForm } from "@/components/action-form";
import { CreateParameterForm } from "@/components/parameter-form";
import { RevealPanels } from "@/components/reveal-panels";
import { TopBar } from "@/components/top-bar";
import { allowed, requireUser, workspacesWith } from "@/lib/auth";
import { reorderParameter, setParameterStatus } from "@/lib/parameter-actions";
import { listParameters } from "@/lib/parameter-data";
import { MAX_PARAMETERS } from "@/lib/parameters";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["all", "active", "inactive"] as const;

export default async function WorkspaceParametersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  if (!UUID.test(id) || !allowed(user, id, "parameters.manage")) notFound();
  const workspaces = await workspacesWith(user, "parameters.manage");
  const workspace = workspaces.find((w) => w.id === id);
  if (!workspace) notFound();

  const query = await searchParams;
  const q = (query.q ?? "").trim().toLowerCase();
  const status = STATUSES.find((s) => s === query.status) ?? "all";
  const all = await listParameters(id);
  const rows = all.filter(
    (p) =>
      (status === "all" || (status === "active") === p.isActive) &&
      (!q || p.name.toLowerCase().includes(q) || p.key.includes(q)),
  );
  const filtered = Boolean(q) || status !== "all";

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-3">
          <a href={`/?ws=${id}`} className="text-sm text-teal">
            {workspace.name} links
          </a>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h1 className="font-serif text-4xl tracking-tight">Labels</h1>
              <p className="mt-2 text-muted">
                Store code, campaign and other labels to put on labelled links, so reports show where each visit came
                from.
              </p>
            </div>
            {workspaces.length > 1 ? (
              <nav aria-label="Workspace" className="flex flex-wrap gap-2">
                {workspaces.map((w) => (
                  <a
                    key={w.id}
                    href={`/workspaces/${w.id}/parameters`}
                    aria-current={w.id === id ? "page" : undefined}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                      w.id === id ? "border-teal bg-teal text-card" : "border-line bg-paper hover:border-teal"
                    }`}
                  >
                    {w.name}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>
        </div>

        <section className="grid gap-4">
          <RevealPanels
            heading={
              <h2 className="panel-title">
                Labels <span className="num text-base text-muted">{all.length} of {MAX_PARAMETERS}</span>
              </h2>
            }
            panels={
              all.length >= MAX_PARAMETERS
                ? []
                : [
                    {
                      key: "add-label",
                      label: "Add label",
                      primary: true,
                      content: (
                        <div className="panel">
                          <h3 className="sub-title">Add a label</h3>
                          <p className="mt-1 mb-4 text-sm text-muted">
                            The key is what CSV imports and reports use, so it stays fixed. The name can be changed at
                            any time.
                          </p>
                          <CreateParameterForm workspaceId={id} />
                        </div>
                      ),
                    },
                  ]
            }
            defaultOpen={all.length === 0 ? "add-label" : null}
          />
          {all.length >= MAX_PARAMETERS ? (
            <p className="text-sm text-muted">This workspace has the most labels allowed. Deactivate unused ones instead.</p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <form className="flex flex-wrap items-center gap-2" role="search">
              <input
                name="q"
                defaultValue={query.q ?? ""}
                placeholder="Search name or key"
                aria-label="Search labels"
                className="field h-9 w-56 py-1.5"
              />
              <FormSelect
                name="status"
                defaultValue={status}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                ]}
                placeholder="Status"
                ariaLabel="Status"
              />
              <button type="submit" className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm font-semibold hover:border-teal">
                Filter
              </button>
              {filtered ? (
                <a href={`/workspaces/${id}/parameters`} className="text-sm text-teal">
                  Clear
                </a>
              ) : null}
            </form>
          </div>

          {all.length === 0 ? (
            <p className="empty-state">
              No labels yet. Links work without them. Add one, such as store code, when {workspace.name} needs
              to tell its labelled links apart.
            </p>
          ) : rows.length === 0 ? (
            <p className="empty-state">No labels match.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="border-b border-line bg-paper text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Order</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Key</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className={`border-b border-line last:border-0 ${p.isActive ? "" : "text-muted"}`}>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {(["up", "down"] as const).map((direction) => (
                            <ActionForm
                              key={direction}
                              action={reorderParameter}
                              submit={direction === "up" ? "↑" : "↓"}
                              pending="…"
                              buttonLabel={`Move ${p.name} ${direction}`}
                              variant="secondary"
                              quiet
                              inline
                            >
                              <input type="hidden" name="parameter_id" value={p.id} />
                              <input type="hidden" name="direction" value={direction} />
                            </ActionForm>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <a href={`/workspaces/${id}/parameters/${p.id}`} className="font-semibold text-ink hover:text-teal">
                          {p.name}
                        </a>
                        {p.description ? <p className="mt-0.5 max-w-xs truncate text-xs text-muted">{p.description}</p> : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{p.key}</td>
                      <td className="px-4 py-3">
                        {p.fieldType === "dropdown" ? `Dropdown · ${p.optionCount} options` : "Text"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            p.isActive ? "bg-teal/10 text-teal" : "bg-paper text-muted"
                          }`}
                        >
                          {p.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={`/workspaces/${id}/parameters/${p.id}`}
                            className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold transition hover:border-teal"
                          >
                            {p.fieldType === "dropdown" ? "Edit & options" : "Edit"}
                          </a>
                          <ActionForm
                            action={setParameterStatus}
                            submit={p.isActive ? "Deactivate" : "Activate"}
                            variant={p.isActive ? "danger" : "secondary"}
                            confirm={p.isActive ? `Deactivate ${p.name}? It stops appearing on new labelled links; existing data keeps it.` : undefined}
                            quiet
                            inline
                          >
                            <input type="hidden" name="parameter_id" value={p.id} />
                            <input type="hidden" name="is_active" value={p.isActive ? "false" : "true"} />
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
