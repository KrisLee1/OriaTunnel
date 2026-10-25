import type { TFunction } from "i18next";
import { formatNativeMessage } from "./native-message";

/** Keep error identifiers in state and translate them with the current render. */
export function formatUiError(
  value: string,
  translate: TFunction,
  errorNamespace?: string,
) {
  return formatNativeMessage(
    translate(value, {
      defaultValue: translate(`error.${value}`, {
        ns: errorNamespace,
        defaultValue: value,
      }),
    }),
  );
}
