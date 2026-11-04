// Migrated from OriaAide output-artifact-capture; only the SVG validation path.
const MAX_CAPTURE_SVG_BYTES = 2 * 1024 * 1024;
class OutputArtifactCaptureError extends Error {
  constructor(code: string, message: string = code) {
    super(message);
  }
}
export function sanitizeStaticSvg(
  source: string,
  maxBytes: number = MAX_CAPTURE_SVG_BYTES,
) {
  return sanitizeSvg(source, maxBytes, false);
}

export function sanitizeAnimatedSvg(
  source: string,
  maxBytes: number = MAX_CAPTURE_SVG_BYTES,
) {
  return sanitizeSvg(source, maxBytes, true);
}

function sanitizeSvg(
  source: string,
  maxBytes: number,
  allowDeclarativeAnimation: boolean,
) {
  const text = source.trim();
  if (!text || new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new OutputArtifactCaptureError(text ? "too_large" : "invalid");
  }
  if (!/^<svg(?:\s|>)/i.test(text) || !/<\/svg>$/i.test(text)) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG capture is incomplete",
    );
  }
  const activeElementPattern = allowDeclarativeAnimation
    ? /<\s*(?:[\w-]+:)?(?:script|foreignObject|iframe|object|embed|link|image|base|audio|video|source|track|discard)\b/i
    : /<\s*(?:[\w-]+:)?(?:script|style|foreignObject|iframe|object|embed|link|image|base|audio|video|source|track|animate|animateMotion|animateTransform|set|discard)\b/i;
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(text) || activeElementPattern.test(text)) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG capture contains active content",
    );
  }
  validateCapturedSvgXml(text, allowDeclarativeAnimation);
  return text;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const activeSvgElements = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "link",
  "image",
  "base",
  "audio",
  "video",
  "source",
  "track",
  "animatecolor",
  "discard",
]);
const declarativeAnimationElements = new Set([
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
]);
const animatedSvgAttributes = new Set([
  "cx",
  "cy",
  "d",
  "fill",
  "fill-opacity",
  "flood-color",
  "flood-opacity",
  "font-size",
  "height",
  "letter-spacing",
  "lighting-color",
  "offset",
  "opacity",
  "pathlength",
  "points",
  "r",
  "rx",
  "ry",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "visibility",
  "width",
  "word-spacing",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

function validateCapturedSvgXml(
  source: string,
  allowDeclarativeAnimation: boolean,
) {
  validateCapturedSvgXmlFallback(source, allowDeclarativeAnimation);
  if (typeof DOMParser !== "undefined") {
    validateCapturedSvgDom(source, allowDeclarativeAnimation);
  }
}

function validateCapturedSvgDom(
  source: string,
  allowDeclarativeAnimation: boolean,
) {
  let document: Document;
  try {
    document = new DOMParser().parseFromString(source, "image/svg+xml");
  } catch {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG XML could not be parsed",
    );
  }
  const root = document.documentElement;
  if (
    !root ||
    document.getElementsByTagName("parsererror").length > 0 ||
    root.localName.toLowerCase() !== "svg"
  ) {
    throw new OutputArtifactCaptureError("invalid", "SVG XML is invalid");
  }

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const namespace = element.namespaceURI ?? "";
    if ((namespace !== "" && namespace !== SVG_NAMESPACE) || element.prefix) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG contains an unsafe element namespace",
      );
    }
    validateSvgElementName(element.localName, allowDeclarativeAnimation);
    for (const attribute of Array.from(element.attributes)) {
      validateDomSvgAttribute(attribute);
    }
    validateDeclarativeAnimationElement(
      element.localName,
      Array.from(element.attributes, (attribute) => [
        attribute.name,
        attribute.value,
      ]),
      allowDeclarativeAnimation,
    );
    if (element.localName.toLowerCase() === "style") {
      validateSvgStylesheet(
        element.textContent ?? "",
        allowDeclarativeAnimation,
      );
    }
  }
}

function validateDomSvgAttribute(attribute: Attr) {
  const name = attribute.name.toLowerCase();
  const namespace = attribute.namespaceURI ?? "";
  if (
    namespace === XMLNS_NAMESPACE ||
    name === "xmlns" ||
    name.startsWith("xmlns:")
  ) {
    validateSvgNamespaceDeclaration(name, attribute.value);
    return;
  }
  if (namespace === XLINK_NAMESPACE) {
    if (attribute.localName.toLowerCase() !== "href") {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG contains an unsafe XLink attribute",
      );
    }
    validateLocalSvgFragment(attribute.value);
    return;
  }
  if (namespace === XML_NAMESPACE) {
    validateSvgXmlAttribute(attribute.localName, attribute.value);
    return;
  }
  if (namespace !== "" || attribute.prefix) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an unsafe attribute namespace",
    );
  }
  validateSvgAttribute(name, attribute.value);
}

