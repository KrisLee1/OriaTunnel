import { useEffect, useRef, useState } from "react";
import { VncWorkspaces } from "./VncWorkspaces";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { LoaderCircleIcon, MonitorOffIcon, RotateCwIcon } from "lucide-react";
import { PageEmptyState } from "@/components/page-empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { keysym, pointerButtons, pointerPosition } from "./input";
import { UPDATE_END, UPDATE_PART, VncFramebuffer } from "./framebuffer";
import { readVncPacket } from "./read-packet";
import { readRenderMode, useVncDisplayPreferences } from "./display-preferences";
import { VncHeader, type Phase } from "./VncHeader";
import { formatNativeMessage } from "@/lib/native-message";
import "./desktop.css";

type Action =
  | { type: "key"; keysym: number; down: boolean }
  | { type: "pointer"; x: number; y: number; buttons: number }
  | { type: "paste"; text: string; controlHeld: boolean }
  | { type: "password"; password: string; remember: boolean };
type Session = { id: string; queue: Action[]; sending: boolean; reader: AbortController };
export function VncDesktop() {
  return (
    <VncWorkspaces>
      <Desktop />
    </VncWorkspaces>
  );
}
function Desktop() {
  const { t } = useTranslation("vnc");
  const { hideLocalCursor, renderMode } = useVncDisplayPreferences();
  const [endpoint, setEndpoint] = useState("");
  const [phase, setPhase] = useState<Phase>("connecting");
  const [error, setError] = useState("");
  const [scale, setScale] = useState("fit");
  const [size, setSize] = useState<[number, number]>([1, 1]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const framebuffer = useRef<VncFramebuffer | null>(null);
  useEffect(() => {
    framebuffer.current?.setMode(renderMode);
  }, [renderMode]);
  const secret = useRef<HTMLInputElement>(null);
  const [remember, setRemember] = useState(false);
  const [vaultAvailable, setVaultAvailable] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);
  const clipboard = useRef<string | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const pasteRequest = useRef(0);
  const [manualClipboard, setManualClipboard] = useState<
    "copy" | "paste" | null
  >(null);
  const held = useRef(new Map<string, number>());
  const pointer = useRef({ x: 0, y: 0, buttons: 0 });
  const session = useRef<Session | null>(null);
  const attempt = useRef(0);
  function endSession() {
    attempt.current++;
    framebuffer.current?.dispose();
    framebuffer.current = null;
    const current = session.current;
    session.current = null;
    if (current) {
      current.reader.abort();
      current.queue.length = 0;
      void invoke("vnc_end", { id: current.id }).catch(() => {});
    }
    held.current.clear();
    pointer.current = { x: 0, y: 0, buttons: 0 };
    clipboard.current = null;
    cancelClipboard();
    if (secret.current) secret.current.value = "";
  }
  function stop() {
    endSession();
    setRemember(false);
    setSavedPassword(false);
    setManualClipboard(null);
    setPhase("disconnected");
  }
  useEffect(() => {
    let active = true;
    void invoke<string>("vnc_endpoint")
      .then((v) => {
        if (active) {
          setEndpoint(v);
          void connect();
        }
      })
      .catch((e) => {
        if (active) {
          setPhase("disconnected");
          setError(String(e));
        }
      });
    return () => {
      active = false;
      endSession();
    };
  }, []);
  function send(action: Action, move = false) {
    const current = session.current;
    if (!current) return;
    const last = current.queue.at(-1);
    if (
      move &&
      last?.type === "pointer" &&
      action.type === "pointer" &&
      last.buttons === action.buttons
    )
      current.queue[current.queue.length - 1] = action;
    else current.queue.push(action);
    if (current.queue.length > 512) {
      stop();
      setError(t("inputOverflow"));
      return;
    }
    if (current.sending) return;
    current.sending = true;
    void (async () => {
      try {
        while (current.queue.length && session.current === current) {
          const next = current.queue.shift()!;
          await invoke("vnc_input", { id: current.id, action: next });
        }
      } catch (e) {
        if (session.current === current) {
          stop();
          setError(String(e));
        }
      } finally {
        current.sending = false;
      }
    })();
  }
  function release() {
    cancelClipboard();
    for (const key of held.current.values())
      send({ type: "key", keysym: key, down: false });
    held.current.clear();
    if (pointer.current.buttons) {
      pointer.current.buttons = 0;
      send({ type: "pointer", ...pointer.current });
    }
  }
  useEffect(() => {
    const leaveCanvas = (event: PointerEvent) => {
      if (
        document.activeElement === canvas.current &&
        event.target !== canvas.current
      )
        canvas.current?.blur();
    };
    document.addEventListener("pointerdown", leaveCanvas, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("pointerdown", leaveCanvas, true);
    };
  });
  useEffect(() => {
    const screen = canvas.current;
    if (!screen || phase !== "connected") return;
    const wheel = (e: WheelEvent) => {
      if (document.activeElement !== screen) return;
      e.preventDefault();
      const point = pointerPosition(screen, size, e.clientX, e.clientY);
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const delta = horizontal ? e.deltaX : e.deltaY;
      if (!delta) return;
      const button = horizontal ? 32 : 8;
      const mask = delta < 0 ? button : button * 2;
      send({
        type: "pointer",
        ...point,
        buttons: pointer.current.buttons | mask,
      });
      send({ type: "pointer", ...point, buttons: pointer.current.buttons });
    };
    // Chromium can deliver motion before its next paint. Keep button changes
    // on pointerdown/up and retain pointermove on other engines.
    const motionEvent =
      "onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove";
    const motion = (event: Event) => {
      const e = event as PointerEvent;
      if (
        document.activeElement !== screen ||
        pointerButtons(e.buttons) !== pointer.current.buttons
      ) return;
      const point = {
        ...pointerPosition(screen, size, e.clientX, e.clientY),
        buttons: pointer.current.buttons,
      };
      if (point.x === pointer.current.x && point.y === pointer.current.y) return;
      pointer.current = point;
      send({ type: "pointer", ...point }, true);
    };
    screen.addEventListener(motionEvent, motion);
    screen.addEventListener("wheel", wheel, { passive: false });
    return () => {
      screen.removeEventListener(motionEvent, motion);
      screen.removeEventListener("wheel", wheel);
    };
  }, [phase, size]);
  async function connect(skipSaved = false) {
    stop();
    const token = attempt.current;
    setError("");
    setPhase("connecting");
    try {
      const id = await invoke<string>("vnc_begin", { skipSaved });
      if (token !== attempt.current) {
        await invoke("vnc_end", { id });
        return;
      }
      const reader = new AbortController();
      session.current = { id, queue: [], sending: false, reader };
      let initialSize = true;
      const applyShared = (data: ArrayBuffer) => framebuffer.current!.apply(data);
      while (token === attempt.current) {
        const data = await readVncPacket(id, reader.signal, applyShared);
        if (token !== attempt.current) return;
        if (!data) continue;
        const view = new DataView(data);
        const type = view.getUint8(0);
        const screen = canvas.current!;
        if (type === 0) {
          setVaultAvailable(data.byteLength > 1 && view.getUint8(1) === 1);
          setPhase("credentials");
          continue;
        }
        if (type === 7) {
          setSavedPassword(true);
          continue;
        }
        if (type === 8 && !skipSaved) {
          void connect(true);
          return;
        }
        if (type === 4 || type === 6) {
          const text = new TextDecoder().decode(new Uint8Array(data, 1));
          if (type === 6) setError(text);
          else {
            clipboard.current = text;
            if (copyTimer.current !== undefined) void finishCopy();
          }
          continue;
        }
        if (type === 1) {
          const w = view.getUint16(5), h = view.getUint16(7);
          framebuffer.current ??= new VncFramebuffer(screen, t("canvasError"), readRenderMode());
          framebuffer.current.resize(w, h);
          setSize([w, h]);
          setPhase("connected");
          if (initialSize) {
            initialSize = false;
            requestAnimationFrame(() => {
              if (
                token === attempt.current &&
                !document.activeElement?.closest(
                  ".workspace-panel, [role=dialog]",
                )
              )
                screen.focus();
            });
          }
          continue;
        }
        if (type === UPDATE_PART || type === UPDATE_END)
          framebuffer.current!.apply(data);
      }
    } catch (e) {
      if (token === attempt.current) {
        stop();
        setError(String(e));
      }
    }
  }
  const connected = phase === "connected";
  function cancelClipboard() {
    window.clearTimeout(copyTimer.current);
    copyTimer.current = undefined;
    pasteRequest.current++;
  }
  async function finishCopy() {
    window.clearTimeout(copyTimer.current);
    copyTimer.current = undefined;
    const current = session.current;
    const text = clipboard.current;
    if (!current || text === null || document.activeElement !== canvas.current)
      return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      if (
        session.current === current &&
        document.activeElement === canvas.current
      )
        setManualClipboard("copy");
    }
  }
  function pasteText(text: string) {
    if (!text) return;
    send({
      type: "paste",
      text,
      controlHeld: [...held.current.values()].some(
        (key) => key === 0xffe3 || key === 0xffe4,
      ),
    });
  }
  async function paste() {
    const current = session.current;
    const request = ++pasteRequest.current;
    try {
      const text = await navigator.clipboard.readText();
      if (current === session.current && request === pasteRequest.current)
        pasteText(text);
    } catch {
      if (current === session.current && request === pasteRequest.current)
        setManualClipboard("paste");
    }
  }
  const gesture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (document.activeElement !== e.currentTarget) return;
    const point = {
      ...pointerPosition(e.currentTarget, size, e.clientX, e.clientY),
      buttons: pointerButtons(e.buttons),
    };
    pointer.current = point;
    send({ type: "pointer", ...point }, e.type === "pointermove");
  };
  return (
    <main
      className="app-shell vnc-desktop"
      onPointerDownCapture={(e) => {
        if (e.target instanceof Element && e.target.closest(".app-titlebar")) {
          release();
          if (document.activeElement === canvas.current) canvas.current?.blur();
        }
      }}
    >
      <VncHeader
        endpoint={endpoint}
        phase={phase}
        hideLocalCursor={hideLocalCursor}
        renderMode={renderMode}
        scale={scale}
        savedPassword={savedPassword}
        onForgetPassword={async () => {
          const current = session.current;
          if (!current) return;
          try {
            await invoke("vnc_forget_password", { id: current.id });
            if (session.current === current) setSavedPassword(false);
          } catch (e) {
            if (session.current === current) setError(String(e));
          }
        }}
        onZoom={(action) => {
          const screen = canvas.current;
          if (!screen) return;
          if (action === "fit") setScale("fit");
          else {
            const ratio =
              scale === "fit"
                ? screen.getBoundingClientRect().width / size[0]
                : Number(scale);
            const levels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
            const next =
              action === "in"
                ? levels.find((n) => n > ratio + 0.001)
                : levels.reverse().find((n) => n < ratio - 0.001);
            if (next !== undefined) setScale(String(next));
          }
        }}
        onSpecialKeys={() => {
          for (const k of [0xffe3, 0xffe9, 0xffff])
            send({ type: "key", keysym: k, down: true });
          for (const k of [0xffff, 0xffe9, 0xffe3])
            send({ type: "key", keysym: k, down: false });
          canvas.current?.focus();
        }}
      />
      {connected && <span role="status" className="sr-only">{t(phase)}</span>}
      {!connected && phase !== "credentials" && (
        <PageEmptyState
          className="vnc-status overflow-y-auto"
          icon={phase === "disconnected" ? <MonitorOffIcon /> : <LoaderCircleIcon className="motion-safe:animate-spin" />}
          title={<span role="status">{t(phase)}</span>}
          description={error ? (
            <div role="alert" className="text-destructive">{formatNativeMessage(error)}</div>
          ) : phase === "connecting" && endpoint && <div dir="auto">{endpoint}</div>}
          action={phase === "disconnected" && endpoint && (
            <Button variant="primary-soft" size="sm" onClick={() => void connect()}>
              <RotateCwIcon aria-hidden="true" />
              {t("reconnect", { ns: "terminal" })}
            </Button>
          )}
        />
      )}
      {error && (connected || phase === "credentials") && (
        <div role="alert" className="vnc-error">
          {formatNativeMessage(error)}
        </div>
      )}
      {connected && manualClipboard && (
        <Textarea
          key={manualClipboard}
          autoFocus
          aria-label={t(manualClipboard)}
          placeholder={t("pasteHint")}
          readOnly={manualClipboard === "copy"}
          defaultValue={
            manualClipboard === "copy" ? (clipboard.current ?? "") : ""
          }
          onFocus={(e) => {
            if (manualClipboard === "copy") e.currentTarget.select();
          }}
          onCopy={() => {
            if (manualClipboard === "copy")
              requestAnimationFrame(() => {
                setManualClipboard(null);
                canvas.current?.focus();
              });
          }}
          onPaste={(e) => {
            if (manualClipboard === "paste") {
              e.preventDefault();
              pasteText(e.clipboardData.getData("text/plain"));
              setManualClipboard(null);
              canvas.current?.focus();
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setManualClipboard(null);
              canvas.current?.focus();
            }
          }}
        />
      )}
      {phase === "credentials" && (
        <form
          className="vnc-password themed-surface rounded-xl border border-border"
          aria-labelledby="vnc-password-label"
          onSubmit={(e) => {
            e.preventDefault();
            const input = secret.current!;
            send({
              type: "password",
              password: input.value,
              remember: vaultAvailable && remember,
            });
            input.value = "";
            setPhase("connecting");
          }}
        >
          <div className="grid gap-1">
            <label
              id="vnc-password-label"
              htmlFor="vnc-password"
              className="text-base font-semibold"
            >
              {t("credentials")}
            </label>
            <span
              id="vnc-password-target"
              className="break-all text-sm text-muted-foreground"
            >
              {endpoint}
            </span>
          </div>
          <Input
            id="vnc-password"
            autoFocus
            type="password"
            autoComplete="off"
            aria-describedby="vnc-password-target"
            ref={secret}
          />
          <div className="flex items-center justify-end gap-2">
            {vaultAvailable && (
              <label className="mr-auto inline-flex items-center gap-2 text-sm">
                <Checkbox checked={remember} onCheckedChange={setRemember} />
                {t("rememberPassword", { ns: "tunnel" })}
              </label>
            )}
            <Button type="button" variant="outline" onClick={stop}>
              {t("cancel", { ns: "terminal" })}
            </Button>
            <Button type="submit">{t("connect")}</Button>
          </div>
        </form>
      )}
      <div className="vnc-viewport" hidden={!connected}>
        <canvas
          ref={canvas}
          data-vnc-screen
          data-hide-local-cursor={hideLocalCursor}
          data-render-mode={renderMode}
          data-remote-width={size[0]}
          data-remote-height={size[1]}
          tabIndex={0}
          aria-label={t("desktop")}
          style={{
            aspectRatio: size.join(" / "),
            width:
              scale === "fit"
                ? "min(100cqw, calc(100cqh * " + size[0] / size[1] + "))"
                : size[0] * Number(scale),
          }}
          onBlur={release}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            gesture(e);
          }}
          onPointerUp={gesture}
          onPointerCancel={release}
          onLostPointerCapture={() => {
            if (pointer.current.buttons) {
              pointer.current.buttons = 0;
              send({ type: "pointer", ...pointer.current });
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            pasteText(e.clipboardData.getData("text/plain"));
          }}
          onKeyDown={(e) => {
            e.preventDefault();
            if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
              if (e.code === "KeyV") {
                if (!e.repeat) void paste();
                return;
              }
              if (e.code === "KeyC") {
                if (e.repeat) return;
                // Some servers offer a selection before Ctrl+C, others only after receiving it.
                window.clearTimeout(copyTimer.current);
                copyTimer.current = window.setTimeout(
                  finishCopy,
                  clipboard.current === null ? 5000 : 1000,
                );
              }
            }
            const key = held.current.get(e.code) || keysym(e.key, e.location);
            if (key) {
              held.current.set(e.code, key);
              send({ type: "key", keysym: key, down: true });
            }
          }}
          onKeyUp={(e) => {
            e.preventDefault();
            const key = held.current.get(e.code);
            if (key) {
              held.current.delete(e.code);
              send({ type: "key", keysym: key, down: false });
            }
          }}
        />
      </div>
    </main>
  );
}
