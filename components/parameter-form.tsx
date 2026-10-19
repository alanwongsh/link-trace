"use client";

import { useActionState, useState } from "react";
import { createParameter } from "@/lib/parameter-actions";
import { PARAMETER_TYPE_LABELS, PARAMETER_TYPES, suggestKey, type ParameterType } from "@/lib/parameters";
import type { FormState } from "@/lib/types";

const initial: FormState = { error: "", ok: "" };

export function CreateParameterForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(createParameter, initial);
  // Remount after each success so the fields clear.
  return <Fields key={state.ok || "new"} state={state} action={action} pending={pending} workspaceId={workspaceId} />;
}

function Fields({
  state,
  action,
  pending,
  workspaceId,
}: {
  state: FormState;
  action: (formData: FormData) => void;
  pending: boolean;
  workspaceId: string;
}) {
  const [name, setName] = useState("");
  // The key follows the name until someone types their own.
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [type, setType] = useState<ParameterType>("text");

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <label htmlFor="param-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="param-name"
            name="name"
            required
            maxLength={60}
            placeholder="Store Code"
            className="field"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!keyEdited) setKey(suggestKey(event.target.value));
            }}
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="param-key" className="text-sm font-medium">
            Key <span className="font-normal text-muted">cannot be changed later</span>
          </label>
          <input
            id="param-key"
            name="key"
            required
            maxLength={40}
            pattern="[a-z][a-z0-9_]*"
            placeholder="store_code"
            spellCheck={false}
            className="field font-mono"
            value={key}
            onChange={(event) => {
              setKey(event.target.value.toLowerCase());
              setKeyEdited(true);
            }}
          />
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">
          Field type <span className="font-normal text-muted">cannot be changed later</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {PARAMETER_TYPES.map((value) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                type === value ? "border-teal bg-paper" : "border-line"
              }`}
            >
              <input
                type="radio"
                name="field_type"
                value={value}
                checked={type === value}
                onChange={() => setType(value)}
              />
              {PARAMETER_TYPE_LABELS[value]}
            </label>
          ))}
        </div>
        {type === "dropdown" ? (
          <p className="text-sm text-muted">Add the options on the next page, by typing or importing a CSV.</p>
        ) : null}
      </fieldset>
      <div className="grid gap-2">
        <label htmlFor="param-description" className="text-sm font-medium">
          Description <span className="font-normal text-muted">optional</span>
        </label>
        <input
          id="param-description"
          name="description"
          maxLength={300}
          placeholder="Which store the QR code is placed in"
          className="field"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_required" />
        Required when creating a placement
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Adding…" : "Add parameter"}
        </button>
        {state.error ? (
          <p className="text-sm text-warn" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.ok ? <p className="text-sm text-teal">{state.ok}</p> : null}
      </div>
    </form>
  );
}