function validateCapturedSvgXmlFallback(
  source: string,
  allowDeclarativeAnimation: boolean,
) {
  const stack: Array<{ name: string; xlinkDeclared: boolean; text: string }> =
    [];
  let cursor = 0;
  let rootCount = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart < 0) {
      appendSvgText(stack, source.slice(cursor));
      cursor = source.length;
      break;
    }
    appendSvgText(stack, source.slice(cursor, tagStart));

    if (source.startsWith("<!--", tagStart)) {
      if (stack[stack.length - 1]?.name.toLowerCase() === "style") {
        throw new OutputArtifactCaptureError(
          "invalid",
          "SVG style contains an unsupported comment",
        );
      }
      const commentEnd = source.indexOf("-->", tagStart + 4);
      if (
        commentEnd < 0 ||
        source.slice(tagStart + 4, commentEnd).includes("--")
      ) {
        throw new OutputArtifactCaptureError(
          "invalid",
          "SVG comment is invalid",
        );
      }
      cursor = commentEnd + 3;
      continue;
    }
    if (
      source.startsWith("<![CDATA[", tagStart) ||
      source[tagStart + 1] === "!" ||
      source[tagStart + 1] === "?"
    ) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG contains an unsupported XML declaration",
      );
    }

    const tagEnd = findSvgTagEnd(source, tagStart + 1);
    const token = source.slice(tagStart + 1, tagEnd);
    const closing = token.match(/^\/([A-Za-z_][A-Za-z0-9_.:-]*)\s*$/);
    if (closing) {
      const current = stack.pop();
      if (!current || current.name !== closing[1]) {
        throw new OutputArtifactCaptureError(
          "invalid",
          "SVG elements are not balanced",
        );
      }
      if (current.name.toLowerCase() === "style") {
        validateSvgStylesheet(current.text, allowDeclarativeAnimation);
      }
      cursor = tagEnd + 1;
      continue;
    }
    if (token.startsWith("/")) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG closing element is invalid",
      );
    }

    const parsed = parseSvgStartTag(token);
    if (parsed.name.includes(":")) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG contains a prefixed element",
      );
    }
    validateSvgElementName(parsed.name, allowDeclarativeAnimation);
    if (stack.length === 0) {
      rootCount += 1;
      if (rootCount !== 1 || parsed.name.toLowerCase() !== "svg") {
        throw new OutputArtifactCaptureError(
          "invalid",
          "SVG root element is invalid",
        );
      }
    }

    let xlinkDeclared = stack[stack.length - 1]?.xlinkDeclared ?? false;
    for (const attribute of parsed.attributes) {
      const name = attribute.name.toLowerCase();
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        validateSvgNamespaceDeclaration(name, attribute.value);
        if (name === "xmlns:xlink") xlinkDeclared = true;
      }
    }
    for (const attribute of parsed.attributes) {
      validateFallbackSvgAttribute(
        attribute.name,
        attribute.value,
        xlinkDeclared,
      );
    }
    validateDeclarativeAnimationElement(
      parsed.name,
      parsed.attributes.map((attribute) => [attribute.name, attribute.value]),
      allowDeclarativeAnimation,
    );
    if (!parsed.selfClosing)
      stack.push({ name: parsed.name, xlinkDeclared, text: "" });
    cursor = tagEnd + 1;
  }

  if (rootCount !== 1 || stack.length > 0) {
    throw new OutputArtifactCaptureError("invalid", "SVG XML is incomplete");
  }
}

function validateFallbackSvgAttribute(
  rawName: string,
  value: string,
  xlinkDeclared: boolean,
) {
  const name = rawName.toLowerCase();
  if (name === "xmlns" || name.startsWith("xmlns:")) return;
  if (name === "xlink:href") {
    if (!xlinkDeclared) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG XLink namespace is missing",
      );
    }
    validateLocalSvgFragment(value);
    return;
  }
  if (name.startsWith("xml:")) {
    validateSvgXmlAttribute(name.slice(4), value);
    return;
  }
  if (name.includes(":")) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an unsafe attribute namespace",
    );
  }
  validateSvgAttribute(name, value);
}

