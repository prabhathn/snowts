import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api/client'
import { formatTime } from '../utils/time'
import type { Article } from '../types'

type ViewMode = 'inbox' | 'note'

type LogEntry = {
  id: string
  timestamp: string
  preview: string
  status: 'processing' | 'done' | 'error'
  classification: {
    sections: { client: string | null; summary: string; key_points: string[]; contacts: { name: string; role: string | null }[]; tags: string[] }[]
    todos: { title: string; due_date: string | null; priority: string; client: string | null }[]
    tags: string[]
  } | null
  routed: { client: string; file: string; client_id?: string }[] | null
  error: string | null
}

export function Notes() {
  const { path } = useParams()
  const [notesList, setNotesList] = useState<Article[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>(path ? 'note' : 'inbox')
  const [selectedPath, setSelectedPath] = useState<string | null>(path || null)

  const [inboxContent, setInboxContent] = useState('')
  const [inboxDirty, setInboxDirty] = useState(false)
  const [inboxSaving, setInboxSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logOpen, setLogOpen] = useState(true)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [editingClientKey, setEditingClientKey] = useState<string | null>(null)
  const [editingClientName, setEditingClientName] = useState('')
  const [renamingClient, setRenamingClient] = useState(false)

  const [noteContent, setNoteContent] = useState('')
  const [noteDirty, setNoteDirty] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [notePreview, setNotePreview] = useState(true)
  const [annotationText, setAnnotationText] = useState('')
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [annotating, setAnnotating] = useState(false)
  const [annotationResult, setAnnotationResult] = useState<string | null>(null)
  const [uploadResult, setUploadResult] = useState<{ saved: number; errors: string[] } | null>(null)
  const [uploading, setUploading] = useState(false)
  const inboxRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.listNotes().then((r) => setNotesList(r.notes)).catch(() => {})
  }, [])

  useEffect(() => {
    api.getInbox().then((r) => {
      setInboxContent(r.content)
      setInboxDirty(false)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    api.getInboxLog().then((r) => setLogEntries(r.entries)).catch(() => {})
  }, [])

  const hasProcessing = logEntries.some((e) => e.status === 'processing')
  useEffect(() => {
    if (!hasProcessing) return
    const interval = setInterval(() => {
      api.getInboxLog().then((r) => {
        setLogEntries(r.entries)
        const stillProcessing = r.entries.some((e: LogEntry) => e.status === 'processing')
        if (!stillProcessing) {
          api.listNotes().then((nr) => setNotesList(nr.notes)).catch(() => {})
        }
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [hasProcessing])

  useEffect(() => {
    if (selectedPath && viewMode === 'note') {
      setNoteDirty(false)
      setNotePreview(true)
      setAnnotationText('')
      setAnnotationOpen(false)
      setAnnotationResult(null)
      api.getNote(selectedPath).then((r) => {
        setNoteContent(r.content)
        setNoteDirty(false)
      }).catch(() => {})
    }
  }, [selectedPath, viewMode])

  const saveInbox = useCallback(async () => {
    if (inboxSaving || !inboxDirty) return
    setInboxSaving(true)
    try {
      await api.saveInbox(inboxContent)
      setInboxDirty(false)
    } catch {}
    setInboxSaving(false)
  }, [inboxContent, inboxSaving, inboxDirty])

  useEffect(() => {
    if (viewMode !== 'inbox') return
    const timer = setTimeout(saveInbox, 2000)
    return () => clearTimeout(timer)
  }, [inboxContent, viewMode, saveInbox])

  const saveNote = useCallback(async () => {
    if (!selectedPath || noteSaving || !noteDirty) return
    setNoteSaving(true)
    try {
      await api.saveNote(selectedPath, noteContent)
      setNoteDirty(false)
    } catch {}
    setNoteSaving(false)
  }, [selectedPath, noteContent, noteSaving, noteDirty])

  useEffect(() => {
    if (viewMode !== 'note' || !selectedPath) return
    const timer = setTimeout(saveNote, 2000)
    return () => clearTimeout(timer)
  }, [noteContent, viewMode, selectedPath, saveNote])

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadResult(null)
    try {
      const res = await api.uploadRawFiles(files)
      setUploadResult({ saved: res.saved.length, errors: res.errors.map((e) => `${e.file}: ${e.error}`) })
    } catch (e: any) {
      setUploadResult({ saved: 0, errors: [e.message || 'Upload failed'] })
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleProcess = async () => {
    if (!inboxContent.trim()) return
    if (inboxDirty) {
      await api.saveInbox(inboxContent)
      setInboxDirty(false)
    }
    setInboxContent('')
    setInboxDirty(false)
    setLogOpen(true)
    try {
      await api.processInbox()
      api.getInboxLog().then((r) => setLogEntries(r.entries)).catch(() => {})
    } catch {}
  }

  const handleInboxChange = (val: string) => {
    setInboxContent(val)
    setInboxDirty(true)
  }

  const handleNoteChange = (val: string) => {
    setNoteContent(val)
    setNoteDirty(true)
  }

  const handleAnnotate = async () => {
    if (!selectedPath || annotating || !annotationText.trim()) return
    if (noteDirty) {
      await api.saveNote(selectedPath, noteContent)
      setNoteDirty(false)
    }
    setAnnotating(true)
    setAnnotationResult(null)
    try {
      const result = await api.annotateNote(selectedPath, annotationText)
      setNoteContent(result.merged)
      setNoteDirty(false)
      setAnnotationResult(result.summary)
      setAnnotationText('')
    } catch {}
    setAnnotating(false)
  }

  const selectNote = (filePath: string) => {
    setSelectedPath(filePath)
    setViewMode('note')
  }

  const selectInbox = () => {
    setViewMode('inbox')
    setSelectedPath(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, isInbox: boolean) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const val = isInbox ? inboxContent : noteContent
      const updated = val.substring(0, start) + '  ' + val.substring(end)
      if (isInbox) handleInboxChange(updated)
      else handleNoteChange(updated)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
  }


  const grouped = notesList.reduce<Record<string, Article[]>>((acc, a) => {
    const parts = a.file_path.split('/')
    const group = parts.length > 2 ? parts[1] : 'other'
    if (!acc[group]) acc[group] = []
    acc[group].push(a)
    return acc
  }, {})

  return (
    <div className="flex gap-6 pb-8 -mx-4">
      <aside className="w-56 shrink-0 pl-4">
        <div>
          <button
            onClick={selectInbox}
            className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg transition-colors mb-4 font-semibold ${
              viewMode === 'inbox'
                ? 'bg-[var(--color-accent)] text-white shadow-sm'
                : 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-accent)]'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293h3.172a1 1 0 00.707-.293l2.414-2.414a1 1 0 01.707-.293H20" />
            </svg>
            Inbox
          </button>

          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-3">Notes</h2>
          {Object.entries(grouped).map(([group, articles]) => (
            <div key={group} className="mb-4">
              <h3 className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">{group}</h3>
              <ul className="space-y-0.5">
                {articles.map((a) => (
                  <li key={a.file_path}>
                    <button
                      onClick={() => selectNote(a.file_path)}
                      className={`w-full text-left text-sm px-2 py-1 rounded transition-colors truncate ${
                        viewMode === 'note' && selectedPath === a.file_path
                          ? 'bg-[var(--color-accent)] text-white'
                          : 'hover:bg-[var(--color-bg-secondary)]'
                      }`}
                    >
                      {a.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {notesList.length === 0 && (
            <p className="text-xs text-[var(--color-text-secondary)]">No notes yet</p>
          )}
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {viewMode === 'inbox' ? (
          <div className="space-y-3">
            <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Inbox</span>
                  <span className="text-xs text-[var(--color-text-secondary)] w-16">
                    {uploading ? 'Uploading...' : inboxSaving ? 'Saving...' : inboxDirty ? 'Unsaved' : 'Saved'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleProcess}
                    disabled={!inboxContent.trim()}
                    className="text-xs px-3 py-1 rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40 font-medium"
                  >
                    Process
                  </button>
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                      showPreview
                        ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]'
                    }`}
                  >
                    {showPreview ? 'Edit' : 'Preview'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".md,.txt,.docx,.pdf,.html"
                    onChange={(e) => handleUpload(e.target.files)}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    title={uploading ? 'Uploading...' : 'Upload files to raw/'}
                    className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-40"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </button>
                </div>
              </div>

              {uploadResult && (
                <div className={`mx-4 mt-3 text-xs px-3 py-2 rounded border ${
                  uploadResult.errors.length > 0
                    ? 'border-[var(--color-warning)] bg-[var(--color-warning)]/10'
                    : 'border-[var(--color-success)] bg-[var(--color-success)]/10'
                }`}>
                  {uploadResult.saved > 0 && (
                    <span className="text-[var(--color-success)]">{uploadResult.saved} file{uploadResult.saved !== 1 ? 's' : ''} uploaded to raw/</span>
                  )}
                  {uploadResult.errors.map((e, i) => (
                    <div key={i} className="text-[var(--color-error)]">{e}</div>
                  ))}
                </div>
              )}

              {showPreview ? (
                <div className="p-4 min-h-[300px] prose prose-sm prose-invert max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]}>{inboxContent}</Markdown>
                </div>
              ) : (
                <textarea
                  ref={inboxRef}
                  value={inboxContent}
                  onChange={(e) => handleInboxChange(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, true)}
                  placeholder="Write your notes here... meetings, thoughts, topics. Hit Process when ready.

Supports Markdown: **bold**, *italic*, - lists, # headings, etc."
                  className="w-full min-h-[300px] p-4 font-mono text-sm bg-transparent border-none outline-none resize-y rounded-b-lg"
                  spellCheck={false}
                />
              )}
            </div>

            {logEntries.length > 0 && (
              <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
                <button
                  onClick={() => setLogOpen(!logOpen)}
                  className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors rounded-t-lg"
                >
                  <span className="font-medium flex items-center gap-2">
                    <svg className={`w-3 h-3 transition-transform ${logOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Log
                    {hasProcessing && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse" />
                    )}
                  </span>
                  <span className="text-xs text-[var(--color-text-secondary)]">{logEntries.length} entries</span>
                </button>

                {logOpen && (
                  <div className="border-t border-[var(--color-border)]">
                    {logEntries.map((entry) => {
                      const isExpanded = expandedLogId === entry.id
                      return (
                        <div key={entry.id} className="border-b border-[var(--color-border)] last:border-b-0">
                          <button
                            onClick={() => setExpandedLogId(isExpanded ? null : entry.id)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--color-bg-secondary)] transition-colors"
                          >
                            <svg className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="text-xs text-[var(--color-text-secondary)] shrink-0 w-12">{formatTime(entry.timestamp)}</span>
                            <span className="text-sm truncate flex-1">{entry.preview}</span>
                            {entry.status === 'processing' && (
                              <span className="shrink-0 flex items-center gap-1.5 text-xs text-[var(--color-warning)]">
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Processing
                              </span>
                            )}
                            {entry.status === 'done' && (
                              <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--color-success)]">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                Done
                              </span>
                            )}
                            {entry.status === 'error' && (
                              <span className="shrink-0 flex items-center gap-1 text-xs text-[var(--color-error)]">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Error
                              </span>
                            )}
                          </button>

                          {isExpanded && entry.status === 'done' && entry.classification && (
                            <div className="px-4 pb-3 pt-1 ml-8 text-xs space-y-2">
                              {entry.routed && entry.routed.length > 0 && (
                                <div className="flex items-start gap-2">
                                  <span className="text-[var(--color-text-secondary)] shrink-0">Routed to:</span>
                                  <div className="flex flex-wrap gap-1">
                                    {entry.routed.map((r) => {
                                      const editKey = `${entry.id}:${r.file}`
                                      const isEditing = editingClientKey === editKey
                                      return isEditing ? (
                                        <form
                                          key={r.file}
                                          className="flex items-center gap-1"
                                          onSubmit={async (e) => {
                                            e.preventDefault()
                                            if (renamingClient || !editingClientName.trim()) return
                                            setRenamingClient(true)
                                            try {
                                              if (r.client_id) {
                                                const res = await api.renameClient(r.client_id, editingClientName.trim())
                                                r.client = res.client.name
                                                r.file = res.new_file_path
                                              } else {
                                                const res = await api.renameClientByFile(r.file, editingClientName.trim())
                                                r.client = editingClientName.trim()
                                                r.file = res.new_file_path
                                                if (res.client_id) r.client_id = res.client_id
                                              }
                                              setLogEntries([...logEntries])
                                              api.listNotes().then((nr) => setNotesList(nr.notes)).catch(() => {})
                                            } catch {}
                                            setRenamingClient(false)
                                            setEditingClientKey(null)
                                          }}
                                        >
                                          <input
                                            autoFocus
                                            value={editingClientName}
                                            onChange={(e) => setEditingClientName(e.target.value)}
                                            onBlur={() => { if (!renamingClient) setEditingClientKey(null) }}
                                            onKeyDown={(e) => { if (e.key === 'Escape') setEditingClientKey(null) }}
                                            className="text-xs px-2 py-0.5 rounded border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] outline-none w-32"
                                          />
                                          <button type="submit" disabled={renamingClient} className="text-xs text-[var(--color-accent)] hover:underline">
                                            {renamingClient ? '...' : 'Save'}
                                          </button>
                                        </form>
                                      ) : (
                                        <span key={r.file} className="inline-flex items-center gap-1">
                                          <button
                                            onClick={() => { selectNote(r.file); api.listNotes().then((res) => setNotesList(res.notes)).catch(() => {}) }}
                                            className="inline-block bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded px-2 py-0.5 hover:border-[var(--color-accent)] transition-colors cursor-pointer"
                                          >
                                            {r.client}
                                          </button>
                                          <button
                                            onClick={() => { setEditingClientKey(editKey); setEditingClientName(r.client) }}
                                            title="Rename client"
                                            className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
                                          >
                                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                              </svg>
                                            </button>
                                        </span>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                              {entry.classification.sections.map((s, i) => (
                                <div key={i} className="pl-2 border-l-2 border-[var(--color-border)]">
                                  {s.client && <span className="font-medium">{s.client}: </span>}
                                  <span className="text-[var(--color-text-secondary)]">{s.summary}</span>
                                </div>
                              ))}
                              {entry.classification.todos.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[var(--color-warning)] font-medium">TODOs:</span>
                                  <span>{entry.classification.todos.length} action items created</span>
                                </div>
                              )}
                              {entry.classification.tags.length > 0 && (
                                <div className="flex items-center gap-1">
                                  {entry.classification.tags.map((t) => (
                                    <span key={t} className="inline-block bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded px-1.5 py-0.5">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {isExpanded && entry.status === 'error' && (
                            <div className="px-4 pb-3 pt-1 ml-8 text-xs text-[var(--color-error)]">
                              {entry.error || 'Processing failed'}
                            </div>
                          )}

                          {isExpanded && entry.status === 'processing' && (
                            <div className="px-4 pb-3 pt-1 ml-8 text-xs text-[var(--color-text-secondary)]">
                              AI is analyzing and routing your note...
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : selectedPath ? (
          <div className="space-y-3">
            <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
              <button
                onClick={() => setAnnotationOpen(!annotationOpen)}
                className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors rounded-t-lg"
              >
                <span className="font-medium flex items-center gap-2">
                  <svg className={`w-3 h-3 transition-transform ${annotationOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  Annotate
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">Add thoughts & let AI merge them in</span>
              </button>
              {annotationOpen && (
                <div className="border-t border-[var(--color-border)]">
                  <textarea
                    value={annotationText}
                    onChange={(e) => { setAnnotationText(e.target.value); setAnnotationResult(null) }}
                    placeholder="Type additional thoughts, corrections, or context... AI will intelligently merge this into the note."
                    className="w-full min-h-[100px] p-4 font-mono text-sm bg-transparent border-none outline-none resize-y"
                    spellCheck={false}
                  />
                  <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)]">
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      {annotationResult && (
                        <span className="flex items-center gap-1.5 text-[var(--color-success)]">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {annotationResult}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleAnnotate}
                      disabled={annotating || !annotationText.trim()}
                      className="text-xs px-3 py-1 rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-40 font-medium"
                    >
                      {annotating ? 'Merging...' : 'Annotate'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
              <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
                {editingClientKey === 'header' ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (renamingClient || !editingClientName.trim() || !selectedPath) return
                      setRenamingClient(true)
                      try {
                        const res = await api.renameClientByFile(selectedPath, editingClientName.trim())
                        setSelectedPath(res.new_file_path)
                        api.listNotes().then((nr) => setNotesList(nr.notes)).catch(() => {})
                      } catch {}
                      setRenamingClient(false)
                      setEditingClientKey(null)
                    }}
                  >
                    <input
                      autoFocus
                      value={editingClientName}
                      onChange={(e) => setEditingClientName(e.target.value)}
                      onBlur={() => { if (!renamingClient) setEditingClientKey(null) }}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditingClientKey(null) }}
                      className="text-sm px-2 py-0.5 rounded border border-[var(--color-accent)] bg-transparent outline-none"
                    />
                    <button type="submit" disabled={renamingClient} className="text-xs text-[var(--color-accent)] hover:underline">
                      {renamingClient ? '...' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditingClientKey(null)} className="text-xs text-[var(--color-text-secondary)] hover:underline">
                      Cancel
                    </button>
                  </form>
                ) : (
                  <span className="text-sm text-[var(--color-text-secondary)] flex items-center gap-2">
                    {selectedPath}
                    {selectedPath?.startsWith('notes/clients/') && (
                      <button
                        onClick={() => {
                          const title = notesList.find((n) => n.file_path === selectedPath)?.title || selectedPath.split('/').pop()?.replace('.md', '') || ''
                          setEditingClientKey('header')
                          setEditingClientName(title)
                        }}
                        title="Rename client"
                        className="text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-secondary)] w-16">
                    {noteSaving ? 'Saving...' : noteDirty ? 'Unsaved' : 'Saved'}
                  </span>
                  <button
                    onClick={() => setNotePreview(!notePreview)}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                      notePreview
                        ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                        : 'border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]'
                    }`}
                  >
                    {notePreview ? 'Edit' : 'Preview'}
                  </button>
                </div>
              </div>
              {notePreview ? (
                <div className="p-4 min-h-[300px] prose prose-sm prose-invert max-w-none">
                  <Markdown remarkPlugins={[remarkGfm]}>{noteContent}</Markdown>
                </div>
              ) : (
                <textarea
                  ref={noteRef}
                  value={noteContent}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, false)}
                  placeholder="Start writing..."
                  className="w-full min-h-[400px] p-4 font-mono text-sm bg-transparent border-none outline-none resize-y rounded-b-lg"
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-[var(--color-text-secondary)]">
            Select a note from the sidebar
          </div>
        )}
      </div>
    </div>
  )
}
