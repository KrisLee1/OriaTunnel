import { Trans } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import logo from "@/assets/oria-tunnel-logo.svg";

export function notifyApplicationUpdate(
  version: string,
  t: TFunction<"updater">,
  openAbout: () => void,
) {
  const id = `application-update-${version}`;
  toast.add({
    id,
    title: (
      <Trans
        ns="updater"
        i18nKey="notification"
        values={{ version }}
        components={{
          version: <Badge className="mx-1 align-middle" />,
        }}
      />
    ),
    data: {
      icon: (
        <span
          data-slot="toast-icon"
          className="relative size-5 shrink-0"
          aria-hidden="true"
        >
          <img
            src={logo}
            alt=""
            className="absolute top-1/2 left-1/2 size-8 max-w-none -translate-x-1/2 -translate-y-1/2"
          />
        </span>
      ),
    },
    actionProps: {
      children: t("goUpdate"),
      onClick: () => {
        toast.close(id);
        openAbout();
      },
    },
    timeout: 6000,
  });
}