function validateSvgElementName(
  name: string,
  allowDeclarativeAnimation: boolean,
) {
  const normalizedName = name.toLowerCase();
  if (
    activeSvgElements.has(normalizedName) ||
    (normalizedName === "style" && !allowDeclarativeAnimation) ||
    (!allowDeclarativeAnimation &&
      declarativeAnimationElements.has(normalizedName))
  ) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an active element",
    );
  }
}

const svgStyleProperties = new Set([
  "animation",
  "animation-delay",
  "animation-direction",
  "animation-duration",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-name",
  "animation-play-state",
  "animation-timing-function",
  "clip-path",
  "color",
  "fill",
  "fill-opacity",
  "filter",
  "flood-color",
  "flood-opacity",
  "font-size",
  "letter-spacing",
  "lighting-color",
  "mask",
  "opacity",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "transform",
  "transform-box",
  "transform-origin",
  "visibility",
  "word-spacing",
]);

function validateSvgStylesheet(
  source: string,
  allowDeclarativeAnimation: boolean,
) {
  if (!allowDeclarativeAnimation) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an active style element",
    );
  }
  const css = source.trim();
  if (
    !css ||
    css.length > 100_000 ||
    /[\\<>"']|\/\*|\*\//.test(css) ||
    /@(?:import|font-face|namespace|supports|media|layer|property|page|document)\b/i.test(
      css,
    )
  ) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG style contains unsupported CSS",
    );
  }

  let cursor = 0;
  while (cursor < css.length) {
    cursor = skipCssWhitespace(css, cursor);
    if (cursor >= css.length) break;
    const blockStart = css.indexOf("{", cursor);
    if (blockStart < 0) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG style rule is incomplete",
      );
    }
    const header = css.slice(cursor, blockStart).trim();
    const blockEnd = findCssBlockEnd(css, blockStart);
    const body = css.slice(blockStart + 1, blockEnd);
    const keyframes = header.match(
      /^@(?:-webkit-)?keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)$/i,
    );
    if (keyframes) {
      validateSvgKeyframes(body);
    } else {
      if (header.startsWith("@")) {
        throw new OutputArtifactCaptureError(
          "invalid",
          "SVG style contains an unsupported at-rule",
        );
      }
      validateSvgSelectors(header);
      validateSvgCssDeclarations(body);
    }
    cursor = blockEnd + 1;
  }
}

function validateSvgKeyframes(source: string) {
  let cursor = 0;
  let frameCount = 0;
  while (cursor < source.length) {
    cursor = skipCssWhitespace(source, cursor);
    if (cursor >= source.length) break;
    const blockStart = source.indexOf("{", cursor);
    if (blockStart < 0) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG keyframe is incomplete",
      );
    }
    const selector = source.slice(cursor, blockStart).trim();
    if (
      !selector.split(",").every((part) => {
        const value = part.trim().toLowerCase();
        if (value === "from" || value === "to") return true;
        const match = value.match(/^(?:\d+(?:\.\d+)?|\.\d+)%$/);
        return Boolean(match) && Number(value.slice(0, -1)) <= 100;
      })
    ) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG keyframe selector is unsafe",
      );
    }
    const blockEnd = findCssBlockEnd(source, blockStart);
    const declarations = source.slice(blockStart + 1, blockEnd);
    if (declarations.includes("{")) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG keyframe contains a nested rule",
      );
    }
    validateSvgCssDeclarations(declarations);
    frameCount += 1;
    cursor = blockEnd + 1;
  }
  if (frameCount === 0) {
    throw new OutputArtifactCaptureError("invalid", "SVG keyframes are empty");
  }
}

function validateSvgSelectors(source: string) {
  const simple = String.raw`(?:\*|[A-Za-z][A-Za-z0-9_-]*|[.#][A-Za-z_][A-Za-z0-9_-]*)(?:[.#][A-Za-z_][A-Za-z0-9_-]*)*`;
  const selector = new RegExp(`^${simple}(?:\\s+${simple})*$`);
  if (!source.split(",").every((part) => selector.test(part.trim()))) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG style selector is unsafe",
    );
  }
}

function validateSvgCssDeclarations(source: string) {
  if (source.includes("{")) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG style contains a nested rule",
    );
  }
  const declarations = source
    .split(";")
    .map((value) => value.trim())
    .filter(Boolean);
  if (declarations.length === 0) {
    throw new OutputArtifactCaptureError("invalid", "SVG style rule is empty");
  }
  for (const declaration of declarations) {
    const separator = declaration.indexOf(":");
    if (separator <= 0) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG style declaration is invalid",
      );
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!svgStyleProperties.has(property) || !value || /[{}]/.test(value)) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG style property is unsafe",
      );
    }
    validateSvgAttributeValue(value);
  }
}

