import { useState, useRef, useMemo } from 'react'
import { useAppStore } from '../store'
import { api } from '../api/client'

interface QuickInputProps {
  open: boolean
}

const URL_RE = /^https?:\/\/\S+$/

export function QuickInput({ open }: QuickInputProps) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const { addRecentNote } = useAppStore()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const detectedMode = useMemo(() => {
    if (attachedFiles.length > 0 && !text.trim()) return 'file' as const
    if (text.trim() && URL_RE.test(text.trim())) return 'url' as const
    if (attachedFiles.length > 0) return 'mixed' as const
    return 'note' as const
  }, [text, attachedFiles])

  const handleAddFiles = (fileList: FileList | null) => {
    if (!fileList) return
    setAttachedFiles((prev) => [...prev, ...Array.from(fileList)])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  const showFlash = (msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash(null), 3000)
  }

  const handleSubmit = async () => {
    if ((!text.trim() && attachedFiles.length === 0) || submitting) return
    setSubmitting(true)
    try {
      const res = await api.smartInput({
        text: text.trim() || undefined,
        files: attachedFiles.length > 0 ? attachedFiles : undefined,
      })

      if (res.note) addRecentNote(res.note)

      if (res.type === 'url' && res.url?.ok) {
        showFlash(`Fetched: ${res.url.title || res.url.url}`)
      } else if (res.type === 'url' && res.url && !res.url.ok) {
        showFlash(`URL failed, saved as note`)
      } else if (res.type === 'file' || res.files.length > 0) {
        const fileMsg = `${res.files.length} file${res.files.length !== 1 ? 's' : ''} uploaded`
        const noteMsg = res.note ? ' + note saved' : ''
        showFlash(fileMsg + noteMsg)
      } else if (res.type === 'note') {
        showFlash('Note saved')
      }

      setText('')
      setAttachedFiles([])
    } catch {
      showFlash('Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!open) return null

  const modeHint = detectedMode === 'url'
    ? 'Link detected \u2014 will fetch and process'
    : detectedMode === 'file'
    ? `${attachedFiles.length} file${attachedFiles.length !== 1 ? 's' : ''} \u2014 will process automatically`
    : detectedMode === 'mixed'
    ? `Note + ${attachedFiles.length} file${attachedFiles.length !== 1 ? 's' : ''}`
    : null

  const flashColor = flash?.startsWith('Failed')
    ? 'border-[var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_5%,transparent)]'
    : flash
    ? 'border-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_5%,transparent)]'
    : 'border-[var(--color-border)]'

  return (
    <div className="pb-2.5 space-y-1">
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {attachedFiles.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-xs"
            >
              <svg className="w-3 h-3 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <span className="truncate max-w-[120px]">{f.name}</span>
              <button onClick={() => removeFile(i)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-danger)] transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={`flex items-center rounded-lg border transition-all ${flashColor}`}>
        <div className="pl-3 text-[var(--color-text-secondary)]">
          {detectedMode === 'url' ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
            </svg>
          ) : detectedMode === 'file' ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          )}
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Note, URL, or drop files... (Enter to send)"
          rows={1}
          className="flex-1 bg-transparent pl-2 pr-3 py-2 text-sm resize-none outline-none placeholder:text-[var(--color-text-secondary)]"
          style={{ minHeight: '36px', maxHeight: '100px' }}
          autoFocus
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".md,.txt,.docx,.pdf,.html"
          onChange={(e) => handleAddFiles(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting}
          title="Attach files"
          className="px-2 py-2 text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-40"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>
        <button
          onClick={handleSubmit}
          disabled={(!text.trim() && attachedFiles.length === 0) || submitting}
          className="px-3 py-2 text-sm font-medium text-white bg-[var(--color-accent)] rounded-r-lg hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
        >
          {submitting ? '...' : 'Send'}
        </button>
      </div>

      {(modeHint || flash) && (
        <div className="px-1 text-xs text-[var(--color-text-secondary)]">
          {flash || modeHint}
        </div>
      )}
    </div>
  )
}
