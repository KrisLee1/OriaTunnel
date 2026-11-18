export function documentUrl(url: string, image = false) {
  if (/^#[\w:.-]+$/.test(url)) return url;
  if (
    image &&
    /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(url) &&
    url.length < 3_000_000
  )
    return url;
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
