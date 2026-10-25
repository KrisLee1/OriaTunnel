import { useId, useState, type CSSProperties } from "react";
import {
  DatabaseBackupIcon,
  ServerCogIcon,
  WebhookIcon,
  FolderSyncIcon,
  NotebookPenIcon,
  MicrochipIcon,
  ScanTextIcon,
  WaypointsIcon,
  DatabaseZapIcon,
  RadioTowerIcon,
  FileCodeIcon,
  GitForkIcon,
  PanelsTopLeftIcon,
  AudioLinesIcon,
  BinaryIcon,
  DnaIcon,
  AtomIcon,
  CircuitBoardIcon,
  SigmaIcon,
  MonitorCogIcon,
  ChevronDownIcon,
  ServerIcon,
  DatabaseIcon,
  GlobeIcon,
  TerminalIcon,
  CodeIcon,
  BracesIcon,
  MonitorIcon,
  LaptopIcon,
  SmartphoneIcon,
  NetworkIcon,
  RouterIcon,
  WifiIcon,
  CableIcon,
  PlugIcon,
  CloudIcon,
  ContainerIcon,
  BoxesIcon,
  HardDriveIcon,
  FolderIcon,
  FileIcon,
  ArchiveIcon,
  ShieldIcon,
  LockIcon,
  KeyRoundIcon,
  FingerprintIcon,
  EyeIcon,
  ActivityIcon,
  ChartNoAxesCombinedIcon,
  GaugeIcon,
  CpuIcon,
  MemoryStickIcon,
  BotIcon,
  BrainCircuitIcon,
  SearchIcon,
  MailIcon,
  MessageSquareIcon,
  VideoIcon,
  MusicIcon,
  ImageIcon,
  Gamepad2Icon,
  GitBranchIcon,
  GitPullRequestIcon,
  PackageIcon,
  WrenchIcon,
  SettingsIcon,
  FlaskConicalIcon,
  RocketIcon,
  ZapIcon,
  StarIcon,
  HeartIcon,
  HouseIcon,
  Building2Icon,
  CoffeeIcon,
  LeafIcon,
  LayersIcon,
  WorkflowIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { RuleIcon } from "@/types";
import { ConnectionColorDot } from "./connection-color";
import serviceIcons from "@/assets/service-icons.json";
import catalog from "./connection-icon-catalog.json";

const icons = {
  "database-backup": DatabaseBackupIcon,
  "server-cog": ServerCogIcon,
  webhook: WebhookIcon,
  "folder-sync": FolderSyncIcon,
  notebook: NotebookPenIcon,
  microchip: MicrochipIcon,
  ocr: ScanTextIcon,
  pipeline: WaypointsIcon,
  "database-fast": DatabaseZapIcon,
  "radio-tower": RadioTowerIcon,
  "file-code": FileCodeIcon,
  "git-fork": GitForkIcon,
  "web-app": PanelsTopLeftIcon,
  audio: AudioLinesIcon,
  binary: BinaryIcon,
  dna: DnaIcon,
  atom: AtomIcon,
  circuit: CircuitBoardIcon,
  sigma: SigmaIcon,
  "remote-desktop": MonitorCogIcon,

  server: ServerIcon,
  database: DatabaseIcon,
  globe: GlobeIcon,
  terminal: TerminalIcon,
  code: CodeIcon,
  braces: BracesIcon,
  monitor: MonitorIcon,
  laptop: LaptopIcon,
  smartphone: SmartphoneIcon,
  network: NetworkIcon,
  router: RouterIcon,
  wifi: WifiIcon,
  cable: CableIcon,
  plug: PlugIcon,
  cloud: CloudIcon,
  container: ContainerIcon,
  boxes: BoxesIcon,
  "hard-drive": HardDriveIcon,
  folder: FolderIcon,
  file: FileIcon,
  archive: ArchiveIcon,
  shield: ShieldIcon,
  lock: LockIcon,
  key: KeyRoundIcon,
  fingerprint: FingerprintIcon,
  eye: EyeIcon,
  activity: ActivityIcon,
  chart: ChartNoAxesCombinedIcon,
  gauge: GaugeIcon,
  cpu: CpuIcon,
  memory: MemoryStickIcon,
  bot: BotIcon,
  brain: BrainCircuitIcon,
  search: SearchIcon,
  mail: MailIcon,
  message: MessageSquareIcon,
  video: VideoIcon,
  music: MusicIcon,
  image: ImageIcon,
  gamepad: Gamepad2Icon,
  "git-branch": GitBranchIcon,
  "git-pull": GitPullRequestIcon,
  package: PackageIcon,
  wrench: WrenchIcon,
  settings: SettingsIcon,
  flask: FlaskConicalIcon,
  rocket: RocketIcon,
  zap: ZapIcon,
  star: StarIcon,
  heart: HeartIcon,
  home: HouseIcon,
  building: Building2Icon,
  coffee: CoffeeIcon,
  leaf: LeafIcon,
  layers: LayersIcon,
  workflow: WorkflowIcon,
};
export { catalog as connectionIconCatalog };

export function connectionIconLabelKey(item: { id?: string; value?: string }) {
  return (
    item.id ??
    `emoji-${[...item.value!].map((character) => character.codePointAt(0)!.toString(16)).join("-")}`
  );
}

// A single visible grapheme also supports flags, skin tones and ZWJ emoji.
export function validCustomIcon(value: string) {
  return (
    value.length > 0 &&
    [...value].length <= 16 &&
    value.replace(/[\u200d\ufe00-\ufe0f\u{e0020}-\u{e007f}]/gu, "").length >
      0 &&
    !/[\s\p{Cc}\p{Cf}]/u.test(
      value.replace(/[\u200d\u{e0020}-\u{e007f}]/gu, ""),
    ) &&
    [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        value,
      ),
    ].length === 1
  );
}

