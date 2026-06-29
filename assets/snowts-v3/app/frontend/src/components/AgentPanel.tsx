import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api/client'
import { useAppStore } from '../store'

type MessageRole = 'user' | 'assistant'

interface StreamStep {
  type: 'status' | 'thinking' | 'tool_use' | 'tool_result'
  label: string
  detail?: string
}

interface Message {
  role: MessageRole
  text: string
  steps?: StreamStep[]
}

export function useAgentContext(): { page?: string; slug?: string; client_id?: string; note_path?: string } {
  const { pathname } = useLocation()

  const wikiMatch = pathname.match(/^\/wiki\/([^/]+)/)
  if (wikiMatch) return { page: 'wiki', slug: decodeURIComponent(wikiMatch[1]) }

  const clientMatch = pathname.match(/^\/clients\/([^/]+)/)
  if (clientMatch) return { page: 'client', client_id: decodeURIComponent(clientMatch[1]) }

  const noteMatch = pathname.match(/^\/notes\/(.+)/)
  if (noteMatch) return { page: 'note', note_path: decodeURIComponent(noteMatch[1]) }

  if (pathname === '/') return { page: 'dashboard' }
  if (pathname === '/wiki') return { page: 'wiki' }
  if (pathname === '/search') return { page: 'search' }
  if (pathname === '/notes') return { page: 'notes' }
  return {}
}

function WikiLink({ slug, children }: { slug: string; children: React.ReactNode }) {
  return (
    <Link
      to={`/wiki/${slug}`}
      className="text-[var(--color-accent)] hover:underline"
    >
      {children}
    </Link>
  )
}

interface AgentPanelProps {
  open: boolean
  onArticleUpdated?: (slug: string, content: string) => void
}

