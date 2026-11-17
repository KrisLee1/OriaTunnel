import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isDefaultVnc } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVncClientSettings } from "@/stores/vnc-client-settings-store";

export function VncClientSetting({
  desktop,
  onChooseDefault,
}: {
  desktop: boolean;
  onChooseDefault: () => Promise<boolean>;
}) {
  const { t } = useTranslation("vnc");
  const { client, remembered, rememberClient } = useVncClientSettings();
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [choosing, setChoosing] = useState(false);
  const query = useRef(0);
  const refreshDefault = useCallback(async () => {
    const request = ++query.current;
    const current = await isDefaultVnc().catch(() => false);
    if (request === query.current) setIsDefault(current);
  }, []);

  useEffect(() => {
    if (!desktop) return;
    void refreshDefault();
    window.addEventListener("focus", refreshDefault);
    return () => {
      ++query.current;
      window.removeEventListener("focus", refreshDefault);
    };
  }, [desktop, refreshDefault]);

  async function chooseDefault() {
    setChoosing(true);
    try {
      await onChooseDefault();
      await refreshDefault();
    } finally {
      setChoosing(false);
    }
  }
  const items = [
    { value: "system", label: t("useSystem") },
    { value: "internal", label: t("useInternal") },
  ] as const;

  return (
    <ItemGroup className="settings-section-panel themed-surface gap-0 divide-y divide-border-strong/15 overflow-hidden rounded-xl">
      <Item className="rounded-none border-0 px-3 py-2.5">
        <ItemContent>
          <ItemTitle id="vnc-client-label">{t("client")}</ItemTitle>
        </ItemContent>
        <ItemActions className="max-w-full flex-wrap">
          <Select
            items={items}
            value={remembered ? client : null}
            onValueChange={(value) => {
              if (value === "system" || value === "internal")
                rememberClient(value);
            }}
          >
            <SelectTrigger aria-labelledby="vnc-client-label">
              <SelectValue placeholder={t("askEachTime")} />
            </SelectTrigger>
            <SelectContent>
              {items.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ItemActions>
      </Item>
      <Item className="rounded-none border-0 px-3 py-2.5">
        <ItemContent>
          <ItemTitle>{t("defaultVnc")}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!desktop || choosing || isDefault !== false}
            onClick={chooseDefault}
          >
            {t(isDefault ? "isDefault" : "chooseDefault")}
          </Button>
        </ItemActions>
      </Item>
    </ItemGroup>
  );
}
