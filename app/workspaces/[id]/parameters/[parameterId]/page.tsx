import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { OptionImportForm } from "@/components/option-import-form";
import { TopBar } from "@/components/top-bar";
import { allowed, requireUser, workspacesWith } from "@/lib/auth";
import { editOption, editParameter, reorderOption, setOptionStatus, setParameterStatus } from "@/lib/parameter-actions";
import { findParameter, listOptions } from "@/lib/parameter-data";
import { MAX_OPTIONS, PARAMETER_TYPE_LABELS } from "@/lib/parameters";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;

export default async function ParameterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; parameterId: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const user = await requireUser();
  const { id, parameterId } = await params;
  if (!UUID.test(id) || !UUID.test(parameterId)) notFound();
  const parameter = await findParameter(parameterId);
  // The workspace in the URL must be the parameter's own, and the user must be allowed in it.
  if (!parameter || parameter.workspaceId !== id || !allowed(user, id, "parameters.manage")) notFound();
  const workspace = (await workspacesWith(user, "parameters.manage")).find((w) => w.id === id);
  if (!workspace) notFound();

  const query = await searchParams;
  const q = (query.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const options =
    parameter.fieldType === "dropdown"
      ? await listOptions(parameter.id, { search: q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      : null;
  const pages = options ? Math.max(1, Math.ceil(options.total / PAGE_SIZE)) : 1;
  const base = `/workspaces/${id}/parameters/${parameter.id}`;
  const pageHref = (n: number) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-3">
          <a href={`/workspaces/${id}/parameters`} className="text-sm text-teal">
            {workspace.name} parameters
          </a>
          <div>
            <h1 className="font-serif text-4xl tracking-tight">{parameter.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span className="font-mono text-ink">{parameter.key}</span>
              <span>{PARAMETER_TYPE_LABELS[parameter.fieldType]}</span>
              <span>{parameter.isRequired ? "Required" : "Optional"}</span>
              <span className={parameter.isActive ? "text-teal" : "text-warn"}>
                {parameter.isActive ? "Active" : "Inactive"}
              </span>
            </p>
          </div>
        </div>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Details</h2>
          <p className="mt-1 text-sm text-muted">
            The key <span className="font-mono">{parameter.key}</span> and the field type stay fixed so existing data keeps its meaning.
          </p>
          <ActionForm action={editParameter} submit="Save" className="mt-4 grid max-w-xl gap-3">
            <input type="hidden" name="parameter_id" value={parameter.id} />
            <div className="grid gap-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <input id="name" name="name" defaultValue={parameter.name} maxLength={60} required className="field" />
            </div>
            <div className="grid gap-2">
              <label htmlFor="description" className="text-sm font-medium">
                Description <span className="font-normal text-muted">optional</span>
              </label>
              <input
                id="description"
                name="description"
                defaultValue={parameter.description ?? ""}
                maxLength={300}
                className="field"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_required" defaultChecked={parameter.isRequired} />
              Required when creating a placement
            </label>
          </ActionForm>
        </section>

        {options ? (
          <section className="grid gap-4 rounded-2xl border border-line bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">
                Options{" "}
                <span className="num text-base text-muted">
                  {q ? `${options.total} match` : `${options.total} of ${MAX_OPTIONS.toLocaleString("en")}`}
                </span>
              </h2>
              <form className="flex flex-wrap items-center gap-2" role="search">
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Search code or label"
                  aria-label="Search options"
                  className="field h-9 w-56 py-1.5"
                />
                <button type="submit" className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm font-semibold hover:border-teal">
                  Search
                </button>
                {q ? (
                  <a href={base} className="text-sm text-teal">
                    Clear
                  </a>
                ) : null}
              </form>
            </div>

            {options.rows.length === 0 ? (
              <p className="empty-state text-sm">
                {q ? "No options match." : "No options yet. Add them below; people can only pick from this list."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="border-b border-line bg-paper text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">Order</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Code</th>
                      <th scope="col" className="px-3 py-2 font-semibold">Label</th>
                      <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Status</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {options.rows.map((o) => (
                      <tr key={o.id} className={`border-b border-line last:border-0 ${o.isActive ? "" : "text-muted"}`}>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {(["up", "down"] as const).map((direction) => (
                              <ActionForm
                                key={direction}
                                action={reorderOption}
                                submit={direction === "up" ? "↑" : "↓"}
                                pending="…"
                                buttonLabel={`Move ${o.value} ${direction}`}
                                variant="secondary"
                                quiet
                                inline
                              >
                                <input type="hidden" name="option_id" value={o.id} />
                                <input type="hidden" name="direction" value={direction} />
                              </ActionForm>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{o.value}</td>
                        <td className="px-3 py-2">
                          <ActionForm action={editOption} submit="Save" variant="secondary" quiet inline>
                            <input type="hidden" name="option_id" value={o.id} />
                            <input
                              name="label"
                              defaultValue={o.label ?? ""}
                              maxLength={120}
                              placeholder="No label"
                              aria-label={`Label for ${o.value}`}
                              className="field h-9 w-56 py-1.5"
                            />
                          </ActionForm>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <ActionForm
                            action={setOptionStatus}
                            submit={o.isActive ? "Deactivate" : "Activate"}
                            variant={o.isActive ? "danger" : "secondary"}
                            quiet
                            inline
                          >
                            <input type="hidden" name="option_id" value={o.id} />
                            <input type="hidden" name="is_active" value={o.isActive ? "false" : "true"} />
                          </ActionForm>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pages > 1 ? (
              <nav aria-label="Pages" className="flex items-center justify-between text-sm">
                {page > 1 ? (
                  <a href={pageHref(page - 1)} className="text-teal">
                    Previous
                  </a>
                ) : (
                  <span />
                )}
                <span className="num text-muted">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <a href={pageHref(page + 1)} className="text-teal">
                    Next
                  </a>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}

            <div className="border-t border-line pt-4">
              <OptionImportForm parameterId={parameter.id} />
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">{parameter.isActive ? "Deactivate" : "Activate"}</h2>
          <p className="mt-1 text-sm text-muted">
            {parameter.isActive
              ? "An inactive parameter is hidden from new placements. Existing placements and reports keep it. Parameters are never deleted."
              : "Make it available on new placements again."}
          </p>
          <div className="mt-4">
            <ActionForm
              action={setParameterStatus}
              submit={parameter.isActive ? "Deactivate" : "Activate"}
              variant={parameter.isActive ? "danger" : "primary"}
              confirm={parameter.isActive ? `Deactivate ${parameter.name}?` : undefined}
              inline
            >
              <input type="hidden" name="parameter_id" value={parameter.id} />
              <input type="hidden" name="is_active" value={parameter.isActive ? "false" : "true"} />
            </ActionForm>
          </div>
        </section>
      </main>
    </>
  );
}