export function ConnectionIcon({
  icon,
  color,
}: {
  icon?: RuleIcon | null;
  color: string | null;
}) {
  if (!icon) return <ConnectionColorDot color={color} />;
  const Glyph =
    icon.kind === "builtin" && Object.hasOwn(icons, icon.value)
      ? icons[icon.value as keyof typeof icons]
      : undefined;
  const brand =
    icon.kind === "builtin" && Object.hasOwn(serviceIcons.icons, icon.value)
      ? serviceIcons.icons[icon.value as keyof typeof serviceIcons.icons]
      : undefined;
  if (icon.kind === "builtin" && !Glyph && !brand)
    return <ConnectionColorDot color={color} />;
  return (
    <span
      className="connection-icon"
      style={{ color: color || "var(--oria-color-primary)" }}
      aria-hidden="true"
    >
      {Glyph ? (
        <Glyph size={18} />
      ) : brand ? (
        <svg
          viewBox={brand.viewBox}
          width="18"
          height="18"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          {brand.paths.map((path, i) => (
            <path key={i} d={path} />
          ))}
        </svg>
      ) : (
        icon.value
      )}
    </span>
  );
}

export function ConnectionIconPicker({
  value,
  color,
  onChange,
  fieldLabel,
  initialCategory = "builtin",
}: {
  value: RuleIcon | null;
  color: string | null;
  onChange: (icon: RuleIcon | null) => void;
  fieldLabel?: string;
  initialCategory?: "builtin" | "service";
}) {
  const { t } = useTranslation("tunnel");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [custom, setCustom] = useState(
    value?.kind === "emoji" ? value.value : "",
  );
  const id = useId();
  const label = (item: { id?: string; value?: string }) =>
    t(connectionIconLabelKey(item), { ns: "icons" });
  const matches = (item: {
    zh: string;
    en: string;
    id?: string;
    value?: string;
  }) =>
    `${label(item)} ${item.zh} ${item.en} ${item.id || item.value}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  const selected =
    value?.kind === "builtin"
      ? catalog.icons.find((item) => item.id === value.value)
      : catalog.emojis.find((item) => item.value === value?.value);
  const selectedName = !value
    ? t("defaultIcon")
    : selected
      ? label(selected)
      : value.value;
  const options = (kind: RuleIcon["kind"], category?: "service") => {
    const entries = (
      kind === "builtin"
        ? catalog.icons
            .filter((item) =>
              category
                ? item.category === category
                : item.category !== "service",
            )
            .map((item) => ({ ...item, value: item.id }))
        : catalog.emojis
    ).filter(matches);
    return (
      <ScrollArea
        className="connection-icon-options"
        contentClassName="connection-icon-grid"
      >
        {entries.map((item) => (
          <Button
            key={item.value}
            type="button"
            variant="ghost"
            size="icon"
            className="connection-icon-option"
            aria-label={label(item)}
            title={label(item)}
            aria-pressed={value?.kind === kind && value.value === item.value}
            onClick={() => onChange({ kind, value: item.value })}
          >
            <ConnectionIcon icon={{ kind, value: item.value }} color={color} />
          </Button>
        ))}
        {!entries.length && (
          <p className="muted connection-icon-empty" role="status">
            {t("noMatchingIcons")}
          </p>
        )}
      </ScrollArea>
    );
  };
  const applyCustom = () => {
    if (validCustomIcon(custom)) onChange({ kind: "emoji", value: custom });
  };
  return (
    <div className="field">
      <span id={id}>{fieldLabel ?? t("connectionIcon")}</span>
      <div className="connection-icon-picker">
        <Button
          type="button"
          variant="ghost"
          className="connection-icon-trigger"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-labelledby={`${id} ${id}-selection`}
          onClick={() => setOpen(!open)}
        >
          <ConnectionIcon icon={value} color={color} />
          <span id={`${id}-selection`}>{selectedName}</span>
          <ChevronDownIcon size={16} aria-hidden="true" />
        </Button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={`${id}-panel`}
              key="icon-panel"
              style={{ overflow: "hidden" }}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                duration: reducedMotion ? 0 : 0.22,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <div className="connection-icon-body">
                <div className="connection-icon-tools">
                  <Tabs
                    defaultValue={
                      value?.kind === "emoji"
                        ? "emoji"
                        : value?.kind === "builtin" &&
                            catalog.icons.find((i) => i.id === value.value)
                              ?.category === "service"
                          ? "service"
                          : value
                            ? "builtin"
                            : initialCategory
                    }
                  >
                    <div className="connection-icon-tools-row">
                      <TabsList aria-label={t("iconLibrary")} variant="soft">
                        <TabsTrigger value="builtin">
                          {t("builtinIcons")}
                        </TabsTrigger>
                        <TabsTrigger value="service">
                          {t("serviceIcons", { ns: "commands" })}
                        </TabsTrigger>
                        <TabsTrigger value="emoji">
                          {t("emojiCategory")}
                        </TabsTrigger>
                      </TabsList>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-pressed={!value}
                        onClick={() => onChange(null)}
                      >
                        {t("defaultIcon")}
                      </Button>
                    </div>
                    <Input
                      aria-label={t("searchIcons")}
                      placeholder={t("searchIcons")}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <TabsContent value="builtin">
                      {options("builtin")}
                    </TabsContent>
                    <TabsContent value="service">
                      {options("builtin", "service")}
                    </TabsContent>
                    <TabsContent value="emoji">
                      {options("emoji")}
                      <label
                        className="connection-icon-custom-label"
                        htmlFor={`${id}-custom`}
                      >
                        {t("customEmoji")}
                      </label>
                      <div className="connection-icon-custom-row">
                        <Input
                          id={`${id}-custom`}
                          value={custom}
                          maxLength={64}
                          placeholder="🚀"
                          aria-describedby={`${id}-hint`}
                          aria-invalid={!!custom && !validCustomIcon(custom)}
                          onChange={(event) => setCustom(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              applyCustom();
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!validCustomIcon(custom)}
                          onClick={applyCustom}
                        >
                          {t("useIcon")}
                        </Button>
                      </div>
                      <small
                        id={`${id}-hint`}
                        className={
                          custom && !validCustomIcon(custom)
                            ? "inline-error"
                            : "muted"
                        }
                      >
                        {t("customEmojiHint")}
                      </small>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
