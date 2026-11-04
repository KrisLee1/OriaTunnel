import { useId, useRef, useState } from "react";
import {
  CopyPlus,
  HardDrive,
  Replace,
  Server,
  SkipForward,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { displayPath, type Task } from "./api";

export type ConflictPolicy = "skip" | "keep" | "replace";
type ContentProps = {
  task: Task;
  busy: boolean;
  error: string;
  applyAll: boolean;
  onApplyAll: (value: boolean) => void;
  onResolve: (policy: ConflictPolicy) => void;
};

export function TransferConflictContent({
  task,
  busy,
  error,
  applyAll,
  onApplyAll,
  onResolve,
}: ContentProps) {
  const { t } = useTranslation("files");
  const applyAllId = useId();
  const remote = !!task.targetRemote || task.direction !== "download";
  const host =
    task.targetRemote?.hostName || (remote ? task.hostName : t("local"));
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("conflict")}</DialogTitle>
        <DialogDescription>{t("conflictDescription")}</DialogDescription>
      </DialogHeader>
      <div className="files-conflict-target oria-control-surface">
        <strong>
          {remote ? <Server /> : <HardDrive />}
          {host}
        </strong>
        <code data-selectable="true">
          {displayPath(task.conflict || task.destination || task.target)}
        </code>
      </div>
      <div className="files-conflict-apply-all">
        <Checkbox
          id={applyAllId}
          checked={applyAll}
          disabled={busy}
          onCheckedChange={onApplyAll}
        />
        <Label htmlFor={applyAllId}>{t("applyToAll")}</Label>
      </div>
      {task.error && task.error !== "conflict" && (
        <p className="files-error">
          {t(task.error, { defaultValue: task.error })}
        </p>
      )}
      {error && (
        <p role="alert" className="files-error">
          {t(error, { defaultValue: error })}
        </p>
      )}
      <DialogFooter className="files-conflict-footer sm:flex-wrap">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onResolve("skip")}
        >
          <SkipForward />
          {t("skip")}
        </Button>
        <Button disabled={busy} onClick={() => onResolve("keep")}>
          <CopyPlus />
          {t("keep")}
        </Button>
        <Button
          variant="destructive"
          disabled={busy || task.error === "replaceUnsupported"}
          onClick={() => onResolve("replace")}
        >
          <Replace />
          {t("replace")}
        </Button>
      </DialogFooter>
    </>
  );
}

export function TransferConflictDialog({
  task,
  onResolve,
  onClose,
}: {
  task: Task;
  onResolve: (
    task: Task,
    policy: ConflictPolicy,
    applyAll: boolean,
  ) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation("files");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applyAll, setApplyAll] = useState(false);
  const pending = useRef(false);
  const resolve = async (policy: ConflictPolicy) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onResolve(task, policy, applyAll);
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending.current && onClose()}
    >
      <DialogContent
        className="files-conflict-dialog sm:max-w-lg"
        closeLabel={t("close")}
        showCloseButton={!busy}
      >
        <TransferConflictContent
          task={task}
          busy={busy}
          error={error}
          applyAll={applyAll}
          onApplyAll={setApplyAll}
          onResolve={(policy) => void resolve(policy)}
        />
      </DialogContent>
    </Dialog>
  );
}
