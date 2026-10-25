import type { TFunction } from "i18next";
import i18n from "@/i18n";

const PREFIX = "oria-message:";
type Envelope = {
  v: 1;
  key?: string;
  args?: Record<string, string | number | { message: string }>;
  messages?: string[];
  separator?: string;
  fallback: string;
};

function parse(value: string): Envelope | undefined {
  if (!value.startsWith(PREFIX)) return undefined;
  try {
    const item: unknown = JSON.parse(value.slice(PREFIX.length));
    if (!item || typeof item !== "object") return undefined;
    const envelope = item as Envelope;
    if (envelope.v !== 1 || typeof envelope.fallback !== "string")
      return undefined;
    if (
      typeof envelope.key === "string" &&
      /^[a-zA-Z][a-zA-Z0-9]*$/.test(envelope.key)
    ) {
      if (
        envelope.args !== undefined &&
        (!envelope.args ||
          typeof envelope.args !== "object" ||
          Array.isArray(envelope.args))
      )
        return undefined;
      return envelope;
    }
    if (
      Array.isArray(envelope.messages) &&
      envelope.messages.every((m) => typeof m === "string") &&
      typeof envelope.separator === "string"
    )
      return envelope;
  } catch {
    // An external error that resembles a message is still shown literally.
  }
  return undefined;
}

/** Only explicitly encoded messages are interpreted. Parameters stay literal. */
export function nativeMessageKey(value: string): string | undefined {
  return parse(value)?.key;
}

export function formatNativeMessage(
  value: string,
  translate?: TFunction,
): string {
  const t = translate ?? i18n.getFixedT(null, "native");
  let remaining = 20000;
  const render = (raw: string, depth: number): string => {
    const message = parse(raw);
    if (!message) return raw;
    if (depth > 24 || --remaining < 0) return message.fallback;
    if (message.messages)
      return message.messages
        .map((m) => render(m, depth + 1))
        .join(message.separator);
    const args = message.args ?? {};
    const missing = "\u0000oria-native-missing\u0000";
    const template = t(message.key!, {
      ns: "native",
      defaultValue: missing,
      interpolation: { skipOnVariables: true },
    });
    if (template === missing) return message.fallback;
    return String(template).replace(
      /\{\{([a-zA-Z0-9_]+)\}\}/g,
      (token, key: string) => {
        const argument = Object.prototype.hasOwnProperty.call(args, key)
          ? args[key]
          : undefined;
        if (typeof argument === "string" || typeof argument === "number")
          return String(argument);
        if (
          argument &&
          typeof argument === "object" &&
          typeof argument.message === "string"
        )
          return render(argument.message, depth + 1);
        return token;
      },
    );
  };
  return render(value, 0);
}
