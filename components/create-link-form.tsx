"use client";

import { useActionState, useState } from "react";
import { createLink } from "@/lib/actions";
import { TagField } from "@/components/tag-field";
import { TargetFields } from "@/components/target-fields";
import type { Role } from "@/lib/roles";
import type { CreateState, LinkKind } from "@/lib/types";

export type WritableWorkspace = { id: string; name: string; role: Role };

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
  const role = workspaces.find((w) => w.id === workspaceId)?.role;

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
          <select
            id="workspace_id"
            name="workspace_id"
            value={workspaceId}
            onChange={(event) => onWorkspaceChange(event.target.value)}
            className="field"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
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
      <TagField
        id="tags"
        label="Platform tags"
        placeholder="instagram"
        hint="Press Enter or Add after each platform. Each tag gets its own address, such as /r/slug/instagram."
      />
      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.slug ? (
        <p className="text-sm text-teal">
          Created <span className="font-mono">/r/{state.slug}</span>
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
