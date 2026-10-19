"use client";

import { useActionState, useState } from "react";
import { createLink } from "@/lib/actions";
import { FilterSelect } from "@/components/filter-select";
import { LabelledLinkFields } from "@/components/labelled-link-fields";
import type { PlacementField } from "@/components/parameter-inputs";
import { TargetFields } from "@/components/target-fields";
import { MAX_LABELLED_LINKS } from "@/lib/parameters";
import type { Role } from "@/lib/roles";
import type { CreateState, LinkKind } from "@/lib/types";

// fields: the workspace's active tracking parameters, for the optional first placement.
export type WritableWorkspace = { id: string; name: string; role: Role; canPlace: boolean; fields: PlacementField[] };

const initial: CreateState = { error: "", slug: "" };

// workspaces: where the user can create links (editor or owner).
export function CreateLinkForm({
  workspaces,
  defaultWorkspaceId,
}: {
  workspaces: WritableWorkspace[];
  defaultWorkspaceId: string;
}) {
  const [state, action, pending] = useActionState(createLink, initial);
  // Kept outside the remounting fields so it survives a successful create.
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId);

  return (
    <LinkFormFields
      key={state.slug || "new"}
      state={state}
      action={action}
      pending={pending}
      workspaces={workspaces}
      workspaceId={workspaceId}
      onWorkspaceChange={setWorkspaceId}
    />
  );
}

function LinkFormFields({
  state,
  action,
  pending,
  workspaces,
  workspaceId,
  onWorkspaceChange,
}: {
  state: CreateState;
  action: (formData: FormData) => void;
  pending: boolean;
  workspaces: WritableWorkspace[];
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
}) {
  const [kind, setKind] = useState<LinkKind>("redirect");
  const workspace = workspaces.find((w) => w.id === workspaceId);
  const role = workspace?.role;
  // Labelled links are added only after the user opens the section; it reopens after rejected values.
  const [labelling, setLabelling] = useState(() => Object.keys(state.fieldErrors ?? {}).length > 0);
  // How many labelled links the ticked values make, reported by the fields.
  const [total, setTotal] = useState(1);
  const linkCount = labelling ? total : 1;
  const tooMany = linkCount > MAX_LABELLED_LINKS;

  return (
    <form
      action={action}
      className="grid gap-3 rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,25,22,0.04)]"
    >
      {workspaces.length > 1 ? (
        <div className="grid gap-2">
          <label htmlFor="workspace_id" className="text-sm font-medium">
            Workspace
          </label>
          <FilterSelect
            id="workspace_id"
            name="workspace_id"
            required
            value={workspaceId}
            onChange={onWorkspaceChange}
            options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
            placeholder="Choose a workspace"
            hideEmptyOption
            searchable={workspaces.length > 10}
            fullWidth
          />
        </div>
      ) : (
        <input type="hidden" name="workspace_id" value={workspaceId} />
      )}
      <TargetFields onKindChange={setKind} allowPage={role === "owner"} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <label htmlFor="title" className="text-sm font-medium">
            Name <span className="font-normal text-muted">optional</span>
          </label>
          <input id="title" name="title" type="text" maxLength={120} placeholder="Launch post" className="field" />
        </div>
        <div className="grid gap-2">
          <label htmlFor="slug" className="text-sm font-medium">
            Slug <span className="font-normal text-muted">optional</span>
          </label>
          <input id="slug" name="slug" type="text" maxLength={32} placeholder="auto" className="field" spellCheck={false} />
        </div>
      </div>
      {workspace?.canPlace && !labelling ? (
        <div>
          <button
            type="button"
            onClick={() => setLabelling(true)}
            className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold transition hover:border-teal"
          >
            + Add labelled links
          </button>
          <p className="mt-1.5 text-xs text-muted">
            Optional. Extra short links with labels such as store or channel, to compare where visits came from.
          </p>
        </div>
      ) : null}
      {workspace?.canPlace && labelling ? (
        <fieldset className="relative grid gap-3 rounded-xl border border-line bg-paper/60 p-4">
          <legend className="px-1 text-sm font-medium">Labelled links</legend>
          <button
            type="button"
            onClick={() => setLabelling(false)}
            className="absolute top-3 right-4 text-xs text-muted hover:text-warn"
          >
            Remove
          </button>
          <p className="-mt-1 text-sm text-muted">
            Extra short links to the same destination, each with labels such as store or channel, so reports show
            which one people used. The main link still works on its own. Every combination of the ticked values gets
            its own labelled link and QR code.
          </p>
          <LabelledLinkFields
            // Labels belong to one workspace; switching starts over.
            key={workspaceId}
            fields={workspace.fields}
            errors={state.fieldErrors ?? {}}
            idPrefix="new-param"
            onTotal={setTotal}
            noLabels={
              <p className="text-sm text-muted">
                {workspace.name} has no labels yet, such as store code or channel.{" "}
                <a href={`/workspaces/${workspace.id}/parameters`} className="text-teal hover:underline">
                  Add labels
                </a>
              </p>
            }
          />
        </fieldset>
      ) : null}
      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.slug ? (
        <p className="text-sm text-teal">
          Created <span className="font-mono">/r/{state.slug}</span>
          {state.queuedCount ? (
            <>
              . Making {state.queuedCount.toLocaleString("en")} labelled links now.{" "}
              <a href={`/stats/${state.slug}?tab=links`} className="underline">
                Their QR codes are on the link&apos;s page as a zip
              </a>
            </>
          ) : state.placementCode ? (
            <>
              {" "}with the labelled link <span className="font-mono">/q/{state.placementCode}</span>.{" "}
              <a href={`/stats/${state.slug}?tab=links`} className="underline">
                Open it
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn-primary" disabled={pending || tooMany}>
          {pending
            ? "Creating…"
            : `${kind === "page" ? "Create page" : "Create link"}${
                linkCount > 1 ? ` and ${linkCount.toLocaleString("en")} labelled links` : ""
              }`}
        </button>
      </div>
    </form>
  );
}
