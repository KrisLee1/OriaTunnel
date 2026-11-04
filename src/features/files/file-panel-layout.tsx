import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  GroupImperativeHandle,
  GroupProps,
  PanelImperativeHandle,
  PanelProps,
} from "react-resizable-panels";
import { Columns3, Columns3Cog, Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  automaticFileLayout,
  filePanelModes,
  filePanelOrientations,
  filePanelRatios,
  readFilePanelPreferences,
  saveFilePanelPreferences,
  type FilePanelLayout,
  type FilePanelMode,
} from "./file-panel-layout-state";

function SplitLayoutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 14h18M12 3v11" />
    </svg>
  );
}
const layoutIcons = {
  auto: Columns3Cog,
  columns: Columns3,
  rows: Rows3,
  split: SplitLayoutIcon,
};
const layoutLabels = {
  auto: "layoutAuto",
  columns: "layoutColumns",
  rows: "layoutRows",
  split: "layoutSplit",
};

export function useFilePanelLayout(
  size: { width: number; height: number },
  queue: boolean,
) {
  const [preferences, setPreferences] = useState(readFilePanelPreferences);
  const outerRef = useRef<GroupImperativeHandle>(null);
  const innerRef = useRef<GroupImperativeHandle>(null);
  const previousAuto = useRef<FilePanelLayout | undefined>(undefined);
  const automatic = automaticFileLayout(
    size.width,
    size.height,
    previousAuto.current,
  );
  const resolved = preferences.mode === "auto" ? automatic : preferences.mode;
  const orientation = filePanelOrientations(resolved);
  const current = useRef({ preferences, queue, size });
  current.current = { preferences, queue, size };
  const initial = useRef(filePanelRatios(preferences, resolved));
  useEffect(() => {
    previousAuto.current = automatic;
  }, [automatic]);
  useEffect(() => saveFilePanelPreferences(preferences), [preferences]);
  useEffect(() => {
    const { preferences, queue, size } = current.current;
    const ratios = filePanelRatios(preferences, resolved);
    const axisSize =
      orientation.outer === "horizontal" ? size.width : size.height;
    const queueSize = queue
      ? 100 - ratios.browser
      : Math.min(100, 3800 / Math.max(1, axisSize - 8));
    // Keep the Group/Panel tree mounted and read only current handles after commit.
    outerRef.current?.setLayout({ browser: 100 - queueSize, queue: queueSize });
    innerRef.current?.setLayout({
      local: ratios.local,
      remote: 100 - ratios.local,
    });
  }, [resolved, orientation.outer]);
  const remember =
    (part: "outer" | "inner"): NonNullable<GroupProps["onLayoutChanged"]> =>
    (value, meta) => {
      if (!meta.isUserInteraction) return;
      setPreferences((previous) => {
        const ratios = filePanelRatios(previous, resolved);
        if (part === "outer" && value.queue < 19.9) return previous;
        return {
          ...previous,
          ratios: {
            ...previous.ratios,
            [resolved]: {
              ...ratios,
              ...(part === "outer"
                ? { browser: Math.max(35, Math.min(80, value.browser)) }
                : { local: Math.max(20, Math.min(80, value.local)) }),
            },
          },
        };
      });
    };
  return {
    mode: preferences.mode,
    resolved,
    orientation,
    outerRef,
    innerRef,
    initial: initial.current,
    changeMode: (mode: FilePanelMode) =>
      setPreferences((previous) => ({ ...previous, mode })),
    onOuterLayout: remember("outer"),
    onInnerLayout: remember("inner"),
  };
}
type FileLayoutState = ReturnType<typeof useFilePanelLayout>;

export function FileLayoutMenu({ layout }: { layout: FileLayoutState }) {
  const { t } = useTranslation("files");
  const Icon = layoutIcons[layout.mode];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("panelLayout")}
            title={`${t("panelLayout")} · ${t(layoutLabels[layout.mode])}`}
          >
            <Icon />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="files-options-popup files-layout-options"
      >
        <DropdownMenuRadioGroup
          value={layout.mode}
          onValueChange={(value) => {
            if (filePanelModes.includes(value as FilePanelMode))
              layout.changeMode(value as FilePanelMode);
          }}
        >
          {filePanelModes.map((mode) => {
            const ItemIcon = layoutIcons[mode];
            return (
              <DropdownMenuRadioItem key={mode} value={mode} closeOnClick>
                <ItemIcon />
                {t(layoutLabels[mode])}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FilePanelGrid({
  layout,
  queuePanelRef,
  onQueueResize,
  queue,
  children,
}: {
  layout: FileLayoutState;
  queuePanelRef: React.RefObject<PanelImperativeHandle | null>;
  onQueueResize: PanelProps["onResize"];
  queue: ReactNode;
  children: ReactNode[];
}) {
  const { t } = useTranslation("files");
  return (
    <ResizablePanelGroup
      className="files-body"
      groupRef={layout.outerRef}
      orientation={layout.orientation.outer}
      data-file-layout={layout.resolved}
      data-file-layout-mode={layout.mode}
      defaultLayout={{
        browser: layout.initial.browser,
        queue: 100 - layout.initial.browser,
      }}
      onLayoutChanged={layout.onOuterLayout}
    >
      <ResizablePanel id="browser" minSize="35%" defaultSize="70%">
        <ResizablePanelGroup
          orientation={layout.orientation.inner}
          data-file-browser-layout={layout.orientation.inner}
          groupRef={layout.innerRef}
          defaultLayout={{
            local: layout.initial.local,
            remote: 100 - layout.initial.local,
          }}
          onLayoutChanged={layout.onInnerLayout}
        >
          {children.map((pane, index) => (
            <Fragment key={index === 0 ? "local" : "remote"}>
              {index > 0 && <ResizableHandle aria-label={t("resize")} />}
              <ResizablePanel
                id={index === 0 ? "local" : "remote"}
                minSize="20%"
                defaultSize="50%"
              >
                {pane}
              </ResizablePanel>
            </Fragment>
          ))}
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle aria-label={t("resizeQueue")} />
      <ResizablePanel
        id="queue"
        collapsible
        collapsedSize="38px"
        minSize="20%"
        defaultSize="30%"
        panelRef={queuePanelRef}
        onResize={onQueueResize}
      >
        {queue}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
