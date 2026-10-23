import type { ComponentProps, MouseEvent } from "react"

import { openExternalUrl } from "@/lib/bridge"

type ExternalLinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string
}

export function ExternalLink({
  href,
  onClick,
  rel = "noreferrer",
  target = "_blank",
  ...props
}: ExternalLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || !("__TAURI_INTERNALS__" in window)) return

    event.preventDefault()
    void openExternalUrl(href).catch((error) => {
      console.error("OriaTunnel: cannot open external link", error)
    })
  }

  return (
    <a
      {...props}
      href={href}
      target={target}
      rel={rel}
      onClick={handleClick}
    />
  )
}
