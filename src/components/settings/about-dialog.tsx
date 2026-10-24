import { useId } from "react";
import { ArrowUpRightIcon, MessageSquareWarningIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, buttonVariants } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
} from "@/components/ui/avatar";
import { Modal } from "@/components/tunnel-form";
import { ApplicationUpdateSetting } from "./application-update-setting";
import type { useApplicationUpdate } from "@/lib/application-update";
import type { UpdateSnapshot } from "@/types";
import packageInfo from "../../../package.json";
import applicationIcon from "../../../src-tauri/icons/128x128.png";
import applicationLogo from "@/assets/oria-tunnel-logo.svg";
import githubBlack from "@/assets/github-black.svg";
import githubWhite from "@/assets/github-white.svg";
import authorLogo from "@/assets/krislee-logo.svg";
import oriaThemeLogo from "@/assets/oria-theme-logo.svg";
import oriaTabLogo from "@/assets/oria-tab-logo.svg";

// Only published apps belong here; append future releases to this list.
const recommendedApplications = [
  {
    id: "oria-theme",
    name: "OriaTheme",
    href: "https://www.oriamade.com/oria-theme",
    icon: oriaThemeLogo,
  },
  {
    id: "oria-tab",
    name: "OriaTab",
    href: "https://www.oriamade.com/oria-tab",
    icon: oriaTabLogo,
  },
];

function RecommendedApplications() {
  const { t } = useTranslation("updater");
  const titleId = useId();
  return (
    <section className="@container grid gap-3" aria-labelledby={titleId}>
      <h3 id={titleId}>{t("about.moreApps")}</h3>
      <div className="grid grid-cols-1 gap-2 @min-[380px]:grid-cols-2">
        {recommendedApplications.map((app) => (
          <Item
            key={app.id}
            variant="outline"
            render={<ExternalLink href={app.href} />}
            className="flex-nowrap rounded-xl px-3 py-2.5"
          >
            <ItemMedia className="size-10">
              <img
                src={app.icon}
                alt=""
                width={40}
                height={40}
                className="size-full object-contain"
              />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>{app.name}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <ArrowUpRightIcon
                aria-hidden="true"
                className="size-3.5 text-muted-foreground"
              />
            </ItemActions>
          </Item>
        ))}
      </div>
    </section>
  );
}

export function hasApplicationUpdate(snapshot: UpdateSnapshot | null) {
  return !!snapshot?.release && snapshot.unavailable === null;
}

export function AboutButton({
  snapshot,
  onClick,
}: {
  snapshot: UpdateSnapshot | null;
  onClick: () => void;
}) {
  const { t } = useTranslation("updater");
  const hasUpdate = hasApplicationUpdate(snapshot);
  const label = t(hasUpdate ? "about.openWithUpdate" : "about.open");
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative overflow-visible"
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <Avatar size="sm">
        <AvatarImage src={applicationLogo} alt="" keepMounted />
        <AvatarFallback aria-hidden="true">OT</AvatarFallback>
        {hasUpdate && (
          <AvatarBadge
            aria-hidden="true"
            className="top-0 right-0 bottom-auto size-2 min-w-0 p-0 ring-0"
          />
        )}
      </Avatar>
    </Button>
  );
}

export function AboutDialog({
  updates,
  close,
}: {
  updates: ReturnType<typeof useApplicationUpdate>;
  close: () => void;
}) {
  const { t } = useTranslation("updater");
  const installing = ["preparing", "installing"].includes(
    updates.snapshot?.phase || "",
  );
  return (
    <Modal
      title={t("about.title")}
      close={() => {
        if (!installing) close();
      }}
      className="max-w-lg sm:max-w-lg"
    >
      <div className="flex items-center gap-4">
        <img
          src={applicationIcon}
          width={72}
          height={72}
          alt={t("about.icon")}
          className="size-18 shrink-0"
        />
        <div className="grid min-w-0 gap-2">
          <h3 className="m-0! text-2xl! leading-tight font-semibold tracking-tight">
            OriaTunnel
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-sm">
            <p data-selectable="true">
              {t("about.version", {
                version:
                  updates.snapshot?.currentVersion || packageInfo.version,
              })}
            </p>
            <p>{t("about.copyright", { year: 2026 })}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ExternalLink
          href="https://www.oriamade.com/oria-tunnel"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <span
            aria-hidden="true"
            className="inline-flex size-4 shrink-0 items-center justify-center"
          >
            {/* The SVG's mark fills 656/1024 of its canvas: 25px renders a 16px mark. */}
            <img
              src={applicationLogo}
              alt=""
              className="size-[25px] max-w-none shrink-0 object-contain"
            />
          </span>
          {t("about.website")}
        </ExternalLink>
        <ExternalLink
          href="https://github.com/KrisLee1/OriaTunnel"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <img
            src={githubBlack}
            alt=""
            className="size-4 shrink-0 object-contain dark:hidden"
          />
          <img
            src={githubWhite}
            alt=""
            className="hidden size-4 shrink-0 object-contain dark:block"
          />
          GitHub
        </ExternalLink>

        <ExternalLink
          href="https://www.krislee.me"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <img
            src={authorLogo}
            alt=""
            className="size-4 shrink-0 object-contain"
          />
          {t("about.author")}
        </ExternalLink>
        <ExternalLink
          href="https://github.com/KrisLee1/OriaTunnel/issues"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <MessageSquareWarningIcon
            aria-hidden="true"
            className="size-4 shrink-0"
          />
          {t("about.feedback")}
        </ExternalLink>
      </div>
      <ApplicationUpdateSetting updates={updates} showVersion={false} />
      <RecommendedApplications />
    </Modal>
  );
}
