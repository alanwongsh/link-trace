"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/accounts";
import { allowed, requireUser, type SessionUser } from "@/lib/auth";
import {
  addOptions,
  findOption,
  findParameter,
  insertParameter,
  moveOption,
  moveParameter,
  setOptionActive,
  setParameterActive,
  updateOptionLabel,
  updateParameter,
} from "@/lib/parameter-data";
import {
  isParameterType,
  MAX_OPTIONS,
  MAX_PARAMETERS,
  normalizeKey,
  normalizeOptionLabel,
  parseOptionRows,
  parseParameterFields,
} from "@/lib/parameters";
import type { FormState } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = "That parameter could not be found.";
const NOT_ALLOWED = "You cannot manage parameters in that workspace.";

function id(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "");
  return UUID.test(text) ? text : null;
}

function actor(user: SessionUser) {
  return { id: user.id, email: user.email };
}

function failed(error: string): FormState {
  return { error, ok: "" };
}

function done(ok: string): FormState {
  return { error: "", ok };
}

function direction(value: FormDataEntryValue | null): "up" | "down" | null {
  return value === "up" || value === "down" ? value : null;
}

function refresh(workspaceId: string): void {
  revalidatePath(`/workspaces/${workspaceId}/parameters`);
}

// Loads a parameter by id and checks the user may manage its workspace. Ids from the form are
// never trusted for the workspace; it always comes from the stored parameter.
async function parameterForUser(rawId: FormDataEntryValue | null) {
  const user = await requireUser();
  const parameterId = id(rawId);
  const parameter = parameterId ? await findParameter(parameterId) : null;
  // Other workspaces' parameters look the same as missing ones.
  if (!parameter || !allowed(user, parameter.workspaceId, "parameters.manage")) {
    return { ok: false, error: NOT_FOUND } as const;
  }
  return { ok: true, user, parameter } as const;
}

async function optionForUser(rawId: FormDataEntryValue | null) {
  const user = await requireUser();
  const optionId = id(rawId);
  const option = optionId ? await findOption(optionId) : null;
  if (!option || !allowed(user, option.workspaceId, "parameters.manage")) {
    return { ok: false, error: "That option could not be found." } as const;
  }
  return { ok: true, user, option } as const;
}

function fields(formData: FormData) {
  return parseParameterFields({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    isRequired: formData.get("is_required") === "on",
  });
}

// ---- Parameters ----

export async function createParameter(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const workspaceId = id(formData.get("workspace_id"));
  if (!workspaceId || !allowed(user, workspaceId, "parameters.manage")) return failed(NOT_ALLOWED);

  const parsed = fields(formData);
  if (!parsed.ok) return failed(parsed.error);
  const key = normalizeKey(String(formData.get("key") ?? ""));
  if (!key) {
    return failed("Keys start with a letter and use up to 40 lower-case letters, numbers and underscores.");
  }
  const fieldType = formData.get("field_type");
  if (!isParameterType(fieldType)) return failed("Choose a field type.");

  const created = await insertParameter({ ...parsed.value, workspaceId, key, fieldType, createdBy: user.id });
  if (created === "duplicate") return failed(`The key ${key} is already used in this workspace.`);
  if (created === "too-many") return failed(`A workspace can have up to ${MAX_PARAMETERS} parameters.`);
  if (created === "no-workspace") return failed(NOT_ALLOWED);

  await audit({
    actor: actor(user),
    action: "parameter.create",
    workspaceId,
    targetType: "parameter",
    targetId: created.id,
    details: { key, name: parsed.value.name, fieldType, isRequired: parsed.value.isRequired },
  });
  refresh(workspaceId);
  return done(`Added ${parsed.value.name}.`);
}

// Changes the name, description and required setting. The key and field type stay fixed.
export async function editParameter(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await parameterForUser(formData.get("parameter_id"));
  if (!loaded.ok) return failed(loaded.error);
  const { user, parameter } = loaded;

  const parsed = fields(formData);
  if (!parsed.ok) return failed(parsed.error);
  await updateParameter(parameter.id, parsed.value, user.id);
  await audit({
    actor: actor(user),
    action: "parameter.update",
    workspaceId: parameter.workspaceId,
    targetType: "parameter",
    targetId: parameter.id,
    details: {
      key: parameter.key,
      before: { name: parameter.name, description: parameter.description, isRequired: parameter.isRequired },
      after: parsed.value,
    },
  });
  refresh(parameter.workspaceId);
  return done("Saved.");
}

