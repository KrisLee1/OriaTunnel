import { Fragment, useEffect, useRef, useState } from "react";
import {
  CornerDownLeft,
  TextCursorInput,
  FolderOpen,
  HardDrive,
  Monitor,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { breadcrumbs, displayPath } from "./api";

const editablePath = (path: string) =>
  path === ":computer:" ? "" : displayPath(path);

export function FilePathNavigation({
  path,
  remote,
  disabled,
  loading,
  editRequest = 0,
  onNavigate,
}: {
  path: string;
  remote: boolean;
  disabled: boolean;
  loading: boolean;
  editRequest?: number;
  onNavigate: (path: string) => Promise<boolean>;
}) {
  const { t } = useTranslation("files");
  const [editing, setEditing] = useState(false);
  const [compact, setCompact] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const [value, setValue] = useState(() => editablePath(path));
  const input = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const lastEditRequest = useRef(editRequest);
  const parts = [
    ...(!remote
      ? [{ label: t("local"), path: ":computer:", disk: false }]
      : []),
    ...breadcrumbs(path, remote).map((part, index) => ({
      ...part,
      disk: !remote && index === 0,
    })),
  ];
  const tail = compact ? 1 : 2;
  const collapsed = parts.length > tail + 2 ? parts.slice(1, -tail) : [];
  const visible = collapsed.length ? [parts[0], ...parts.slice(-tail)] : parts;
  useEffect(() => {
    const element = navigation.current;
    if (!element) return;
    const update = () => setCompact(element.clientWidth < 240);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [editing]);
  useEffect(() => {
    setValue(editablePath(path));
    setEditing(false);
  }, [path, remote]);
  useEffect(() => {
    if (editRequest === lastEditRequest.current) return;
    lastEditRequest.current = editRequest;
    if (disabled || loading) return;
    setValue(editablePath(path));
    setEditing(true);
    input.current?.focus();
    input.current?.select();
  }, [editRequest, path, disabled, loading]);
  const edit = () => {
    setValue(editablePath(path));
    setEditing(true);
  };
  const navigate = async (target: string) => {
    if (disabled || loading || pending.current) return;
    pending.current = true;
    try {
      if (await onNavigate(target)) {
        setEditing(false);
        action.current?.focus();
      }
    } finally {
      pending.current = false;
    }
  };
  return (
    <>
      {editing ? (
        <Input
          ref={input}
          autoFocus
          aria-label={t("path")}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled || loading}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void navigate(value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setValue(editablePath(path));
              setEditing(false);
              action.current?.focus();
            }
          }}
        />
      ) : (
        <Breadcrumb
          ref={navigation}
          aria-label={t("path")}
          className="files-breadcrumb"
          data-compact={compact}
          onDoubleClick={() => !disabled && !loading && edit()}
        >
          <BreadcrumbList>
            {visible.map((part, index) => (
              <Fragment key={part.path}>
                {index > 0 && <BreadcrumbSeparator />}
                {index === 1 && collapsed.length > 0 && (
                  <>
                    <BreadcrumbItem className="files-breadcrumb-overflow">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={disabled || loading}
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="files-breadcrumb-toggle"
                              aria-label={t("collapsedPaths")}
                              title={t("collapsedPaths")}
                            >
                              <BreadcrumbEllipsis />
                            </Button>
                          }
                        />
                        <DropdownMenuContent
                          align="start"
                          className="files-options-popup files-breadcrumb-menu"
                        >
                          {collapsed.map((parent) => (
                            <DropdownMenuItem
                              key={parent.path}
                              title={parent.path}
                              onClick={() => void navigate(parent.path)}
                            >
                              {parent.disk ? <HardDrive /> : <FolderOpen />}
                              <span>{parent.label}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                <BreadcrumbItem>
                  <button
                    type="button"
                    disabled={disabled || loading}
                    aria-current={
                      index === visible.length - 1 ? "page" : undefined
                    }
                    className={
                      compact && part.path === ":computer:"
                        ? "files-breadcrumb-computer"
                        : undefined
                    }
                    aria-label={
                      part.path === ":computer:" ? part.label : undefined
                    }
                    title={part.path === ":computer:" ? part.label : part.path}
                    onClick={() => void navigate(part.path)}
                  >
                    {compact && part.path === ":computer:" ? (
                      <Monitor className="size-3.5" />
                    ) : (
                      part.label
                    )}
                  </button>
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      )}
      <Button
        ref={action}
        variant="ghost"
        size="icon-sm"
        disabled={disabled || loading}
        title={t(editing ? "goToPath" : "editPath")}
        aria-label={t(editing ? "goToPath" : "editPath")}
        onClick={() => (editing ? void navigate(value) : edit())}
      >
        {editing ? <CornerDownLeft /> : <TextCursorInput />}
      </Button>
    </>
  );
}
