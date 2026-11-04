import * as React from "react";
import {
  createHighlighterCore,
  type GrammarState,
  type HighlighterCore,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// Add the languages you need. Each one loads the first time it is used.
const languages = {
  bash: () => import("shiki/langs/shellscript.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
};

const aliases: Record<string, keyof typeof languages> = {
  js: "javascript",
  md: "markdown",
  py: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighter ??= createHighlighterCore({
    themes: [
      {
        name: "oria",
        fg: "var(--oria-color-fg)",
        bg: "var(--oria-color-surface)",
        settings: [
          {
            scope: ["comment", "punctuation.definition.comment"],
            settings: { foreground: "var(--oria-color-muted-fg)" },
          },
          {
            scope: ["keyword", "storage"],
            settings: { foreground: "var(--oria-color-primary)" },
          },
          {
            scope: ["string"],
            settings: { foreground: "var(--oria-color-success)" },
          },
          {
            scope: ["constant", "variable.other.constant"],
            settings: { foreground: "var(--oria-color-warning)" },
          },
          {
            scope: ["entity.name", "support.function", "support.type"],
            settings: {
              foreground: "var(--oria-color-info, var(--oria-color-primary))",
            },
          },
          {
            scope: ["invalid"],
            settings: { foreground: "var(--oria-color-danger)" },
          },
        ],
      },
    ],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });

  return highlighter;
}

function getLanguage(language: string) {
  const name = language.toLowerCase();

  if (name === "ansi") {
    return name;
  }

  if (name in languages) {
    return name as keyof typeof languages;
  }

  return aliases[name] ?? null;
}

// Loads a language and returns a highlighter for it, or null for a language
// that is not listed.
export async function loadHighlighter(language: string) {
  const lang = getLanguage(language);

  if (!lang) {
    return null;
  }

  const shiki = await getHighlighter();

  if (lang !== "ansi" && !shiki.getLoadedLanguages().includes(lang)) {
    await shiki.loadLanguage(languages[lang]);
  }

  return {
    // Returns one React node per line, and the grammar state after the last
    // line. Pass that state back to continue where the code left off.
    highlight(code: string, state?: GrammarState) {
      const tokenize = (text: string) =>
        shiki.codeToTokens(text, {
          lang,
          theme: "oria",
          grammarState: state,
        }).tokens;

      // ANSI has no grammar state, so each line is tokenized on its own and
      // gets the same colors whether it arrives in one piece or streams.
      const tokens =
        lang === "ansi"
          ? code.split("\n").flatMap((line) => tokenize(line))
          : tokenize(code);

      return {
        lines: tokens.map((line) =>
          line.map((token, index) => (
            <span key={index} style={{ color: token.color }}>
              {token.content}
            </span>
          )),
        ),
        state: shiki.getLastGrammarState(tokens),
      };
    },
  };
}

// Returns one React node per line, or null for a language that is not listed.
export async function highlightCode(code: string, language: string) {
  const highlighter = await loadHighlighter(language);

  return highlighter ? highlighter.highlight(code).lines : null;
}