export function AgentPanel({ open, onArticleUpdated }: AgentPanelProps) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [streamText, setStreamText] = useState('')
  const [streamSteps, setStreamSteps] = useState<StreamStep[]>([])
  const [webSearch, setWebSearch] = useState(true)
  const [savingIdx, setSavingIdx] = useState<number | null>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const context = useAgentContext()
  const { setArticleUpdate } = useAppStore()
  const prevOpen = useRef(open)

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  const [userScrolled, setUserScrolled] = useState(false)
  const isAtBottomRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
      setUserScrolled(false)
      isAtBottomRef.current = true
    }
  }, [])

  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 40
    isAtBottomRef.current = atBottom
    if (!atBottom) {
      setUserScrolled(true)
    } else {
      setUserScrolled(false)
    }
  }, [])

  useEffect(() => {
    if (isAtBottomRef.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [messages, streamText, streamSteps])

  useEffect(() => {
    if (prevOpen.current && !open) {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
      setMessages([])
      setInput('')
      setStreamText('')
      setStreamSteps([])
      setLoading(false)
    }
    prevOpen.current = open
  }, [open])

  const [savedIdx, setSavedIdx] = useState<number | null>(null)

  const saveAsNote = useCallback(async (idx: number) => {
    const msg = messages[idx]
    if (!msg || msg.role !== 'assistant') return
    setSavingIdx(idx)
    try {
      await api.smartInput({ text: msg.text })
      setSavedIdx(idx)
      setTimeout(() => setSavedIdx(null), 2000)
    } catch {
      // silent
    } finally {
      setSavingIdx(null)
    }
  }, [messages])

  const send = useCallback(async () => {
    if (!input.trim() || loading) return
    const msg = input.trim()
    setInput('')
    setMessages((p) => [...p, { role: 'user', text: msg }])
    setLoading(true)
    setStreamText('')
    setStreamSteps([])

    let textAccum = ''
    let finalized = false
    const stepsAccum: StreamStep[] = []

    const controller = api.agentStream(
      msg,
      Object.keys(context).length > 0 ? context : undefined,
      (event, data) => {
        if (event === 'response.status') {
          if (textAccum) return
          stepsAccum[0] = {
            type: 'status',
            label: (data.message as string) || (data.status as string) || 'Working...',
          }
          setStreamSteps([...stepsAccum])
        } else if (event === 'response.thinking.delta') {
          stepsAccum[0] = { type: 'thinking', label: 'Reasoning...' }
          setStreamSteps([...stepsAccum])
        } else if (event === 'response.tool_use') {
          stepsAccum[0] = {
            type: 'tool_use',
            label: `Using ${(data.name as string) || 'tool'}`,
            detail: (data.type as string) || undefined,
          }
          setStreamSteps([...stepsAccum])
        } else if (event === 'response.tool_result') {
          stepsAccum[0] = {
            type: 'tool_result',
            label: `${(data.name as string) || 'Tool'}: ${(data.status as string) || 'done'}`,
          }
          setStreamSteps([...stepsAccum])
        } else if (event === 'response.text.delta') {
          textAccum += (data.text as string) || ''
          setStreamText(textAccum)
        } else if (event === 'response.text' || event === 'response.thinking' || event === 'response') {
          // ignore: full-text echoes of already-streamed deltas
        } else if (event === 'article_updated') {
          const slug = data.slug as string
          const content = data.content as string
          if (onArticleUpdated) onArticleUpdated(slug, content)
          setArticleUpdate(slug, content)
        } else if (event === 'error') {
          textAccum = `Error: ${(data.message as string) || 'Unknown error'}`
          setStreamText(textAccum)
        } else if (event === 'done') {
          if (!finalized) {
            finalized = true
            const finalText = textAccum || 'No response'
            setMessages((p) => [...p, { role: 'assistant', text: finalText, steps: [...stepsAccum] }])
            setStreamText('')
            setStreamSteps([])
            setLoading(false)
          }
        }
      },
      webSearch,
    )
    abortRef.current = controller
  }, [input, loading, context, onArticleUpdated, setArticleUpdate, webSearch])

  const markdownComponents = useMemo(() => ({
    p: ({ children, ...props }: React.ComponentProps<'p'>) => {
      const processChildren = (nodes: React.ReactNode): React.ReactNode => {
        return Array.isArray(nodes)
          ? nodes.map((child, i) => {
              if (typeof child === 'string') {
                const parts: React.ReactNode[] = []
                const regex = /\[\[([a-z0-9-]+)\|([^\]]+)\]\]|\[\[([a-z0-9-]+)\]\]/g
                let last = 0
                let match: RegExpExecArray | null
                while ((match = regex.exec(child)) !== null) {
                  if (match.index > last) parts.push(child.slice(last, match.index))
                  const slug = match[1] || match[3]
                  const display = match[2] || slug
                  parts.push(<WikiLink key={`${i}-${match.index}`} slug={slug}>{display}</WikiLink>)
                  last = regex.lastIndex
                }
                if (last < child.length) parts.push(child.slice(last))
                return parts.length > 1 ? parts : child
              }
              return child
            }).flat()
          : typeof nodes === 'string'
            ? processChildren([nodes])
            : nodes
      }
      return <p {...props}>{processChildren(children)}</p>
    },
    li: ({ children, ...props }: React.ComponentProps<'li'>) => {
      const processChildren = (nodes: React.ReactNode): React.ReactNode => {
        return Array.isArray(nodes)
          ? nodes.map((child, i) => {
              if (typeof child === 'string') {
                const parts: React.ReactNode[] = []
                const regex = /\[\[([a-z0-9-]+)\|([^\]]+)\]\]|\[\[([a-z0-9-]+)\]\]/g
                let last = 0
                let match: RegExpExecArray | null
                while ((match = regex.exec(child)) !== null) {
                  if (match.index > last) parts.push(child.slice(last, match.index))
                  const slug = match[1] || match[3]
                  const display = match[2] || slug
                  parts.push(<WikiLink key={`${i}-${match.index}`} slug={slug}>{display}</WikiLink>)
                  last = regex.lastIndex
                }
                if (last < child.length) parts.push(child.slice(last))
                return parts.length > 1 ? parts : child
              }
              return child
            }).flat()
          : typeof nodes === 'string'
            ? processChildren([nodes])
            : nodes
      }
      return <li {...props}>{processChildren(children)}</li>
    },
  }), [])

  if (!open) return null

  return (
    <div className="pb-2.5 space-y-2">
      {(messages.length > 0 || loading) && (
        <>
        <div
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="overflow-y-auto space-y-2 rounded-lg border border-[var(--color-border)] p-3 bg-[var(--color-bg)]"
          style={{ resize: 'vertical', minHeight: 120, maxHeight: '70vh', height: 320 }}
        >
          {messages.map((m, i) => (
            <div key={i}>
              {m.role === 'user' ? (
                <div className="text-sm text-right">
                  <div className="inline-block max-w-[85%] px-3 py-2 rounded-lg bg-[var(--color-accent)] text-white">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  {m.steps && m.steps.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {m.steps.map((s, j) => (
                        <StepIndicator key={j} step={s} />
                      ))}
                    </div>
                  )}
                  <div className="inline-block max-w-[85%] px-3 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
                    <div className="prose prose-sm max-w-none">
                      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{m.text}</Markdown>
                    </div>
                  </div>
                  <div className="mt-1">
                    <button
                      onClick={() => saveAsNote(i)}
                      disabled={savingIdx === i || savedIdx === i}
                      className={`flex items-center gap-1 text-[10px] transition-colors disabled:opacity-40 ${
                        savedIdx === i ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]'
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        {savedIdx === i
                          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          : <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        }
                      </svg>
                      {savingIdx === i ? 'Saving...' : savedIdx === i ? 'Saved!' : 'Save as Note'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="text-sm space-y-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {streamSteps.map((s, j) => (
                  <StepIndicator key={j} step={s} />
                ))}
              </div>
              {streamText && (
                <div className="inline-block max-w-[85%] px-3 py-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
                  <div className="prose prose-sm max-w-none">
                    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{streamText}</Markdown>
                  </div>
                </div>
              )}
              {!streamText && streamSteps.length === 0 && (
                <div className="text-xs text-[var(--color-text-secondary)] animate-pulse">Connecting...</div>
              )}
            </div>
          )}
        </div>
        {userScrolled && (
          <div className="flex justify-center -mt-1">
            <button
              onClick={scrollToBottom}
              className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-full shadow-sm hover:bg-[var(--color-bg-secondary)] transition-colors text-[var(--color-text-secondary)]"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              Latest
            </button>
          </div>
        )}
        </>
      )}
      <div className="flex items-center rounded-lg border border-[var(--color-border)]">
          <div className="pl-3 text-[var(--color-text-secondary)]">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <button
            onClick={() => setWebSearch(!webSearch)}
            title={webSearch ? 'Web search enabled' : 'Web search disabled'}
            className={`ml-1.5 flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full border transition-colors ${
              webSearch
                ? 'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30 text-[var(--color-accent)]'
                : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)] line-through'
            }`}
          >
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            Web
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Ask a question or request changes..."
            className="flex-1 bg-transparent pl-2 pr-3 py-2 text-sm outline-none placeholder:text-[var(--color-text-secondary)]"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="px-3 py-2 text-sm font-medium text-white bg-[var(--color-accent)] rounded-r-lg hover:bg-[var(--color-accent-hover)] disabled:opacity-40 transition-colors"
          >
            {loading ? '...' : 'Send'}
          </button>
        </div>
    </div>
  )
}

function StepIndicator({ step }: { step: StreamStep }) {
  const icons: Record<string, string> = {
    status: 'M13 10V3L4 14h7v7l9-11h-7z',
    thinking: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    tool_use: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    tool_result: 'M5 13l4 4L19 7',
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
      <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icons[step.type] || icons.status} />
      </svg>
      <span className="truncate">{step.label}</span>
    </div>
  )
}

export { type AgentPanelProps }
