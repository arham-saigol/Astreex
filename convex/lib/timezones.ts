export function assertValidTimezone(value: string) {
  const timezone = value.trim()
  if (!timezone) throw new Error("Invalid timezone")

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0))
  } catch {
    throw new Error("Invalid timezone")
  }

  return timezone
}
