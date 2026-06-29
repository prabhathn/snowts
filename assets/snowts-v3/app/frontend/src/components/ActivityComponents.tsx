import type { ActivityBatch } from '../types'

export const STATUS_CONFIG: Record<string, { color: string; icon: 'queue' | 'upload' | 'spin' | 'check' | 'error'; label: string }> = {
  queued: { color: 'var(--color-text-secondary)', icon: 'queue', label: 'Queued' },
  uploading: { color: 'var(--color-accent)', icon: 'upload', label: 'Uploading' },
  uploaded: { color: 'var(--color-accent)', icon: 'check', label: 'Uploaded' },
  analyzing: { color: 'var(--color-warning)', icon: 'spin', label: 'Parsing' },
  classifying: { color: 'var(--color-warning)', icon: 'spin', label: 'Classifying' },
  extracting: { color: 'var(--color-warning)', icon: 'spin', label: 'Extracting' },
  tagging: { color: 'var(--color-warning)', icon: 'spin', label: 'Tagging' },
  mapping: { color: 'var(--color-warning)', icon: 'spin', label: 'Mapping Wiki' },
  processing: { color: 'var(--color-accent)', icon: 'spin', label: 'Saving' },
  enriching: { color: 'var(--color-accent)', icon: 'spin', label: 'Enriching' },
  done: { color: 'var(--color-success)', icon: 'check', label: 'Done' },
  error: { color: 'var(--color-danger)', icon: 'error', label: 'Error' },
  running: { color: 'var(--color-warning)', icon: 'spin', label: 'Running' },
  completed: { color: 'var(--color-success)', icon: 'check', label: 'Completed' },
  failed: { color: 'var(--color-danger)', icon: 'error', label: 'Failed' },
  info: { color: 'var(--color-text-secondary)', icon: 'check', label: '' },
}

export function StatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.info
  const s = `${size}px`

  if (cfg.icon === 'spin') {
    return (
      <svg className="animate-spin shrink-0" style={{ width: s, height: s, color: cfg.color }} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )
  }
  if (cfg.icon === 'check') {
    return (
      <svg className="shrink-0" style={{ width: s, height: s, color: cfg.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (cfg.icon === 'error') {
    return (
      <svg className="shrink-0" style={{ width: s, height: s, color: cfg.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    )
  }
  if (cfg.icon === 'upload') {
    return (
      <svg className="shrink-0" style={{ width: s, height: s, color: cfg.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    )
  }
  return (
    <div className="shrink-0 rounded-full" style={{ width: s, height: s, backgroundColor: cfg.color, opacity: 0.4 }} />
  )
}

export function FileStatusRow({ name, status, detail }: { name: string; status: string; detail: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.info
  const isActive = ['uploading', 'analyzing', 'classifying', 'extracting', 'tagging', 'mapping', 'processing', 'enriching'].includes(status)

  return (
    <div className={`flex items-center gap-3 py-1.5 px-3 rounded-md transition-colors ${isActive ? 'bg-[var(--color-bg-secondary)]' : ''}`}>
      <StatusIcon status={status} />
      <span className="text-sm truncate flex-1 min-w-0">{name}</span>
      <span className="text-xs shrink-0 tabular-nums" style={{ color: cfg.color }}>
        {cfg.label}
      </span>
      {detail && status !== 'queued' && (
        <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[180px] hidden sm:inline">{detail}</span>
      )}
    </div>
  )
}

export function BatchCard({ batch, fileEvents }: { batch: ActivityBatch; fileEvents: Record<string, { status: string; detail: string }> }) {
  const fileEntries = Object.entries(batch.files)
  const doneCount = fileEntries.filter(([, s]) => s === 'done').length
  const totalCount = fileEntries.length
  const isRunning = batch.status === 'running'

  return (
    <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--color-bg-secondary)]">
        <div className="flex items-center gap-2">
          <StatusIcon status={batch.status} />
          <span className="text-sm font-medium">
            {totalCount} document{totalCount !== 1 ? 's' : ''}
          </span>
          {isRunning && (
            <span className="text-xs text-[var(--color-text-secondary)]">
              {doneCount}/{totalCount} complete
            </span>
          )}
        </div>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {new Date(batch.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {isRunning && totalCount > 0 && (
        <div className="h-0.5 bg-[var(--color-border)]">
          <div
            className="h-full bg-[var(--color-accent)] transition-all duration-500"
            style={{ width: `${(doneCount / totalCount) * 100}%` }}
          />
        </div>
      )}
      <div className="divide-y divide-[var(--color-border)]">
        {fileEntries.map(([fileName, batchStatus]) => {
          const evt = fileEvents[fileName]
          const currentStatus = evt?.status || batchStatus
          const detail = evt?.detail || ''
          return (
            <FileStatusRow key={fileName} name={fileName} status={currentStatus} detail={detail} />
          )
        })}
      </div>
    </div>
  )
}

export function EventTypeIcon({ type }: { type: string }) {
  if (type === 'quick_note') {
    return (
      <svg className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    )
  }
  if (type === 'inbox_process') {
    return (
      <svg className="w-3.5 h-3.5 text-[var(--color-warning)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5 text-[var(--color-text-secondary)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}