export async function setParameterStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await parameterForUser(formData.get("parameter_id"));
  if (!loaded.ok) return failed(loaded.error);
  const { user, parameter } = loaded;

  const isActive = formData.get("is_active") === "true";
  await setParameterActive(parameter.id, isActive, user.id);
  await audit({
    actor: actor(user),
    action: isActive ? "parameter.activate" : "parameter.deactivate",
    workspaceId: parameter.workspaceId,
    targetType: "parameter",
    targetId: parameter.id,
    details: { key: parameter.key },
  });
  refresh(parameter.workspaceId);
  return done(isActive ? `${parameter.name} is active.` : `${parameter.name} is inactive. Existing data keeps it.`);
}

export async function reorderParameter(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await parameterForUser(formData.get("parameter_id"));
  if (!loaded.ok) return failed(loaded.error);
  const move = direction(formData.get("direction"));
  if (!move) return failed("Choose up or down.");
  await moveParameter(loaded.parameter.id, move);
  refresh(loaded.parameter.workspaceId);
  return done("");
}

// ---- Dropdown options ----

// Pasted lines or CSV text: "value" or "value,label" per line.
export async function importOptions(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await parameterForUser(formData.get("parameter_id"));
  if (!loaded.ok) return failed(loaded.error);
  const { user, parameter } = loaded;
  if (parameter.fieldType !== "dropdown") return failed("Only dropdown parameters have options.");

  const parsed = parseOptionRows(String(formData.get("options") ?? ""));
  if (!parsed.ok) return failed(parsed.error);
  const result = await addOptions(parameter.id, parsed.rows, user.id);
  if (result === "too-many") return failed(`A parameter can have up to ${MAX_OPTIONS} options.`);

  if (result.added > 0) {
    await audit({
      actor: actor(user),
      action: "parameter.options_added",
      workspaceId: parameter.workspaceId,
      targetType: "parameter",
      targetId: parameter.id,
      details: { key: parameter.key, added: result.added, skipped: result.skipped.length },
    });
  }
  refresh(parameter.workspaceId);
  const skipped = result.skipped.length ? ` ${result.skipped.length} already existed and were skipped.` : "";
  if (result.added === 0) return failed(`No new options.${skipped}`);
  return done(`Added ${result.added} option${result.added === 1 ? "" : "s"}.${skipped}`);
}

export async function editOption(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await optionForUser(formData.get("option_id"));
  if (!loaded.ok) return failed(loaded.error);
  const { user, option } = loaded;

  const label = normalizeOptionLabel(String(formData.get("label") ?? ""));
  if (label === false) return failed("Labels use up to 120 characters.");
  await updateOptionLabel(option.id, label, user.id);
  await audit({
    actor: actor(user),
    action: "parameter.option_update",
    workspaceId: option.workspaceId,
    targetType: "parameter_option",
    targetId: option.id,
    details: { value: option.value, before: option.label, after: label },
  });
  refresh(option.workspaceId);
  return done("Saved.");
}

export async function setOptionStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await optionForUser(formData.get("option_id"));
  if (!loaded.ok) return failed(loaded.error);
  const { user, option } = loaded;

  const isActive = formData.get("is_active") === "true";
  await setOptionActive(option.id, isActive, user.id);
  await audit({
    actor: actor(user),
    action: isActive ? "parameter.option_activate" : "parameter.option_deactivate",
    workspaceId: option.workspaceId,
    targetType: "parameter_option",
    targetId: option.id,
    details: { value: option.value },
  });
  refresh(option.workspaceId);
  return done(isActive ? `${option.value} is active.` : `${option.value} is inactive.`);
}

export async function reorderOption(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await optionForUser(formData.get("option_id"));
  if (!loaded.ok) return failed(loaded.error);
  const move = direction(formData.get("direction"));
  if (!move) return failed("Choose up or down.");
  await moveOption(loaded.option.id, move);
  refresh(loaded.option.workspaceId);
  return done("");
}
