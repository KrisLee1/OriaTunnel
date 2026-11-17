// This module is bundled only into the disposable native QA frontend.
const ipc = (name, args = {}) => window.__TAURI_INTERNALS__.invoke(name, args);
const report = (stage, error) =>
  fetch(reportURL, { method: "POST", body: JSON.stringify({ stage, error }) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, label) {
  for (let i = 0; i < 180; i++) {
    const value = await read();
    if (value) return value;
    await sleep(55);
  }
  throw Error(
    "Missing " +
      label +
      "; sessions " +
      JSON.stringify(
        (await ipc("terminal_sessions")).map((s) => [
          s.hostId,
          s.phase,
          s.error,
        ]),
      ) +
      "; dialogs " +
      visible("[role=dialog]")
        .map((e) => e.textContent.slice(0, 120))
        .join(","),
  );
}
function setValue(el, value, inputType) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(
    el,
    value,
  );
  el.dispatchEvent(
    inputType
      ? new InputEvent("input", { bubbles: true, inputType })
      : new Event("input", { bubbles: true }),
  );
}
function key(el, key) {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}
const visible = (selector) =>
  [...document.querySelectorAll(selector)].filter(
    (el) =>
      el.getBoundingClientRect().width && el.getBoundingClientRect().height,
  );
const editor = () => visible(".shell-edit textarea").at(-1);
async function run(line) {
  const input = await until(editor, "editor");
  setValue(input, line);
  await sleep(20);
  key(input, "Enter");
  await until(() => editor() && editor() !== input, "next prompt");
}
async function toggleOutput(owner, action) {
  const more = owner.querySelector(".shell-block-more");
  const options = { bubbles: true, cancelable: true, button: 0 };
  for (const type of ["mousedown", "mouseup", "click"])
    more.dispatchEvent(new MouseEvent(type, options));
  const item = await until(
    () =>
      visible(
        '[data-terminal-block-menu] [data-output-action="' + action + '"]',
      ).at(-1),
    action + " output menu item",
  );
  item.click();
  await until(
    () => !item.isConnected || !item.getBoundingClientRect().width,
    "action menu closed",
  );
}
async function checkPreviewFade(el, top, bottom) {
  let geometry;
  await until(
    () => {
      const style = getComputedStyle(el);
      if (el.classList.contains("scroll-fade"))
        geometry = [
          el.scrollTop,
          el.scrollHeight,
          el.clientHeight,
          style.getPropertyValue("--scroll-fade-t"),
          style.getPropertyValue("--scroll-fade-b"),
        ];
      const active = (edge) =>
        parseFloat(style.getPropertyValue("--scroll-fade-" + edge)) > 0.1;
      return (
        el.classList.contains("scroll-fade") &&
        style.maskImage.includes("gradient") &&
        active("t") === top &&
        active("b") === bottom
      );
    },
    "shared scroll-fade at " + el.scrollTop + " (" + top + ", " + bottom + ")",
  ).catch((error) => {
    throw Error(error.message + " geometry=" + JSON.stringify(geometry));
  });
}
async function foldCommand(block, collapse) {
  const trigger = block.querySelector(".shell-fold");
  trigger.click();
  await until(
    () => trigger.getAttribute("aria-expanded") === String(!collapse),
    "command disclosure",
  );
  if (
    collapse &&
    (!block.querySelector(".shell-summary") ||
      block.querySelector(".shell-command,.shell-output-text"))
  )
    throw Error("command did not fold to its path and summary");
}
function checkSticky(block, pane) {
  const header = block.querySelector(".shell-sticky");
  const top = pane.getBoundingClientRect().top;
  if (getComputedStyle(header).backgroundColor !== "rgba(0, 0, 0, 0)")
    throw Error("sticky header has a fill");
  const output = header.nextElementSibling;
  if (output && output.getBoundingClientRect().top < top - 2) {
    const overlap =
      header.getBoundingClientRect().bottom -
      output.getBoundingClientRect().top;
    const clip = Math.max(
      0,
      ...[...getComputedStyle(output).clipPath.matchAll(/([\d.]+)px/g)].map(
        (v) => Number(v[1]),
      ),
    );
    if (Math.abs(clip - overlap) > 2)
      throw Error("output overlaps transparent sticky header");
  }
  if (
    Math.abs(header.getBoundingClientRect().top - top) > 2 ||
    !header.querySelector(".shell-heading") ||
    !header.querySelector(".shell-command")
  ) {
    throw Error(
      "path and command did not stick together at " +
        top +
        ": " +
        header.getBoundingClientRect().top,
    );
  }
}
async function verifyVirtualOutput(shell, lineCount) {
  const command = `awk 'BEGIN {for(i=1;i<=${lineCount};i++) printf "\\033[36mrow-%05d\\033[0m end\\n",i}'`;
  const rowText = (n) => "row-" + String(n).padStart(5, "0") + " end";
  if (lineCount > 5000) {
    const input = editor();
    setValue(input, command + "; sleep 4");
    await sleep(25);
    key(input, "Enter");
    const owner = await until(
      () => visible(".shell-current-block[data-live-output]").at(-1),
      "overflow running command",
    );
    const screen = owner.querySelector(".ssh-terminal-screen"),
      pane = owner.closest(".shell-transcript");
    const liveValues = () =>
      [...screen.querySelectorAll(".xterm-rows > div")].map((el) =>
        el.textContent.replace(/\u00a0/g, " ").trim(),
      );
    await until(() => {
      pane.scrollTop = pane.scrollHeight;
      return liveValues().includes(rowText(lineCount));
    }, "overflow PTY last line");
    const top =
      owner.getBoundingClientRect().top -
      pane.getBoundingClientRect().top +
      pane.scrollTop;
    const height = pane.scrollHeight - pane.clientHeight - top;
    pane.scrollTop = top;
    await until(
      () =>
        liveValues().some((v) =>
          /^row-45\d{3} end$|^row-449\d{2} end$/.test(v),
        ),
      "first retained PTY rows",
    );
    for (let i = 0; i < 16; i++) {
      pane.scrollTop = top + (height * ((i * 7) % 17)) / 17;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const box = pane.getBoundingClientRect(),
        pt = screen.getBoundingClientRect();
      if (
        pt.bottom < box.top + box.height * 0.6 ||
        pt.top > box.top + box.height * 0.6 ||
        !liveValues().some((v) => v.startsWith("row-"))
      )
        throw Error(
          "blank live PTY during overflow scroll " +
            JSON.stringify({
              i,
              top,
              height,
              scroll: pane.scrollTop,
              screen: pt.toJSON(),
              pane: box.toJSON(),
              shift: screen.style.transform,
              first: liveValues()[0],
            }),
        );
    }
    await until(editor, "overflow command completed");
  } else await run(command);
  const block = visible(".shell-block").at(-1),
    pre = block.querySelector(".shell-output-text"),
    pane = block.closest(".shell-transcript");
  const lines = pre.textContent.split("\n");
  const retained = lines.length;
  if (
    block.hasAttribute("data-output-folded") ||
    (lineCount <= 5000
      ? retained !== lineCount
      : retained < 4998 || retained > 5000)
  )
    throw Error("unexpected retained lines: " + retained);
  const firstLine = lineCount - retained + 1;
  if (!lines.every((v, i) => v === rowText(firstLine + i)))
    throw Error(
      "gap, duplicated echo or invalid text in retained scrollback: " +
        lines[0] +
        " / " +
        lines.at(-1),
    );
  await report(
    shell +
      " emitted " +
      lineCount +
      " lines, contiguous retained range " +
      firstLine +
      "–" +
      lineCount,
  );
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  async function scrub(limited) {
    const scroller = limited ? pre : pane;
    if (limited) block.scrollIntoView({ block: "center" });
    const start = limited
      ? 0
      : pre.getBoundingClientRect().top -
        pane.getBoundingClientRect().top +
        pane.scrollTop;
    const available = limited
      ? pre.scrollHeight - pre.clientHeight
      : pre.clientHeight - pane.clientHeight;
    let maxRows = 0,
      samples = 0;
    const intervals = [];
    let last = performance.now();
    for (let i = 0; i < 28; i++) {
      const fraction = ((i * 17) % 29) / 29;
      scroller.scrollTop = start + fraction * available;
      const box = scroller.getBoundingClientRect();
      const x = pre.getBoundingClientRect().left + 28;
      const y = box.top + box.height * 0.6;
      const hit = [0, 3, -3, 6, -6]
        .map((dy) =>
          document.elementFromPoint(x, y + dy)?.closest("[data-output-page]"),
        )
        .find(Boolean);
      if (!hit || !pre.contains(hit) || !hit.textContent.includes("row-"))
        throw Error(
          "blank content on scroll jump " +
            i +
            " limited=" +
            limited +
            " geometry=" +
            JSON.stringify({
              point: [x, y],
              pane: [box.top, box.height],
              pos: scroller.scrollTop,
              output: pre.getBoundingClientRect().toJSON(),
              clip: pre.style.clipPath,
              hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 150),
              pageCount: pre.querySelectorAll("[data-output-page]").length,
              firstpage: pre.firstElementChild
                ?.getBoundingClientRect()
                .toJSON(),
            }),
        );
      samples++;
      await frame();
      const now = performance.now();
      intervals.push(now - last);
      last = now;
      maxRows = Math.max(
        maxRows,
        pre.querySelectorAll("[data-output-row]").length,
      );
    }
    if (maxRows === 0 || maxRows > retained / 4)
      throw Error("unbounded virtual row count " + maxRows);
    await until(
      () =>
        [...pre.querySelectorAll("[data-output-row] [style]")].some((el) => {
          const r = el.getBoundingClientRect(),
            box = scroller.getBoundingClientRect();
          return (
            el.style.color && r.top >= box.top + 48 && r.bottom <= box.bottom
          );
        }),
      "ANSI on visible virtual rows",
    );
    intervals.sort((a, b) => a - b);
    await report(
      shell +
        " " +
        (limited ? "preview" : "expanded") +
        " " +
        lineCount +
        " rows, " +
        samples +
        " nonblank jumps, peak mounted rows " +
        maxRows +
        ", frame interval p95 " +
        Math.round(intervals[Math.floor(intervals.length * 0.95)]) +
        "ms",
    );
  }
  await scrub(false);
  await run("printf 'short-after-large\\n'");
  await until(
    () =>
      block.hasAttribute("data-output-folded") &&
      pre.clientHeight < pre.scrollHeight,
    "automatically limited older output",
  );
  if (
    block.querySelector(".shell-summary") ||
    !block.querySelector(".shell-command")
  )
    throw Error("auto limit folded entire command");
  await scrub(true);
  if (
    !pre.textContent.startsWith(rowText(firstLine)) ||
    !pre.textContent.endsWith(rowText(lineCount))
  )
    throw Error("virtual list lost retained text");
  const range = document.createRange();
  range.selectNodeContents(pre);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  pre.scrollTop = 0;
  await frame();
  pre.scrollTop = pre.scrollHeight;
  await frame();
  if (selection.toString() !== lines.join("\n"))
    throw Error("cross-window selection lost retained rows");
  selection.removeAllRanges();
  await toggleOutput(block, "expand");
  const shortBlock = visible(".shell-block").at(-1);
  await run("echo next-after-manual-expansion");
  if (
    !block.isConnected ||
    !shortBlock.isConnected ||
    block.hasAttribute("data-output-folded") ||
    shortBlock.hasAttribute("data-output-folded")
  )
    throw Error(
      "auto preview overrode manual expansion or limited short output",
    );
}
async function verifyCommandHistory(shell) {
  for (let i = 1; i <= 40; i++) await run("printf 'history-window-%d\\n' " + i);
  const pane = editor().closest(".shell-transcript"),
    blocks = [...pane.querySelectorAll(".shell-block")];
  await until(
    () => blocks.some((b) => b.hasAttribute("data-defer-history")),
    "history virtual window",
  );
  for (const n of [4200, 50000]) {
    const retained = blocks.find((block) =>
      block
        .querySelector(".shell-command")
        ?.textContent.includes("i<=" + n + ";"),
    );
    if (
      !retained
        ?.querySelector(".shell-output-text")
        ?.textContent.endsWith("row-" + String(n).padStart(5, "0") + " end")
    )
      throw Error("older large command was lost");
  }
  for (const i of [2, 30, 9, 38, 17, 0]) {
    const block = blocks[blocks.length - 40 + i],
      output = block.querySelector(".shell-output-text");
    output.scrollIntoView({ block: "center" });
    const box = output.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 24, box.top + 6);
    if (
      !output.contains(hit) ||
      !output.textContent.includes("history-window-" + (i + 1))
    )
      throw Error("history block missing on jump " + i);
    await until(
      () => !block.hasAttribute("data-defer-history"),
      "history controls and styles entered window",
    );
  }
  await report(
    shell +
      " 40 successive commands, nonblank history jumps with virtualized output",
  );
}
async function verifyOutput(cfg, shell) {
  const longCommand = "awk 'BEGIN {for(i=1;i<=120;i++) print i}'";
  const expectedOutput = Array.from({ length: 120 }, (_, i) =>
    String(i + 1),
  ).join("\n");
  const live = editor();
  setValue(live, longCommand + "; sleep 6");
  await sleep(25);
  key(live, "Enter");
  const liveScreen = await until(
    () =>
      visible(
        ".shell-transcript[data-command-running] .ssh-terminal-screen:not(.shell-screen-hidden)",
      ).at(-1),
    "live output",
  );
  const pane = liveScreen.closest(".shell-transcript"),
    liveOwner = liveScreen.closest(".shell-current-block");
  const liveOutput = liveScreen.parentElement;
  await until(
    () => liveOutput.clientHeight > pane.clientHeight * 2,
    "full live scrollback in transcript",
  );
  // Assert the actual painted renderer; the accessibility mirror is throttled to 1 Hz.
  const liveRows = () =>
    [...liveScreen.querySelectorAll(".xterm-rows > div")].map((row) =>
      row.textContent.trim(),
    );
  pane.scrollTop = pane.scrollHeight;
  await until(
    () => liveRows().includes("120"),
    "last live row through outer scrollport",
  );
  pane.scrollTop +=
    liveOwner.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  await until(
    () => liveRows().includes("1"),
    "first live row through outer scrollport",
  );
  pane.scrollTop +=
    liveOutput.getBoundingClientRect().top -
    pane.getBoundingClientRect().top +
    130;
  await sleep(120);
  checkSticky(liveOwner, pane);
  const firstRow = liveRows()[0];
  pane.scrollTop += 120;
  await until(
    () => firstRow !== liveRows()[0],
    "live PTY follows transcript scroll",
  );
  checkSticky(liveOwner, pane);
  await toggleOutput(liveOwner, "collapse");
  const preview = liveOutput.parentElement;
  await until(
    () =>
      preview.clientHeight > 0 &&
      preview.clientHeight <= pane.clientHeight * 0.46 + 1 &&
      preview.scrollHeight > preview.clientHeight,
    "capped live preview",
  );
  preview.scrollTop = preview.scrollHeight;
  await until(
    () => liveRows().includes("120"),
    "last live row through folded preview",
  );
  await checkPreviewFade(preview, true, false);
  preview.scrollTop = 0;
  await until(
    () => liveRows().includes("1"),
    "first live row through folded preview",
  );
  await checkPreviewFade(preview, false, true);
  await toggleOutput(liveOwner, "expand");
  await until(editor, "long command finished");
  const block = visible(".shell-block").at(-1),
    preOutput = block.querySelector(".shell-output-text"),
    pinned = block.querySelector(".shell-command");
  if (
    pinned?.textContent !== "$ " + longCommand + "; sleep 6" ||
    preOutput?.textContent !== expectedOutput
  )
    throw Error("command and output must occupy separate rows");
  if (
    preOutput.clientHeight < pane.clientHeight * 2 ||
    preOutput.scrollHeight > preOutput.clientHeight + 1 ||
    getComputedStyle(preOutput).maskImage !== "none" ||
    block.querySelector(".shell-output-controls")
  )
    throw Error("output was clipped or had an inner scrollbar or fade");
  pane.scrollTop +=
    block.getBoundingClientRect().top - pane.getBoundingClientRect().top + 200;
  await sleep(50);
  checkSticky(block, pane);
  await toggleOutput(block, "collapse");
  const limit = Math.min(
    18 * parseFloat(getComputedStyle(preOutput).lineHeight),
    pane.clientHeight * 0.46,
  );
  if (
    Math.abs(preOutput.clientHeight - limit) > 1 ||
    preOutput.scrollHeight <= preOutput.clientHeight ||
    !pinned.isConnected ||
    preOutput.textContent !== expectedOutput
  )
    throw Error("archived preview did not retain full output at capped height");
  preOutput.scrollTop = 0;
  await checkPreviewFade(preOutput, false, true);
  preOutput.scrollTop = Math.floor(preOutput.scrollHeight / 2);
  await checkPreviewFade(preOutput, true, true);
  preOutput.scrollTop = preOutput.scrollHeight;
  await checkPreviewFade(preOutput, true, false);
  if (!preOutput.scrollTop) throw Error("folded preview could not reach tail");
  await toggleOutput(block, "expand");
  if (
    preOutput.scrollHeight > preOutput.clientHeight + 1 ||
    preOutput.textContent !== expectedOutput
  )
    throw Error("expand lost output");
  await toggleOutput(block, "collapse");
  await foldCommand(block, true);
  await foldCommand(block, false);
  const restoredPreview = block.querySelector(".shell-output-text");
  if (
    !restoredPreview?.classList.contains("scroll-fade") ||
    restoredPreview.textContent !== expectedOutput ||
    restoredPreview.clientHeight >= restoredPreview.scrollHeight
  )
    throw Error("command fold reset output preview");
  await foldCommand(block, true);
  const laterCommand = "printf 'second-block-%s\\n' ok";
  await run(laterCommand);
  const latest = visible(".shell-block").at(-1);
  if (latest.querySelector(".shell-output-toggle"))
    throw Error("unexpected short output toggle");
  setValue(editor(), "echo unrelated-draft");
  if (
    document.querySelector(
      ".terminal-tab-entry .shell-block-more,.terminal-host-copy",
    )
  )
    throw Error("copy still attached to host");
  let payload;
  Object.defineProperty(navigator.clipboard, "writeText", {
    configurable: true,
    value: async (text) => {
      payload = text;
    },
  });
  const cases = [
    [block, 0, longCommand + "; sleep 6"],
    [block, 1, expectedOutput],
    [block, 2, "$ " + longCommand + "; sleep 6\n" + expectedOutput],
    [latest, 0, laterCommand],
    [latest, 1, "second-block-ok"],
    [latest, 2, "$ " + laterCommand + "\nsecond-block-ok"],
    [editor().closest(".shell-current-block"), 0, "echo unrelated-draft"],
  ];
  for (const [owner, i, text] of cases) {
    const trigger = owner.querySelector(".shell-heading > .shell-block-more");
    trigger.scrollIntoView({ block: "nearest" });
    const row = trigger.parentElement.getBoundingClientRect(),
      icon = trigger.getBoundingClientRect();
    if (Math.abs(icon.right - row.right) > 8)
      throw Error("copy icon not at end of path row");
    const rect = trigger.getBoundingClientRect(),
      x = rect.left + rect.width / 2,
      y = rect.top + rect.height / 2;
    const hover = owner === block && i === 0 && shell === "bash";
    if (cfg.pointer) {
      await fetch(reportURL, {
        method: "POST",
        body: JSON.stringify({
          stage: shell + (hover ? " hover block copy" : " click block copy"),
          click: [x, y],
          hover,
        }),
      });
    } else {
      const options = {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
      };
      if (hover) {
        trigger.dispatchEvent(
          new PointerEvent("pointerover", { ...options, pointerType: "mouse" }),
        );
        for (const type of ["mouseover", "mouseenter", "mousemove"])
          trigger.dispatchEvent(new MouseEvent(type, options));
      } else {
        for (const type of ["mousedown", "mouseup", "click"])
          trigger.dispatchEvent(new MouseEvent(type, options));
      }
    }
    const menu = await until(
      () =>
        visible("[data-terminal-block-menu]").find(
          (el) =>
            el.getAttribute("aria-label") ===
            trigger.getAttribute("aria-label"),
        ),
      "copy menu for " + shell,
    );
    await sleep(230);
    if (getComputedStyle(trigger).opacity !== "1")
      throw Error("open menu lost copy icon");
    if (
      owner.classList.contains("shell-current-block") &&
      menu
        .querySelectorAll("[role=menuitem]")[1]
        .getAttribute("aria-disabled") !== "true"
    )
      throw Error("draft has output from another command");
    if (owner === latest && menu.querySelector("[data-output-action]"))
      throw Error("short output has a fold action");
    const item = menu.querySelectorAll("[role=menuitem]")[i];
    if (cfg.pointer) {
      const r = item.getBoundingClientRect();
      await fetch(reportURL, {
        method: "POST",
        body: JSON.stringify({
          stage: shell + " choose " + (i ? "output" : "command"),
          click: [r.left + r.width / 2, r.top + r.height / 2],
        }),
      });
    } else {
      trigger.dispatchEvent(
        new MouseEvent("mouseleave", { relatedTarget: item }),
      );
      item.click();
    }
    await until(
      () => payload === text,
      "exact copy " +
        i +
        " for folded and scrolled block; received " +
        String(payload).slice(0, 65),
    );
    await until(
      () => !menu.isConnected || !menu.getBoundingClientRect().width,
      "copy menu closed",
    );
    if (
      matchMedia("(hover: hover)").matches &&
      !owner.matches(":hover") &&
      !trigger.matches(":focus-visible")
    ) {
      const style = getComputedStyle(trigger);
      if (parseFloat(style.transitionDelay) < 0.3 || style.opacity !== "1")
        throw Error(
          "copy icon lost its exit grace period: " +
            style.transitionDelay +
            "/" +
            style.opacity,
        );
      await until(
        () => getComputedStyle(trigger).opacity === "0",
        "copy icon faded after grace period",
      );
    }
  }
  delete navigator.clipboard.writeText;
  const vimInput = editor();
  setValue(vimInput, "vim -Nu NONE -n -i NONE -c 'sleep 2' -c 'qa!'");
  await sleep(25);
  key(vimInput, "Enter");
  const fullscreen = await until(
    () => visible(".shell-transcript[data-fullscreen]").at(-1),
    "real Vim alternate screen",
  );
  const vimScreen = fullscreen.querySelector(".ssh-terminal-screen");
  if (
    vimScreen.clientHeight < fullscreen.clientHeight - 2 ||
    visible(".shell-transcript[data-fullscreen] .shell-heading").length
  )
    throw Error("Vim does not fill terminal");
  await until(
    () => editor() && !fullscreen.hasAttribute("data-fullscreen"),
    "Vim exited back to editor",
  );
  await report(
    shell +
      " command folding and independent preview state, shared top and bottom scroll fades, full Vim screen, isolated copy for folded, latest and draft blocks",
  );
}
async function verifySavedCommands(shell) {
  await run("alias ll='echo literal-ll'");
  let input = editor();
  const command = "printf 'library-ok-%s\\n' " + shell;

  const form = () => visible("[data-command-library-editor]").at(-1);
  const savedRows = () => visible('[data-mode="saved"] [role=option]');
  const index = () => ipc("saved_terminal_commands");
  setValue(input, command);
  await sleep(50);
  key(input, "ArrowDown");
  const saveForm = await until(
    () => visible("[data-save-command-popover] form").at(-1),
    "non-modal save popover",
  );
  if (visible("[aria-modal=true]").length || saveForm.querySelector("textarea"))
    throw Error("save used a modal or repeated the command");
  const tags = saveForm.querySelector("input");
  await until(() => document.activeElement === tags, "keyword field focus");
  if (tags.getAttribute("role") !== "combobox")
    throw Error("expected keyword combobox");
  setValue(tags, "创建账户", "insertText");
  const create = await until(
    () =>
      visible("[data-command-keyword-options] [role=option]").find((el) =>
        el.textContent.includes("创建账户"),
      ),
    "create keyword option",
  );
  create.click();
  await until(
    () => saveForm.querySelector(".combobox-chip")?.textContent === "创建账户",
    "created keyword chip",
  );
  setValue(tags, "evox环境，创建账户,ll,", "insertFromPaste");
  await until(
    () => saveForm.querySelectorAll(".combobox-chip").length === 3,
    "deduplicated keyword chips",
  );
  saveForm.requestSubmit();
  await until(
    async () =>
      !visible("[data-save-command-popover]").length &&
      (await index()).entries.some(
        (e) => e.command === command && e.keywords.length === 3,
      ),
    "saved and deduplicated keywords",
  );
  await until(
    () => document.activeElement === input && input.value === command,
    "draft and focus after saving",
  );
  setValue(input, "ll");
  await until(() => savedRows().length, "ll keyword suggestions");
  if (
    input.hasAttribute("aria-activedescendant") ||
    savedRows().some((row) => row.getAttribute("aria-selected") === "true")
  )
    throw Error("passive saved match was preselected");
  key(input, "Enter");
  await until(
    () =>
      editor() &&
      editor() !== input &&
      visible(".shell-output-text").at(-1)?.textContent === "literal-ll",
    "Enter executes the original alias",
  );
  input = editor();
  setValue(input, "账户");
  await until(
    () => savedRows().length && savedRows()[0].textContent === command,
    "partial Chinese keyword",
  );
  key(input, "Escape");
  await until(
    () => !savedRows().length && input.value === "账户",
    "dismiss without changing draft",
  );
  setValue(input, "EVOX环境");
  await until(() => savedRows().length, "second case-insensitive keyword");
  key(input, "ArrowDown");
  await until(
    () =>
      savedRows()[0]?.getAttribute("aria-selected") === "true" &&
      input.value === "EVOX环境",
    "explicit keyboard choice",
  );
  key(input, "Enter");
  await until(
    () => input === editor() && input.value === command && !savedRows().length,
    "insert without executing",
  );
  key(input, "Enter");
  await until(
    () =>
      editor() &&
      editor() !== input &&
      visible(".shell-output-text").at(-1)?.textContent ===
        "library-ok-" + shell,
    "explicit execution of inserted command",
  );
  visible("[data-saved-commands]").at(-1).click();
  const list = await until(
    () => visible("[data-command-library-list]").at(-1),
    "book manager",
  );
  const search = list
    .closest("[role=dialog]")
    .querySelector("input[type=search]");
  setValue(search, "evox");
  const row = await until(
    () =>
      [...list.children].find(
        (el) => el.querySelector("code")?.textContent === command,
      ),
    "manager search",
  );
  row.querySelector("button").click();
  const editForm = await until(form, "edit saved command");
  const editTags = editForm.querySelector("input[role=combobox]");
  for (const count of [3, 2, 1]) {
    if (editForm.querySelectorAll(".combobox-chip-remove").length !== count)
      throw Error("unexpected original keyword selection");
    editForm.querySelector(".combobox-chip-remove").click();
    await until(
      () =>
        editForm.querySelectorAll(".combobox-chip-remove").length === count - 1,
      "remove one keyword",
    );
  }
  setValue(editTags, "evox", "insertText");
  const known = await until(
    () =>
      visible("[data-command-keyword-options] [role=option]").find(
        (el) => el.textContent === "evox环境",
      ),
    "reuse existing keyword",
  );
  known.click();
  await until(
    () => editForm.querySelector(".combobox-chip")?.textContent === "evox环境",
    "reused keyword chip",
  );
  editForm.querySelector(".combobox-chip-remove").click();
  await until(
    () => !editForm.querySelector(".combobox-chip"),
    "remove reused keyword",
  );
  setValue(editTags, "updated-" + shell, "insertText");
  editForm.requestSubmit();
  await until(
    async () =>
      !form() &&
      (await index()).entries.some(
        (e) => e.command === command && e.keywords[0] === "updated-" + shell,
      ),
    "edited keywords",
  );
  const manager = visible("[data-command-library-list]").at(-1);
  setValue(
    manager.closest("[role=dialog]").querySelector("input[type=search]"),
    "updated-" + shell,
  );
  const updated = await until(
    () =>
      [...manager.children].find(
        (el) => el.querySelector("code")?.textContent === command,
      ),
    "updated manager entry",
  );
  updated.querySelectorAll("button")[1].click();
  await until(
    async () => !(await index()).entries.some((e) => e.command === command),
    "deleted saved command",
  );
  key(manager.closest("[role=dialog]"), "Escape");
  await until(
    () => !visible("[data-command-library-list]").length,
    "dismiss manager",
  );
  await report(
    shell +
      " Enter executed literal ll despite keyword match; explicit selection inserted saved command; saved, edited and deleted via command library",
  );
}
function closeSelectedTab() {
  const entry = visible(".terminal-tab-entry").find((el) =>
    el.querySelector("[role=tab][aria-selected=true]"),
  );
  entry.querySelector("button:last-child").click();
}
async function verifyForegroundClose(session) {
  const input = editor();
  setValue(input, "sleep 60");
  await sleep(35);
  key(input, "Enter");
  await until(
    () => visible(".shell-current-block[data-live-output]").length,
    "foreground command",
  );
  if (session.local) {
    await until(
      () =>
        ipc("local_terminal_foreground", {
          id: session.id,
          clientId: session.clientId,
        }),
      "foreground Unix process group",
    );
  }
  closeSelectedTab();
  const confirmation = () =>
    visible("[role=dialog]").find((el) =>
      el.querySelector("button.text-destructive"),
    );
  const dialog = await until(confirmation, "foreground close warning");
  key(dialog, "Escape");
  await until(() => !confirmation(), "cancel close");
  if (
    !(await ipc("terminal_sessions")).some(
      (s) => s.id === session.id && s.phase === "running",
    )
  )
    throw Error("cancel interrupted foreground session");
  closeSelectedTab();
  (await until(confirmation, "confirm foreground close"))
    .querySelector("button.text-destructive")
    .click();
  await until(
    async () =>
      !(await ipc("terminal_sessions")).some((s) => s.id === session.id),
    "confirmed tab removed",
  );
}
async function verifyLocal(cfg, hostId) {
  await ipc("show_main_window");
  await ipc("plugin:event|emit", {
    event: "tunnel://open-terminal",
    payload: {},
  });
  const start = await until(
    () => visible("[data-terminal-start]").at(-1),
    "empty terminal host list",
  );
  if (
    (await ipc("terminal_sessions")).length ||
    visible("[role=dialog]").length ||
    !start.querySelector('[data-terminal-target="' + hostId + '"]')
  )
    throw Error("unexpected connection, modal or missing host on first open");
  start.querySelector('[data-terminal-target=""]').click();
  const input = await until(editor, "local integrated shell");
  const current = (await ipc("terminal_sessions")).find(
    (s) => s.local && s.phase === "running",
  );
  if (
    !current ||
    !current.endpoint.endsWith("/" + cfg.localShell) ||
    current.routeHostIds.length
  )
    throw Error("expected independent local PTY");
  await run("pwd; stty size");
  const lines = visible(".shell-output-text").at(-1).textContent.split("\n");
  const after = (await ipc("terminal_sessions")).find(
    (s) => s.id === current.id,
  );
  if (
    lines[0] !== cfg.localHome ||
    lines.at(-1) !== after.rows + " " + after.cols
  )
    throw Error("incorrect local cwd or PTY size: " + JSON.stringify(lines));
  setValue(editor(), "exit 7");
  await sleep(35);
  key(editor(), "Enter");
  await until(
    async () =>
      (await ipc("terminal_sessions")).some(
        (s) => s.id === current.id && s.finishedAt !== null && s.exitCode === 7,
      ),
    "local exit code",
  );
  const more = visible("[data-terminal-new]").at(-1);
  const openMenu = async () => {
    for (const type of ["mousedown", "mouseup", "click"])
      more.dispatchEvent(
        new MouseEvent(type, { button: 0, bubbles: true, cancelable: true }),
      );
    return until(
      () => visible(".terminal-target-menu").at(-1),
      "new terminal menu",
    );
  };
  const menu = await openMenu();
  if (
    visible("[role=dialog]").length ||
    !menu.querySelector('[data-terminal-target="' + hostId + '"]')
  )
    throw Error("missing SSH target in non-modal menu");
  const lastHost = menu.querySelector(
    '[data-terminal-target="' + hostId + '"]',
  );
  const local = menu.querySelector('[data-terminal-target=""]');
  local.focus();
  key(local, "End");
  await until(
    () => document.activeElement === lastHost,
    "End selects SSH host",
  );
  key(lastHost, "Home");
  await until(
    () => document.activeElement === local,
    "Home selects local terminal",
  );
  local.click();
  await until(() => editor() && editor() !== input, "second local terminal");
  const session = (await ipc("terminal_sessions")).find(
    (s) => s.local && s.finishedAt === null,
  );
  await verifyForegroundClose(session);
  const idleMenu = await openMenu();
  idleMenu.querySelector('[data-terminal-target=""]').click();
  await until(editor, "idle local shell");
  const idle = (await ipc("terminal_sessions")).find(
    (s) => s.local && s.finishedAt === null,
  );
  await run("sleep 2 &");
  closeSelectedTab();
  await until(
    async () => !(await ipc("terminal_sessions")).some((s) => s.id === idle.id),
    "background job permits direct close",
  );
  const remoteMenu = await openMenu();
  remoteMenu.querySelector('[data-terminal-target="' + hostId + '"]').click();
  await until(
    async () =>
      (await ipc("terminal_sessions")).some(
        (s) => !s.local && s.hostId === hostId,
      ),
    "selected SSH target starts connecting",
  );
  await report(
    cfg.localShell +
      " start page, local PTY cwd and dimensions, exit 7, keyboard target menu, foreground group and close confirmation/cancel, direct close with background job, loopback SSH selection",
  );
}

