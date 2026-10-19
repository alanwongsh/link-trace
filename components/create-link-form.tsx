"use client";

import { useActionState, useState } from "react";
import { createLink } from "@/lib/actions";
import { FilterSelect } from "@/components/filter-select";
import { ParameterInputs, type PlacementField } from "@/components/parameter-inputs";
import { TargetFields } from "@/components/target-fields";
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
  // Reopens after a rejected placement value so the error shows.
  const [addPlacement, setAddPlacement] = useState(Boolean(state.fieldErrors && Object.keys(state.fieldErrors).length));

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
      {workspace?.canPlace ? (
        <fieldset className="grid gap-3 rounded-xl border border-line bg-paper/60 p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="add_placement"
              checked={addPlacement}
              onChange={(event) => setAddPlacement(event.target.checked)}
            />
            Add a placement now <span className="font-normal text-muted">optional</span>
          </label>
          <p className="-mt-1 text-sm text-muted">
            A placement is one QR code or printed spot with its own address and labels. You can add more on the
            link&apos;s page.
          </p>
          {addPlacement ? (
            <>
              <div className="grid gap-2">
                <label htmlFor="placement_name" className="text-sm font-medium">
                  Placement name <span className="font-normal text-muted">optional, such as “Entrance poster”</span>
                </label>
                <input id="placement_name" name="placement_name" maxLength={80} className="field" />
              </div>
              {workspace.fields.length > 0 ? (
                <ParameterInputs fields={workspace.fields} errors={state.fieldErrors ?? {}} idPrefix="new-param" />
              ) : (
                <p className="text-sm text-muted">
                  {workspace.name} has no tracking parameters yet.{" "}
                  <a href={`/workspaces/${workspace.id}/parameters`} className="text-teal hover:underline">
                    Add parameters
                  </a>
                </p>
              )}
            </>
          ) : null}
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
          {state.placementCode ? (
            <>
              {" "}with placement <span className="font-mono">/q/{state.placementCode}</span>.{" "}
              <a href={`/stats/${state.slug}#placements`} className="underline">
                Open its QR code
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : kind === "page" ? "Create page" : "Create link"}
        </button>
      </div>
    </form>
  );
}
