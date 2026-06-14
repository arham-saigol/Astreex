function parseIpv4(value: string) {
  const parts = value.split(".")
  if (parts.length !== 4) return null

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) return null
    const parsed = Number(part)
    return parsed >= 0 && parsed <= 255 ? parsed : null
  })

  return octets.every((part) => part !== null) ? (octets as number[]) : null
}

export function isPrivateOrInternalIp(value: string) {
  const hostname = value.toLowerCase()
  const ipv4 = parseIpv4(hostname)
  if (ipv4) {
    const [a, b, c, d] = ipv4
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 0) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a >= 224) ||
      (a === 169 && b === 254 && c === 169 && d === 254)
    )
  }

  const ipv6 = hostname.replace(/^\[|\]$/g, "")
  return (
    ipv6 === "::1" ||
    ipv6 === "::" ||
    ipv6.startsWith("fe80:") ||
    ipv6.startsWith("fc") ||
    ipv6.startsWith("fd")
  )
}

export function assertPublicHostname(hostname: string, label: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "")
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal" ||
    isPrivateOrInternalIp(normalized)
  ) {
    throw new Error(`${label} must use a public hostname`)
  }
}