async function verify(cfg, shell) {
  const id = "qa-" + shell;
  await ipc("save_host", {
    host: {
      id,
      name: id,
      address: "127.0.0.1",
      port: cfg.ports[shell],
      user: "tester",
      authMethod: "password",
      identityFiles: [],
      source: "manual",
      diagnostics: [],
      tags: [],
      hidden: false,
      connection: {
        connectTimeoutSecs: 15,
        keepaliveIntervalSecs: 15,
        keepaliveMax: 3,
      },
      identitiesOnly: false,
      fieldSources: {},
      configuredForwards: [],
    },
  });
  if (cfg.localOnly) {
    await verifyLocal(cfg, id);
    return;
  }
  async function connect() {
    await ipc("plugin:event|emit", {
      event: "tunnel://open-terminal",
      payload: { hostId: id },
    });
    const approveFixture = async () => {
      const verifying = (await ipc("terminal_sessions")).find(
        (s) => s.hostId === id && s.phase === "verifying-host" && s.fingerprint,
      );
      if (verifying)
        await ipc("trust_host", {
          id: verifying.id,
          runId: verifying.id,
          fingerprint: verifying.fingerprint,
        });
    };
    const pwd = await until(async () => {
      await approveFixture();
      return visible("[role=dialog] input[type=password]").at(-1);
    }, "one-time auth");
    setValue(pwd, cfg.secret);
    pwd.closest("form").requestSubmit();
    await until(async () => {
      await approveFixture();
      return editor();
    }, "integrated prompt");
  }
  await connect();
  await ipc("show_main_window");
  if (cfg.overflowOnly) {
    await verifyVirtualOutput(shell, 4200);
    await verifyVirtualOutput(shell, 50000);
    await verifyCommandHistory(shell);
    return;
  }
  if (cfg.libraryOnly) {
    await verifySavedCommands(shell);
    return;
  }
  if (cfg.outputOnly) {
    await verifyOutput(cfg, shell);
    return;
  }
  const noMatches = await until(
    () => editor() === document.activeElement && editor(),
    "focused prompt after SSH authentication",
  );
  setValue(noMatches, "qa_unknown_prefix_7391");
  await sleep(60);
  key(noMatches, "Tab");
  await sleep(250);
  if (
    visible(".shell-candidates").length ||
    document.activeElement !== noMatches
  )
    throw Error(
      "Empty completion obstructed editing; candidates=" +
        visible(".shell-candidates").length +
        ", focus=" +
        document.activeElement?.className,
    );
  key(noMatches, "Escape");
  noMatches.blur();
  await until(
    () => document.activeElement === noMatches,
    "unclaimed focus restored to terminal",
  );
  const panel = noMatches.closest(".terminal-workspace");
  const pane = noMatches.closest(".shell-transcript").getBoundingClientRect();
  const blankPoint = [pane.left + pane.width / 2, pane.bottom - 14];
  const blank = document.elementFromPoint(...blankPoint);
  if (
    !panel.contains(blank) ||
    blank.closest("button,input,textarea,pre") ||
    blankPoint[1] <= noMatches.getBoundingClientRect().bottom
  )
    throw Error("no blank space below prompt: " + blank.className);
  noMatches.setSelectionRange(3, 3);
  if (cfg.pointer) {
    let hit = false;
    blank.addEventListener(
      "mousedown",
      () => {
        hit = true;
      },
      { once: true },
    );
    await fetch(reportURL, {
      method: "POST",
      body: JSON.stringify({
        stage: shell + " lower blank click",
        click: blankPoint,
      }),
    });
    if (!hit) throw Error("native lower blank click missed");
  } else {
    for (const type of ["mousedown", "mouseup", "click"])
      blank.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true }),
      );
  }
  await sleep(100);
  await until(
    () => document.activeElement === noMatches,
    "caret after clicking panel background",
  );
  const oldText = noMatches.value,
    startAt = noMatches.selectionStart,
    endAt = noMatches.selectionEnd;
  if (startAt !== 3 || endAt !== 3)
    throw Error(
      "lower blank click moved the input caret to " + startAt + "/" + endAt,
    );
  const inserted = document.execCommand("insertText", false, "x");
  const wanted = oldText.slice(0, startAt) + "x" + oldText.slice(endAt);
  if (noMatches.value !== wanted)
    throw Error(
      "blank click lost typing: inserted=" +
        inserted +
        " caret=" +
        startAt +
        "/" +
        endAt +
        " length=" +
        oldText.length +
        " result=" +
        noMatches.value,
    );
  const heading = visible(".shell-heading").at(-1);
  if (
    !heading?.firstElementChild?.matches(".shell-path") ||
    heading.textContent.includes("tester@") ||
    visible(".shell-dollar").at(-1)?.textContent !== "$"
  )
    throw Error("Two-line path and dollar prompt");
  await run("mkdir -p Downloads/'Two Words' Downloads/scroll-{01..32}");
  await report(shell + " prompt and command");
  const input = editor();
  setValue(input, "cd Dow");
  await until(
    () => visible(".shell-ghost").some((el) => el.textContent === "nloads/"),
    "ghost Downloads",
  );
  key(input, "ArrowRight");
  await until(() => input.value === "cd Downloads/", "right arrow acceptance");
  setValue(input, "cd Dow");
  key(input, "Tab");
  const option = await until(
    () =>
      visible(".shell-candidates [role=option]").find(
        (el) => el.textContent === "Downloads/",
      ),
    "Tab list",
  );
  option.click();
  await until(() => input.value === "cd Downloads/", "candidate insertion");
  await run(input.value);
  await until(
    () =>
      visible(".shell-path").at(-1)?.querySelector("[aria-current=location]")
        ?.textContent === "Downloads",
    "confirmed working directory",
  );
  await report(shell + " completion");
  if (cfg.pointer) {
    const clickInput = editor();
    const clickLine =
      "printf '%s\\n' '" +
      "x".repeat(Math.ceil(clickInput.clientWidth / 6)) +
      "中文😀'";
    setValue(clickInput, clickLine);
    await sleep(100);
    await ipc("show_main_window");
    clickInput.scrollIntoView({ block: "center" });
    await sleep(160);
    const mirror = clickInput.parentElement.querySelector(
      ".shell-mirror > span",
    ).firstChild;
    const offset = clickLine.indexOf("文");
    const range = document.createRange();
    range.setStart(mirror, offset);
    range.setEnd(mirror, offset + 1);
    const cell = range.getBoundingClientRect();
    let hit = "none";
    document.addEventListener(
      "pointerdown",
      (e) => {
        hit = [e.target.tagName, e.clientX, e.clientY].join(" ");
      },
      { once: true, capture: true },
    );
    await fetch(reportURL, {
      method: "POST",
      body: JSON.stringify({
        stage: shell + " mouse",
        click: [cell.left + cell.width * 0.17, cell.top + cell.height / 2],
      }),
    });
    await sleep(200);
    if (clickInput.selectionStart !== offset)
      throw Error(
        "Native click expected " +
          offset +
          " got " +
          clickInput.selectionStart +
          "; hit " +
          hit +
          "; target " +
          [cell.x, cell.y, cell.width, cell.height, clickInput.scrollTop],
      );
    document.execCommand("insertText", false, "新");
    if (!clickInput.value.includes("中新文😀"))
      throw Error("wrong insertion point");
    await run(clickInput.value);
    const received = visible(".shell-block pre").at(-1)?.textContent || "";
    if (
      !received.split("\n").some((line) => line.trimEnd().endsWith("中新文😀"))
    )
      throw Error(
        "Clicked text output tail " + JSON.stringify(received.slice(-110)),
      );
  }
  await run("printf '%s\\n' '中文😀'");
  const output = await until(
    () => visible(".shell-block pre").at(-1)?.textContent.includes("中文😀"),
    "unicode output",
  );
  if (!output) throw Error("output");
  // Drag across the echoed command and its output, including a styled span.
  await run("printf '\\033[1;32mcopy-result\\033[0m\\n'");
  const pre = visible(".shell-block pre").at(-1);
  pre.scrollIntoView({ block: "center" });
  await sleep(100);
  const walker = document.createTreeWalker(
    pre.closest(".shell-block"),
    NodeFilter.SHOW_TEXT,
  );
  let first, last;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!first && n.textContent.includes("printf")) first = n;
    if (n.textContent.includes("copy-result")) last = n;
  }
  if (!first || !last || first === last)
    throw Error("missing selectable command or styled output");
  const range = document.createRange();
  range.setStart(first, first.textContent.indexOf("printf"));
  range.setEnd(last, last.textContent.lastIndexOf("copy-result") + 11);
  const expected =
    first.textContent.slice(range.startOffset) +
    "\n" +
    last.textContent.slice(0, range.endOffset);
  const rects = range.getClientRects();
  const start = rects[0],
    end = rects[rects.length - 1];
  const point = [start.left + 1, start.top + start.height / 2];
  const gesture = async (click, right = false) =>
    fetch(reportURL, {
      method: "POST",
      body: JSON.stringify({
        stage: shell + (right ? " context click" : " drag"),
        click,
        right,
      }),
    });
  if (cfg.pointer)
    await gesture([...point, end.right - 1, end.top + end.height / 2]);
  else {
    pre.focus();
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
  await until(
    () => window.getSelection()?.toString() === expected,
    "drag from command through colored output",
  );
  const paint = () =>
    visible(".shell-selection i").map((el) => {
      const { left, top, width, height } = el.getBoundingClientRect();
      return [left, top, width, height, getComputedStyle(el).backgroundColor];
    });
  await until(
    () => paint().length >= 2,
    "selected lines painted before context click",
  );
  const before = JSON.stringify(paint());
  // Isolate the system pasteboard while checking the exact payload of the real Copy menu item.
  let copied;
  Object.defineProperty(navigator.clipboard, "writeText", {
    configurable: true,
    value: async (value) => {
      copied = value;
    },
  });
  if (cfg.pointer) await gesture(point, true);
  else {
    pre.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 2 }),
    );
    pre.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: point[0],
        clientY: point[1],
        button: 2,
      }),
    );
  }
  const copyItem = await until(
    () => visible("[data-ssh-terminal-menu] [role=menuitem]")[0],
    "Copy context menu item",
  );
  await sleep(80);
  if (before !== JSON.stringify(paint()))
    throw Error(
      "selection geometry or color changed with menu: " +
        before +
        " / " +
        JSON.stringify(paint()),
    );
  const marks = visible(".shell-selection i");
  if (
    copyItem.hasAttribute("data-disabled") ||
    marks.length < 2 ||
    marks.some(
      (mark) => getComputedStyle(mark).backgroundColor === "rgba(0, 0, 0, 0)",
    )
  )
    throw Error(
      "missing command and output highlights while menu is open: " +
        marks.length +
        " copy disabled=" +
        copyItem.hasAttribute("data-disabled"),
    );
  copyItem.click();
  await until(
    () => copied === expected,
    "exact selected command and output copied",
  );
  await until(
    () => document.activeElement === editor(),
    "typing focus after Copy",
  );
  document.execCommand("insertText", false, "after-copy");
  if (!editor().value.endsWith("after-copy"))
    throw Error("typing lost after Copy");
  const editing = editor();
  setValue(editing, "draft-selection");
  editing.setSelectionRange(6, 15);
  await sleep(40);
  editing.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 2 }),
  );
  const editBox = editing.getBoundingClientRect();
  editing.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: editBox.left + 24,
      clientY: editBox.top + 5,
    }),
  );
  await until(
    () => visible(".shell-selection i").length,
    "draft highlight while menu is open",
  );
  const draftMenu = visible("[data-ssh-terminal-menu]").at(-1);
  key(draftMenu, "Escape");
  await until(
    () =>
      !visible("[data-ssh-terminal-menu]").length &&
      document.activeElement === editing,
    "Escape restores input focus",
  );
  if (editing.value !== "draft-selection") throw Error("Escape changed draft");
  delete navigator.clipboard.writeText;
  window.getSelection()?.removeAllRanges();
  editor().focus();
  await report(
    shell +
      " matching selection geometry and colors; focus after Copy and Escape",
  );
  const draft = editor();
  setValue(draft, "pr");
  await sleep(30);
  key(draft, "ArrowUp");
  await until(() => draft.value.startsWith("printf"), "history preview");
  key(draft, "Escape");
  await until(() => draft.value === "pr", "restore history draft");
  const historyBlock = visible(".shell-block").at(-1);
  await foldCommand(historyBlock, true);
  await foldCommand(historyBlock, false);
  if (draft.value !== "pr") throw Error("command fold lost draft");
  const savedPath = historyBlock.querySelector(".shell-path");
  const savedDirectory = savedPath?.title;
  if (
    !savedDirectory ||
    savedPath.querySelector("button,[role=button],[tabindex],[aria-haspopup]")
  )
    throw Error("history path still offers directory navigation");
  savedPath.click();
  await sleep(75);
  if (visible(".shell-directory").length || editor().value !== "pr")
    throw Error("historical directory opened a picker or changed the draft");
  const sides = new Set();
  let sampling = true;
  const sample = () => {
    const side = visible(".shell-directory").at(-1)?.dataset.side;
    if (side) sides.add(side);
    if (sampling) requestAnimationFrame(sample);
  };
  sample();
  visible(
    shell === "bash"
      ? ".shell-path label"
      : ".shell-path [aria-current=location]",
  )
    .at(-1)
    .click();
  const choice = await until(
    () =>
      visible(".shell-directory [role=option]").find((el) =>
        el.textContent.includes("Two Words"),
      ),
    "directory list",
  );
  await sleep(150);
  sampling = false;
  if (sides.size !== 1)
    throw Error("Unstable directory popover: " + [...sides].join(","));
  if (!document.activeElement?.matches(".shell-directory input"))
    throw Error("Directory search lost focus");
  const popup = choice.closest(".shell-directory");
  const box = popup.querySelector("input").getBoundingClientRect();
  const icon = popup
    .querySelector(".search-input-control > svg")
    .getBoundingClientRect();
  const gap =
    popup.querySelector("[role=option]").getBoundingClientRect().top -
    box.bottom;
  if (
    icon.left < box.left ||
    icon.right > box.right ||
    Math.abs((icon.top + icon.bottom - box.top - box.bottom) / 2) > 1 ||
    gap < 0 ||
    gap > 7
  )
    throw Error("directory search geometry: gap=" + gap);
  const field = popup.querySelector("input");
  const surface = popup.getBoundingClientRect();
  const style = getComputedStyle(field);
  if (
    parseFloat(style.borderTopWidth) ||
    style.backgroundColor !== "rgba(0, 0, 0, 0)" ||
    Math.abs(box.left - surface.left) > 2 ||
    Math.abs(box.right - surface.right) > 2
  )
    throw Error("search is not flush with popup");
  const viewport = popup.querySelector('[data-slot="scroll-area-viewport"]');
  await checkPreviewFade(viewport, false, true);
  viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
  await checkPreviewFade(viewport, true, true);
  const track = await until(
    () =>
      popup.querySelector(
        '[data-slot="scroll-area-scrollbar"][data-orientation="vertical"]',
      ),
    "directory scrollbar",
  );
  if (
    Math.abs(surface.right - track.getBoundingClientRect().right) > 2 ||
    Math.abs(field.getBoundingClientRect().top - box.top) > 1
  )
    throw Error("scrollbar inset or search header scrolled");
  viewport.scrollTop = viewport.scrollHeight;
  await checkPreviewFade(viewport, true, false);
  setValue(field, "no-dir-qa-match");
  await until(
    () =>
      popup.querySelector("[role=status]") &&
      !popup.querySelector("[role=option]"),
    "empty filtered list",
  );
  await checkPreviewFade(viewport, false, false);
  setValue(field, "Two Words");
  await until(
    () => popup.querySelectorAll("[role=option]").length === 1,
    "filtered directory",
  );
  await checkPreviewFade(viewport, false, false);
  await report(
    shell +
      " integrated search header, edge scrollbar, directional fades and short filtered list",
  );
  if (shell === "bash") {
    setValue(field, "");
    await until(
      () => popup.querySelectorAll("[role=option]").length > 2,
      "restore directory options",
    );
    key(field, "ArrowDown");
    await until(
      () =>
        popup
          .querySelectorAll("[role=option]")[1]
          .getAttribute("aria-selected") === "true",
      "keyboard directory choice",
    );
    setValue(field, "Two Words");
    await until(
      () => popup.querySelectorAll("[role=option]").length === 1,
      "keyboard filtered choice",
    );
    key(field, "Enter");
  } else popup.querySelector("[role=option]").click();
  await until(
    () => visible(".shell-path").at(-1)?.textContent.endsWith("Two Words"),
    "directory commit",
  );
  if (draft.value !== "pr") throw Error("directory lost draft");
  if (savedPath.title !== savedDirectory)
    throw Error("changing directory rewrote the archived command path");
  await until(
    () => document.activeElement === draft,
    "directory returned focus",
  );
  await run("pwd");
  await until(
    () =>
      visible(".shell-block pre")
        .at(-1)
        ?.textContent.includes("/Downloads/Two Words"),
    "remote pwd",
  );
  await run("mkdir -p ~/crumb-qa && cd ~/crumb-qa");
  const base = visible(".shell-path").at(-1).title;
  const layers = [
    "a long ancestor with spaces",
    "nested [safe]",
    "次级目录",
    "level-04",
    "level-05",
    "level-06",
  ];
  const leafName = "leaf-" + "0123456789".repeat(11) + "-尾部";
  const deep = [...layers, leafName].join("/");
  await run("mkdir -p '" + deep + "' && cd '" + deep + "'");
  await run("pwd");
  const trail = () =>
    editor()
      .closest(".shell-current-block")
      .querySelector("[data-slot=breadcrumb]");
  const tip = () => trail().querySelector("[aria-current=location]");
  const longHistory = visible(".shell-block")
    .at(-1)
    .querySelector(".shell-path");
  if (
    longHistory.querySelector("button") ||
    longHistory.title !== base + "/" + deep
  )
    throw Error("archived breadcrumb offers navigation or lost its full path");
  const headingRow = trail().closest(".shell-heading");
  const wideLabel = tip().textContent;
  headingRow.style.maxWidth = "400px";
  await until(
    () =>
      tip().textContent.length < wideLabel.length &&
      tip().textContent.startsWith("leaf") &&
      tip().textContent.includes("…") &&
      tip().textContent.endsWith("尾部"),
    "middle truncation of wrapped-width breadcrumb",
  );
  if (trail().scrollWidth > trail().clientWidth + 1)
    throw Error(
      "breadcrumb overflow " +
        JSON.stringify([
          trail().clientWidth,
          trail().scrollWidth,
          tip().textContent,
          getComputedStyle(tip()).font,
          [...trail().querySelectorAll("li")].map((el) => [
            el.dataset.slot,
            el.getBoundingClientRect().width,
          ]),
        ]),
    );
  headingRow.style.maxWidth = "";
  const toggle = trail().querySelector("[aria-haspopup=menu]");
  if (!toggle) throw Error("missing hidden ancestors");
  const draftInput = editor();
  setValue(draftInput, "echo untouched");
  for (const type of ["mousedown", "mouseup", "click"])
    toggle.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );
  const target = base + "/" + layers.slice(0, 2).join("/");
  const parent = await until(
    () =>
      visible("[data-terminal-ancestors] [role=menuitem]").find(
        (item) => item.title === target,
      ),
    "hidden ancestor with special characters",
  );
  parent.click();
  await until(
    () => trail().title === target && document.activeElement === draftInput,
    "remote switch to hidden ancestor and focus",
  );
  if (draftInput.value !== "echo untouched")
    throw Error("ancestor navigation lost draft");
  const up = [...trail().querySelectorAll("button")].find(
    (btn) => btn.title === base,
  );
  if (!up) throw Error("expected visible ancestor");
  up.click();
  await until(() => trail().title === base, "one-click visible ancestor");
  await run("pwd");
  if (
    visible(".shell-block").at(-1).querySelector(".shell-output-text")
      .textContent !== base
  )
    throw Error("breadcrumb path differs from remote pwd");
  if (
    trail().textContent !== "~/crumb-qa" ||
    ![...trail().querySelectorAll("[data-slot=breadcrumb-separator]")].every(
      (el) => el.textContent === "/",
    )
  )
    throw Error("expected slash-separated home breadcrumb");
  await run("cd /tmp");
  await until(
    () =>
      trail().textContent === trail().title && trail().title.endsWith("/tmp"),
    "absolute breadcrumb with a single root slash",
  );
  await run("cd ~/Downloads/'Two Words'");
  await report(
    shell +
      " read-only history, middle truncation, visible and hidden breadcrumb navigation confirmed by pwd",
  );
  await run("export CONDA_DEFAULT_ENV=base");
  if (visible(".shell-heading").at(-1).querySelector(".shell-environment"))
    throw Error("base environment visible");
  await run("export CONDA_DEFAULT_ENV=qa-conda");
  if (
    visible(".shell-heading").at(-1).querySelector(".shell-environment")
      ?.textContent !== "(qa-conda)"
  )
    throw Error("named environment missing");
  await run("unset CONDA_DEFAULT_ENV");
  await run("python3 -m venv --without-pip qa-env");
  await run("source qa-env/bin/activate");
  await until(
    () =>
      visible(".shell-heading").at(-1)?.querySelector(".shell-environment")
        ?.textContent === "(qa-env)",
    "real venv name",
  );
  await run("printf '\\033[1;31mCOLOR-CHECK\\033[0m\\n'");
  const styled = () =>
    visible(".shell-block pre").at(-1)?.querySelector("span[style]");
  await until(
    () =>
      styled()?.textContent === "COLOR-CHECK" &&
      getComputedStyle(styled()).fontWeight === "700",
    "ANSI foreground and bold",
  );
  const ansi = getComputedStyle(styled()).color;
  const colorBlock = visible(".shell-block").at(-1);
  await foldCommand(colorBlock, true);
  await foldCommand(colorBlock, false);
  await until(
    () =>
      styled()?.textContent === "COLOR-CHECK" &&
      getComputedStyle(styled()).color === ansi,
    "ANSI after unfolding",
  );
  await run("deactivate");
  await until(
    () =>
      !visible(".shell-heading").at(-1)?.querySelector(".shell-environment"),
    "venv cleared",
  );
  if (!visible(".shell-block .shell-environment").length)
    throw Error("historical venv lost");
  await run("mkdir aa bb cc dd");
  await run("stty size");
  const dimensions = visible(".shell-block pre")
    .at(-1)
    .textContent.match(/^\s*(\d+) (\d+)\s*$/m);
  if (!dimensions || Number(dimensions[2]) < 30)
    throw Error("unexpected PTY size " + dimensions);
  await run("ls");
  const listing = visible(".shell-block pre").at(-1);
  if (!listing.textContent.split("\n").some((row) => /\baa\s+bb\b/u.test(row)))
    throw Error("ls columns: " + JSON.stringify(listing.textContent));
  if (
    ![...listing.querySelectorAll("span")].some(
      (el) => el.style.color && el.textContent.includes("aa"),
    )
  )
    throw Error("ls directory color");
  await report(shell + " venv ANSI and ls columns " + dimensions[2]);
  const liveInput = editor();
  setValue(
    liveInput,
    "awk 'BEGIN {for(i=1;i<=80;i++)print i}'; sleep 1.2; printf 'end-%d\\n' 42",
  );
  await sleep(30);
  key(liveInput, "Enter");
  const liveBlock = await until(
    () => visible(".shell-current-block[data-live-output]").at(-1),
    "running command",
  );
  await until(
    () => liveBlock.querySelector(".shell-live-viewport[data-long-output]"),
    "live output taller than preview",
  );
  await toggleOutput(liveBlock, "collapse");
  await foldCommand(liveBlock, true);
  await until(editor, "prompt after folded output");
  const completed = visible(".shell-block").at(-1);
  if (
    completed.querySelector(".shell-fold")?.getAttribute("aria-expanded") !==
    "false"
  )
    throw Error("lost running command disclosure state");
  await foldCommand(completed, false);
  if (
    !completed.hasAttribute("data-output-folded") ||
    !completed
      .querySelector(".shell-output-text")
      ?.textContent.includes("end-42") ||
    !completed.querySelector(".shell-command")
  )
    throw Error("running fold state was lost");
  await toggleOutput(completed, "expand");
  await until(
    () =>
      completed
        .querySelector(".shell-output-text")
        ?.textContent.includes("end-42"),
    "output received while folded",
  );
  await report(shell + " live fold");
  await verifyOutput(cfg, shell);
  const firstOrder = "echo qa-order-first",
    secondOrder = "echo qa-order-second",
    thirdOrder = "echo qa-order-third";
  for (const cmd of [firstOrder, secondOrder, thirdOrder]) await run(cmd);
  const historyInput = editor();
  setValue(historyInput, "echo qa-order");
  await sleep(50);
  key(historyInput, "ArrowUp");
  await until(
    () => historyInput.value === thirdOrder,
    "newest history at bottom",
  );
  const menu = visible("[data-mode=history]").at(-1);
  const options = [...menu.querySelectorAll("[role=option]")];
  if (
    options.map((el) => el.textContent).join("|") !==
      [firstOrder, secondOrder, thirdOrder].join("|") ||
    options.at(-1).getAttribute("aria-selected") !== "true"
  )
    throw Error("history visual order");
  if (
    menu.getBoundingClientRect().width >= historyInput.clientWidth * 0.8 ||
    Math.abs(
      menu.getBoundingClientRect().left -
        historyInput.getBoundingClientRect().left,
    ) > 2
  )
    throw Error("history width or alignment");
  key(historyInput, "ArrowUp");
  await until(
    () =>
      historyInput.value === secondOrder &&
      options[1].getAttribute("aria-selected") === "true",
    "up moves up",
  );
  key(historyInput, "ArrowDown");
  await until(() => historyInput.value === thirdOrder, "down moves down");
  key(historyInput, "ArrowDown");
  await until(() => historyInput.value === "echo qa-order", "down to draft");
  await report(
    shell + " compact chronological history with directional selection",
  );
  const sentinel = "printf 'reopen-" + shell + "-%d\\n' 7391";
  await run(sentinel);
  closeSelectedTab();
  await until(
    async () =>
      !(await ipc("terminal_sessions")).some(
        (s) => s.hostId === id && s.phase === "running",
      ),
    "previous SSH closed",
  );
  await connect();
  const reopened = editor();
  setValue(reopened, "printf 'reopen-" + shell);
  await sleep(100);
  key(reopened, "ArrowUp");
  await until(
    () => reopened.value === sentinel,
    "remote command history after closing and reopening",
  );
  key(reopened, "Escape");
  const foreground = (await ipc("terminal_sessions")).find(
    (s) => s.hostId === id && s.phase === "running",
  );
  await verifyForegroundClose(foreground);
  await report(
    shell +
      " idle SSH direct close and reopened history, foreground close confirmation/cancel",
  );
}
try {
  const cfg = await (await fetch(reportURL)).json();
  await until(() => document.querySelector(".app-titlebar"), "app");
  await verify(cfg, "bash");
  if (!cfg.localOnly) await verify(cfg, "zsh");
  await report("complete");
} catch (error) {
  await report("failed", String(error));
}
