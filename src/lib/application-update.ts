import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import * as bridge from "@/lib/bridge";
import { notifyApplicationUpdate } from "@/components/settings/update-notification";
import type { UpdateSnapshot } from "@/types";

export function acceptUpdateSnapshot(
  previous: UpdateSnapshot | null,
  next: UpdateSnapshot,
) {
  return !previous || next.revision >= previous.revision ? next : previous;
}

export function useApplicationUpdate(openAbout: () => void) {
  const { t } = useTranslation("updater");
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(false);
  const notified = useRef("");
  const mounted = useRef(false);
  const accept = useCallback(
    (next: UpdateSnapshot) =>
      setSnapshot((previous) => acceptUpdateSnapshot(previous, next)),
    [],
  );
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    if (bridge.desktop) {
      const subscription = listen<UpdateSnapshot>(
        "tunnel://update",
        (event) => {
          if (!disposed) accept(event.payload);
        },
      );
      void subscription
        .then(() => bridge.updateSnapshot())
        .then((next) => {
          if (!disposed) accept(next);
        })
        .catch(() => {
          if (!disposed) setError("request");
        });
      return () => {
        disposed = true;
        mounted.current = false;
        void subscription.then((off) => off()).catch(() => {});
      };
    }
    return () => {
      mounted.current = false;
    };
  }, [accept]);
  useEffect(() => {
    const version = snapshot?.release?.version;
    if (
      snapshot?.phase === "available" &&
      version &&
      notified.current !== version
    ) {
      notified.current = version;
      notifyApplicationUpdate(version, t, openAbout);
    }
  }, [snapshot, t, openAbout]);
  const request = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
      if (requested.current) return;
      requested.current = true;
      setPending(true);
      setError(null);
      try {
        return await operation();
      } catch (cause) {
        const code = String(cause);
        if (mounted.current)
          setError(
            ["busy", "notReady", "unavailable"].includes(code)
              ? code
              : "request",
          );
        return undefined;
      } finally {
        requested.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [],
  );
  const act = useCallback(
    async (operation: () => Promise<UpdateSnapshot>) => {
      const next = await request(operation);
      if (next && mounted.current) accept(next);
    },
    [request, accept],
  );
  return {
    snapshot,
    pending,
    error,
    refresh: () => act(bridge.updateSnapshot),
    check: () => act(bridge.checkUpdate),
    download: (version: string) => act(() => bridge.downloadUpdate(version)),
    autoCheck: (enabled: boolean) =>
      act(() => bridge.setUpdateAutoCheck(enabled)),
    context: () => request(bridge.updateInstallContext),
    install: (version: string, expectedWorkIds: string[]) =>
      act(() => bridge.installUpdate(version, expectedWorkIds)),
  };
}