function findCssBlockEnd(source: string, blockStart: number) {
  let depth = 1;
  for (let cursor = blockStart + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    else if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  throw new OutputArtifactCaptureError(
    "invalid",
    "SVG style block is incomplete",
  );
}

function skipCssWhitespace(source: string, start: number) {
  let cursor = start;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  return cursor;
}

function validateDeclarativeAnimationElement(
  rawName: string,
  rawAttributes: Array<[string, string]>,
  allowDeclarativeAnimation: boolean,
) {
  const name = rawName.toLowerCase();
  if (!declarativeAnimationElements.has(name)) return;
  if (!allowDeclarativeAnimation) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an active element",
    );
  }
  const attributes = new Map(
    rawAttributes.map(([key, value]) => [key.toLowerCase(), value]),
  );

  if (name === "animatemotion") {
    if (attributes.has("attributename") || attributes.has("attributetype")) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG motion animation targets an unsafe attribute",
      );
    }
    return;
  }

  const target = attributes.get("attributename")?.trim().toLowerCase();
  if (!target) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG animation is missing its target attribute",
    );
  }
  if (name === "animatetransform") {
    if (target !== "transform") {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG transform animation targets an unsafe attribute",
      );
    }
    const transformType = attributes.get("type")?.trim().toLowerCase();
    if (
      !transformType ||
      !["rotate", "scale", "skewx", "skewy", "translate"].includes(
        transformType,
      )
    ) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG transform animation has an unsafe type",
      );
    }
    return;
  }
  if (!animatedSvgAttributes.has(target)) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG animation targets an unsafe attribute",
    );
  }
}

function validateSvgNamespaceDeclaration(name: string, value: string) {
  const normalizedName = name.toLowerCase();
  if (
    (normalizedName === "xmlns" && value === SVG_NAMESPACE) ||
    (normalizedName === "xmlns:xlink" && value === XLINK_NAMESPACE)
  )
    return;
  throw new OutputArtifactCaptureError(
    "invalid",
    "SVG contains an unsafe namespace",
  );
}

function validateSvgXmlAttribute(name: string, value: string) {
  const normalizedName = name.toLowerCase();
  if (
    normalizedName === "space" &&
    (value === "default" || value === "preserve")
  )
    return;
  if (normalizedName === "lang") {
    validateSvgAttributeValue(value);
    return;
  }
  throw new OutputArtifactCaptureError(
    "invalid",
    "SVG contains an unsafe XML attribute",
  );
}

function validateSvgAttribute(name: string, value: string) {
  if (name.startsWith("on") || name === "src" || name === "base") {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an active attribute",
    );
  }
  if (name === "href") {
    validateLocalSvgFragment(value);
    return;
  }
  validateSvgAttributeValue(value);
}

function validateSvgAttributeValue(value: string) {
  validateXmlCharacters(value);
  if (value.includes("\\") || /\/\*|\*\//.test(value)) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG attribute contains unsafe CSS",
    );
  }
  const compact = value.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  if (
    compact.includes("javascript:") ||
    compact.includes("vbscript:") ||
    compact.includes("data:text/html") ||
    compact.includes("data:application/xhtml+xml") ||
    compact.includes("@import") ||
    compact.includes("expression(")
  ) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG attribute contains active content",
    );
  }
  validateSvgLocalUrls(value);
}

function validateSvgLocalUrls(value: string) {
  const pattern = /\burl\s*\(/gi;
  while (true) {
    const match = pattern.exec(value);
    if (!match) break;
    let cursor = match.index + match[0].length;
    let quote = "";
    let end = -1;
    for (; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ")") {
        end = cursor;
        break;
      }
    }
    if (end < 0 || quote) {
      throw new OutputArtifactCaptureError("invalid", "SVG URL is incomplete");
    }
    validateLocalSvgFragment(value.slice(pattern.lastIndex, end));
    pattern.lastIndex = end + 1;
  }
}

function validateLocalSvgFragment(rawValue: string) {
  let value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (!/^#[^\s"'<>\\()]*$/.test(value)) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an external reference",
    );
  }
}

