import { useContext, useEffect, useState } from "react";
import { VncHostsReady } from "./VncWorkspaces";
import {
  BrushCleaning,
  Ellipsis,
  FolderSync,
  Gauge,
  Keyboard,
  MousePointer2Off,
  TerminalIcon,
  Wallpaper,
  ZoomIn,
  ZoomOut,
  Scan,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  OpenFilesButton,
  useFileWorkspace,
} from "@/features/files/file-workspace";
import {
  OpenTerminalButton,
  useTerminalWorkspace,
} from "@/features/terminal/terminal-workspace";
import { WindowHeader } from "@/components/window/window-header";
import {
  setHideLocalCursor,
  setRenderMode,
  type RenderMode,
} from "./display-preferences";

export type Phase =
  | "ready"
  | "connecting"
  | "credentials"
  | "connected"
  | "disconnected";

export function VncHeader({
  endpoint,
  phase,
  scale,
  hideLocalCursor,
  renderMode,
  onZoom,
  savedPassword,
  onForgetPassword,
  onSpecialKeys,
}: {
  endpoint: string;
  phase: Phase;
  scale: string;
  hideLocalCursor: boolean;
  renderMode: RenderMode;
  onZoom: (action: "out" | "fit" | "in") => void;
  savedPassword: boolean;
  onForgetPassword: () => void;
  onSpecialKeys: () => void;
}) {
  const { t } = useTranslation("vnc");
  const files = useFileWorkspace();
  const hostsReady = useContext(VncHostsReady);
  const terminal = useTerminalWorkspace();
  const connected = phase === "connected";
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!connected) {
      setVisible(true);
      return;
    }
    let timer: number | undefined;
    let shown = true;
    let target = true;
    function show(next: boolean, hideDelay = 700) {
      if (next === target) return;
      target = next;
      window.clearTimeout(timer);
      if (next === shown) return;
      if (next) {
        shown = true;
        setVisible(true);
        return;
      }
      timer = window.setTimeout(() => {
        shown = false;
        setVisible(false);
      }, hideDelay);
    }
    function track(event: PointerEvent) {
      if (event.buttons) {
        show(false);
        return;
      }
      const overHeader =
        event.target instanceof Element &&
        event.target.closest(".vnc-floating-header");
      const reveal = event.clientY <= 8 || !!overHeader;
      show(reveal);
    }
    const leave = () => show(false);
    if (!document.querySelector(".vnc-floating-header:hover")) show(false, 1400);
    document.addEventListener("pointermove", track, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointermove", track);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [connected]);
  return (
    <WindowHeader
      className={
        !connected || visible
          ? "vnc-floating-header is-visible"
          : "vnc-floating-header"
      }
      centerContent={
        <span className="vnc-target overlay" title={endpoint}>
          {endpoint || "VNC"}
        </span>
      }
      fixedRightActions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!connected || scale === "0.25"}
            aria-label={t("zoomOut", { ns: "tunnel" })}
            title={t("zoomOut", { ns: "tunnel" })}
            onClick={() => onZoom("out")}
          >
            <ZoomOut />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!connected}
            aria-pressed={scale === "fit"}
            aria-label={t("fit")}
            title={t("fit")}
            onClick={() => onZoom("fit")}
          >
            <Scan />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!connected || scale === "4"}
            aria-label={t("zoomIn", { ns: "tunnel" })}
            title={t("zoomIn", { ns: "tunnel" })}
            onClick={() => onZoom("in")}
          >
            <ZoomIn />
          </Button>
        </>
      }
    >
      <OpenFilesButton disabled={!hostsReady} className="max-md:hidden" />
      <OpenTerminalButton
        disabled={!hostsReady}
        workspace
        className="max-md:hidden"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label={t("more", { ns: "files" })}
          title={t("more", { ns: "files" })}
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-max">
          <DropdownMenuRadioGroup
            aria-label={t("renderMode")}
            value={renderMode}
            onValueChange={(value) => {
              if (value === "quality" || value === "smooth")
                setRenderMode(value);
            }}
          >
            <DropdownMenuRadioItem value="quality" closeOnClick>
              <Wallpaper aria-hidden="true" />
              {t("qualityMode")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="smooth" closeOnClick>
              <Gauge aria-hidden="true" />
              {t("smoothMode")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem
            checked={hideLocalCursor}
            onCheckedChange={setHideLocalCursor}
          >
            <MousePointer2Off aria-hidden="true" />
            {t("hideLocalCursor")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hostsReady}
            className="md:hidden"
            onClick={() => files.open()}
          >
            <FolderSync />
            {t("title", { ns: "files" })}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hostsReady}
            className="md:hidden"
            onClick={() => terminal?.openHost()}
          >
            <TerminalIcon />
            {t("workspace", { ns: "terminal" })}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="md:hidden" />
          <DropdownMenuItem disabled={!connected} onClick={onSpecialKeys}>
            <Keyboard aria-hidden="true" />
            <Trans
              ns="vnc"
              i18nKey="sendCtrlAltDel"
              components={{ keys: <KbdGroup />, cap: <Kbd /> }}
            />
          </DropdownMenuItem>
          {savedPassword && (
            <DropdownMenuItem onClick={onForgetPassword}>
              <BrushCleaning aria-hidden="true" />
              {t("clearSavedPassword", { ns: "tunnel" })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </WindowHeader>
  );
}
