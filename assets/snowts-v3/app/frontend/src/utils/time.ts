function parseUTC(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const s = iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z'
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export function formatDate(iso: string | null | undefined): string {
  const d = parseUTC(iso)
  return d ? d.toLocaleDateString() : ''
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = parseUTC(iso)
  return d ? d.toLocaleString() : ''
}

export function formatTime(iso: string | null | undefined): string {
  const d = parseUTC(iso)
  return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
}

export function relativeTime(iso: string | null | undefined): string {
  const d = parseUTC(iso)
  if (!d) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return '1d'
  if (days < 7) return `${days}d`
  const wks = Math.floor(days / 7)
  if (wks < 5) return `${wks}w`
  const mos = Math.floor(days / 30)
  if (mos < 12) return `${mos}mo`
  return `${Math.floor(mos / 12)}y`
}
