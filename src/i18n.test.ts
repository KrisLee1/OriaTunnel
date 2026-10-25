import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import {
  resources,
  resolveLanguage,
  supportedLanguages,
} from "./i18n-resources";
import catalog from "./features/tunnels/connection-icon-catalog.json";

function flatten(value: unknown, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      typeof item === "string"
        ? [[prefix + key, item]]
        : Object.entries(flatten(item, prefix + key + ".")),
    ),
  );
}
const baseKey = (key: string) =>
  key.replace(/_(zero|one|two|few|many|other)$/, "");
const parameters = (value: string) =>
  [
    ...new Set(
      [...value.matchAll(/\{\{\s*([^},]+)(?:,[^}]+)?\s*\}\}/g)].map((match) =>
        match[1].trim(),
      ),
    ),
  ].sort();

describe("eight-language resources", () => {
  it("normalizes saved language variants without losing traditional Chinese", () => {
    for (const value of ["zh-TW", "zh_HK", "zh-MO", "zh-Hant", "zh-Hant-HK"])
      expect(resolveLanguage(value)).toBe("zh-TW");
    for (const value of ["zh-CN", "zh-Hans", "zh-SG"])
      expect(resolveLanguage(value)).toBe("zh-CN");
    expect(resolveLanguage("en-US")).toBe("en");
    expect(resolveLanguage("fr-CA")).toBe("fr");
    expect(resolveLanguage("invalid")).toBe("zh-CN");
  });

  it("covers every namespace, base key, and interpolation parameter without fallback", async () => {
    const namespaces = [
      "common",
      "tunnel",
      "icons",
      "updater",
      "commands",
      "terminal",
      "native",
    ];
    for (const language of supportedLanguages) {
      expect(Object.keys(resources[language]).sort(), language).toEqual(
        [...namespaces].sort(),
      );
      const instance = createInstance();
      await instance.init({
        resources,
        lng: language,
        fallbackLng: false,
        load: "currentOnly",
        interpolation: { escapeValue: false },
      });
      for (const namespace of namespaces) {
        const english = flatten(resources.en[namespace]);
        const messages = flatten(resources[language][namespace]);
        expect(
          [...new Set(Object.keys(messages).map(baseKey))].sort(),
          `${language}/${namespace}`,
        ).toEqual([...new Set(Object.keys(english).map(baseKey))].sort());
        for (const [key, value] of Object.entries(messages)) {
          expect(
            value.trim().length,
            `${language}/${namespace}/${key}`,
          ).toBeGreaterThan(0);
          expect(parameters(value), `${language}/${namespace}/${key}`).toEqual(
            parameters(english[baseKey(key)] ?? english[key]),
          );
          const args = Object.fromEntries(
            parameters(value).map((parameter) => [
              parameter,
              parameter === "count" ? 2 : `test-${parameter}`,
            ]),
          );
          const rendered = instance.t(key, { ns: namespace, ...args });
          expect(
            instance.exists(key, { ns: namespace }),
            `${language}/${namespace}/${key}`,
          ).toBe(true);
          expect(rendered).not.toMatch(/\{\{/);
        }
      }
    }
  });

  it("translates every catalog icon and emoji in all eight languages", () => {
    const keys = [
      ...catalog.icons.map((icon) => icon.id),
      ...catalog.emojis.map(
        (emoji) =>
          `emoji-${[...emoji.value].map((c) => c.codePointAt(0)!.toString(16)).join("-")}`,
      ),
    ];
    for (const language of supportedLanguages)
      expect(Object.keys(resources[language].icons).sort(), language).toEqual(
        [...keys].sort(),
      );
  });

  it("uses complete plural forms for counts in European languages", async () => {
    for (const language of ["en", "de", "fr", "ru"]) {
      const instance = createInstance();
      await instance.init({
        resources,
        lng: language,
        fallbackLng: false,
        load: "currentOnly",
      });
      for (const key of [
        "forwardCount",
        "connectionCount",
        "activeCount",
        "hostCount",
        "logCount",
      ]) {
        for (const count of [0, 1, 2, 5, 21, 22, 100]) {
          const form = new Intl.PluralRules(language).select(count);
          expect(
            instance.exists(`${key}_${form}`, { ns: "tunnel" }),
            `${language}/${key}/${form}`,
          ).toBe(true);
          expect(instance.t(key, { ns: "tunnel", count })).not.toContain("{{");
        }
      }
    }
  });

  it("covers Rust lifecycle, failure, and explicitly encoded native message identifiers", () => {
    const events = [
      "connecting",
      "authenticating",
      "binding",
      "listening",
      "verifying-host",
      "reconnecting",
      "stopped",
      "failed",
      "tested",
      "needs-attention",
      "target-reachable",
      "target-unreachable",
    ];
    const failures = [
      "network",
      "dns",
      "timeout",
      "authentication",
      "host-key",
      "bind",
      "forward-denied",
      "configuration",
      "remote-command",
    ];
    const nativeKeys = new Set<string>();
    for (const file of readdirSync(
      new URL("../src-tauri/src/", import.meta.url),
    ).filter((file) => file.endsWith(".rs"))) {
      const source = readFileSync(
        new URL(`../src-tauri/src/${file}`, import.meta.url),
        "utf8",
      );
      for (const match of source.matchAll(
        /native_message::(?:message|plain|text)\(\s*"([^"]+)"/g,
      ))
        nativeKeys.add(match[1]);
    }
    expect(nativeKeys.size).toBeGreaterThan(150);
    for (const language of supportedLanguages) {
      for (const key of [
        ...events,
        ...failures.map((failure) => `failure-${failure}`),
      ])
        expect(
          flatten(resources[language].tunnel)[key],
          `${language}/tunnel/${key}`,
        ).toBeTypeOf("string");
      for (const key of nativeKeys)
        expect(
          flatten(resources[language].native)[key],
          `${language}/native/${key}`,
        ).toBeTypeOf("string");
    }
  });

  it("resolves literal UI translation calls in each component's namespace", () => {
    const files = readdirSync(new URL("./", import.meta.url), {
      recursive: true,
    })
      .filter(
        (file) =>
          /\.(?:tsx|ts)$/.test(String(file)) &&
          !String(file).includes(".test.") &&
          !String(file).startsWith("public/"),
      )
      .map(String);
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(
        new URL(file, new URL("./", import.meta.url)),
        "utf8",
      );
      const namespace =
        text.match(/useTranslation\(\s*["']([^"']+)["']/)?.[1] ??
        (file.endsWith("update-notification.tsx") ? "updater" : "common");
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === "t" &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          let ns = namespace;
          const options = node.arguments[1];
          if (options && ts.isObjectLiteralExpression(options)) {
            const property = options.properties.find(
              (p): p is ts.PropertyAssignment =>
                ts.isPropertyAssignment(p) && p.name.getText(source) === "ns",
            );
            if (property && ts.isStringLiteral(property.initializer))
              ns = property.initializer.text;
          }
          const key = node.arguments[0].text;
          if (!(key in flatten(resources.en[ns] ?? {})))
            missing.push(`${file}: ${ns}/${key}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });
});
