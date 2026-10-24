import { useTranslation } from "react-i18next";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  CommandInvocation,
  CommandEnvironment,
  PresetAction,
} from "@/types";

// Empty editor values mean a flag; entirely blank draft rows are omitted on save.
// Keep renderInvocation literal so previously saved explicit empty words still read.
export function normalizeInvocation(
  value: CommandInvocation,
): CommandInvocation {
  return {
    ...value,
    arguments: value.arguments
      .map((arg) => ({ ...arg, value: arg.value === "" ? null : arg.value }))
      .filter((arg) => arg.name !== "" || arg.value !== null),
    environment: value.environment?.filter(
      (entry) => entry.name !== "" || entry.value !== "",
    ),
  };
}

// Each word is literal POSIX-shell data, including empty values and embedded quotes.
export function renderInvocation(value: CommandInvocation) {
  const quote = (word: string) => `'${word.replaceAll("'", `'"'"'`)}'`;
  const environment = value.environment || [];
  const assignments = environment
    .map(({ name, value }) => `${name}=${quote(value)}`)
    .join(" ");
  if (value.script !== undefined) {
    return assignments
      ? `export ${assignments}\n${value.script}`
      : value.script;
  }
  const managed = value.executable.split("/").at(-1) === "systemd-run";
  const command = [
    value.executable,
    ...(managed
      ? environment.map(({ name, value }) => `--setenv=${name}=${value}`)
      : []),
    ...value.arguments.flatMap((arg) => [
      ...(arg.name ? [arg.name] : []),
      ...(arg.value !== null ? [arg.value] : []),
    ]),
  ]
    .map(quote)
    .join(" ");
  return !managed && environment.length ? `${assignments} ${command}` : command;
}
export function CommandInvocationEditor({
  value,
  onChange,
  disabled = false,
  maxArguments = 128,
}: {
  value: CommandInvocation;
  onChange: (value: CommandInvocation) => void;
  disabled?: boolean;
  maxArguments?: number;
}) {
  const { t } = useTranslation("commands");
  return (
    <fieldset className="command-invocation" disabled={disabled}>
      <legend className="sr-only">{t("builder.title")}</legend>
      <label className="field">
        <span>{t("builder.executable")}</span>
        <Input
          required
          maxLength={4096}
          value={value.executable}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => onChange({ ...value, executable: e.target.value })}
        />
      </label>
      {value.arguments.map((arg, index) => (
        <div className="command-argument" key={index}>
          <label className="field">
            <span>{t("builder.parameter")}</span>
            <Input
              value={arg.name}
              maxLength={128}
              pattern="(-[A-Za-z0-9_.-]*)?"
              spellCheck={false}
              onChange={(e) =>
                onChange({
                  ...value,
                  arguments: value.arguments.map((a, i) =>
                    i === index ? { ...a, name: e.target.value } : a,
                  ),
                })
              }
            />
          </label>
          <label className="field">
            <span>{t("builder.value")}</span>
            <Input
              value={arg.value ?? ""}
              maxLength={4096}
              spellCheck={false}
              onChange={(e) =>
                onChange({
                  ...value,
                  arguments: value.arguments.map((a, i) =>
                    i === index ? { ...a, value: e.target.value || null } : a,
                  ),
                })
              }
            />
          </label>
          <Button
            type="button"
            size="icon-xs"
            variant="destructive"
            aria-label={`${t("builder.remove")} ${index + 1}`}
            onClick={() =>
              onChange({
                ...value,
                arguments: value.arguments.filter((_, i) => i !== index),
              })
            }
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={value.arguments.length >= maxArguments}
        onClick={() =>
          onChange({
            ...value,
            arguments: [...value.arguments, { name: "", value: null }],
          })
        }
      >
        <PlusIcon aria-hidden="true" />
        {t("builder.add")}
      </Button>
      <p className="muted">{t("builder.hint")}</p>
    </fieldset>
  );
}

export function CommandEnvironmentEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: CommandEnvironment[];
  onChange: (value: CommandEnvironment[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("commands");
  return (
    <fieldset className="command-environment" disabled={disabled}>
      <legend className="sr-only">{t("builder.environment")}</legend>
      <div className="command-section-heading">
        <h4>{t("builder.environment")}</h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={value.length >= 64}
          onClick={() => onChange([...value, { name: "", value: "" }])}
        >
          <PlusIcon aria-hidden="true" />
          {t("builder.environmentAdd")}
        </Button>
      </div>
      {value.map((entry, index) => (
        <div className="command-argument" key={index}>
          <label className="field">
            <span>{t("builder.environmentName")}</span>
            <Input
              value={entry.name}
              required={entry.value !== ""}
              pattern="[A-Za-z_][A-Za-z0-9_]*"
              maxLength={128}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <label className="field">
            <span>{t("builder.environmentValue")}</span>
            <Input
              value={entry.value}
              maxLength={4096}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) =>
                onChange(
                  value.map((item, i) =>
                    i === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <Button
            type="button"
            size="icon-xs"
            variant="destructive"
            aria-label={`${t("builder.environmentRemove")} ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      ))}
    </fieldset>
  );
}

export function isStructuredCommand(action: PresetAction) {
  return !!action.invocation && action.invocation.script === undefined;
}
export function actionScript(action: PresetAction) {
  return action.invocation?.script ?? action.command;
}
export function editActionScript(
  action: PresetAction,
  script: string,
  environment = action.invocation?.environment || [],
): PresetAction {
  if (!environment.length)
    return { ...action, invocation: null, command: script };
  const invocation: CommandInvocation = {
    executable: "sh",
    arguments: [],
    script,
    environment,
  };
  return {
    ...action,
    invocation,
    command: renderInvocation(normalizeInvocation(invocation)),
  };
}
export function editActionEnvironment(
  action: PresetAction,
  environment: CommandEnvironment[],
): PresetAction {
  if (!isStructuredCommand(action))
    return editActionScript(action, actionScript(action), environment);
  const invocation = { ...action.invocation!, environment };
  return {
    ...action,
    invocation,
    command: renderInvocation(normalizeInvocation(invocation)),
  };
}
export function switchActionFormat(
  action: PresetAction,
  format: "script" | "command",
): PresetAction {
  const environment = action.invocation?.environment || [];
  if (format === "script") {
    if (!isStructuredCommand(action)) return action;
    const invocation = action.invocation!;
    const args = invocation.arguments;
    const source =
      ["sh", "/bin/sh"].includes(invocation.executable) &&
      args.length === 2 &&
      args[0].name === "" &&
      args[0].value === "-c" &&
      args[1].name === "" &&
      args[1].value !== null
        ? args[1].value
        : renderInvocation({ ...invocation, environment: [] });
    return editActionScript(action, source, environment);
  }
  if (isStructuredCommand(action)) return action;
  const script = actionScript(action);
  const invocation: CommandInvocation = {
    executable: script ? "sh" : "",
    arguments: script
      ? [
          { name: "", value: "-c" },
          { name: "", value: script },
        ]
      : [],
    environment,
  };
  return {
    ...action,
    invocation,
    command: renderInvocation(normalizeInvocation(invocation)),
  };
}