function appendSvgText(
  stack: Array<{ name: string; xlinkDeclared: boolean; text: string }>,
  value: string,
) {
  const decoded = decodeXmlEntities(value);
  if (stack.length === 0 && decoded.trim()) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains content outside its root",
    );
  }
  const current = stack[stack.length - 1];
  if (current?.name.toLowerCase() === "style") current.text += decoded;
}

function parseSvgStartTag(token: string) {
  const nameMatch = token.match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
  if (!nameMatch)
    throw new OutputArtifactCaptureError("invalid", "SVG element is invalid");
  const attributes: Array<{ name: string; value: string }> = [];
  const names = new Set<string>();
  let cursor = nameMatch[0].length;
  let selfClosing = false;

  while (cursor < token.length) {
    const whitespaceStart = cursor;
    cursor = skipXmlWhitespace(token, cursor);
    if (cursor === token.length) break;
    if (token[cursor] === "/") {
      cursor = skipXmlWhitespace(token, cursor + 1);
      if (cursor !== token.length) {
        throw new OutputArtifactCaptureError(
          "invalid",
          "SVG self-closing element is invalid",
        );
      }
      selfClosing = true;
      break;
    }
    if (cursor === whitespaceStart) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG attributes are not separated",
      );
    }
    const attributeMatch = token
      .slice(cursor)
      .match(/^([A-Za-z_][A-Za-z0-9_.:-]*)/);
    if (!attributeMatch) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG attribute name is invalid",
      );
    }
    const name = attributeMatch[1];
    const normalizedName = name.toLowerCase();
    if (names.has(normalizedName)) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG contains a duplicate attribute",
      );
    }
    names.add(normalizedName);
    cursor += attributeMatch[0].length;
    cursor = skipXmlWhitespace(token, cursor);
    if (token[cursor] !== "=") {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG attribute is missing a value",
      );
    }
    cursor = skipXmlWhitespace(token, cursor + 1);
    const quote = token[cursor];
    if (quote !== '"' && quote !== "'") {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG attribute value is not quoted",
      );
    }
    const valueEnd = token.indexOf(quote, cursor + 1);
    if (valueEnd < 0) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG attribute value is incomplete",
      );
    }
    const rawValue = token.slice(cursor + 1, valueEnd);
    if (rawValue.includes("<")) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG attribute value is invalid",
      );
    }
    attributes.push({ name, value: decodeXmlEntities(rawValue) });
    cursor = valueEnd + 1;
  }

  return { name: nameMatch[1], attributes, selfClosing };
}

function findSvgTagEnd(source: string, start: number) {
  let quote = "";
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  throw new OutputArtifactCaptureError("invalid", "SVG element is incomplete");
}

function skipXmlWhitespace(value: string, start: number) {
  let cursor = start;
  while (cursor < value.length && /[\t\n\r ]/.test(value[cursor])) cursor += 1;
  return cursor;
}

function decodeXmlEntities(value: string) {
  if (!value.includes("&")) {
    validateXmlCharacters(value);
    return value;
  }
  let decoded = "";
  let cursor = 0;
  while (cursor < value.length) {
    const entityStart = value.indexOf("&", cursor);
    if (entityStart < 0) {
      decoded += value.slice(cursor);
      break;
    }
    decoded += value.slice(cursor, entityStart);
    const entityEnd = value.indexOf(";", entityStart + 1);
    if (entityEnd < 0 || entityEnd - entityStart > 32) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG contains an invalid XML entity",
      );
    }
    const entity = value.slice(entityStart + 1, entityEnd);
    decoded += decodeXmlEntity(entity);
    cursor = entityEnd + 1;
  }
  validateXmlCharacters(decoded);
  return decoded;
}

function decodeXmlEntity(entity: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
  let codePoint: number;
  if (/^#[0-9]+$/.test(entity))
    codePoint = Number.parseInt(entity.slice(1), 10);
  else if (/^#x[0-9a-f]+$/i.test(entity))
    codePoint = Number.parseInt(entity.slice(2), 16);
  else
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an unknown XML entity",
    );
  if (!isValidXmlCodePoint(codePoint)) {
    throw new OutputArtifactCaptureError(
      "invalid",
      "SVG contains an invalid XML character",
    );
  }
  return String.fromCodePoint(codePoint);
}

function validateXmlCharacters(value: string) {
  for (const character of value) {
    if (!isValidXmlCodePoint(character.codePointAt(0) ?? 0)) {
      throw new OutputArtifactCaptureError(
        "invalid",
        "SVG contains an invalid XML character",
      );
    }
  }
}

function isValidXmlCodePoint(codePoint: number) {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}
