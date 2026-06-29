import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, NavLink } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api/client'
import { useAppStore } from '../store'
import { formatDate } from '../utils/time'
import type { WikiArticle } from '../types'

type ViewState = 'index' | 'article'

export function Wiki() {
  const { slug } = useParams()
  const navigate = useNavigate()

  const [viewState, setViewState] = useState<ViewState>(slug ? 'article' : 'index')
  const [articles, setArticles] = useState<WikiArticle[]>([])
  const [categories, setCategories] = useState<Record<string, WikiArticle[]>>({})
  const [article, setArticle] = useState<WikiArticle | null>(null)
  const [links, setLinks] = useState<{ outgoing: { slug: string; title: string }[]; incoming: { slug: string; title: string }[] }>({ outgoing: [], incoming: [] })

  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  const { lastArticleUpdate } = useAppStore()


  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<Record<string, boolean>>({})

  const [articleLoading, setArticleLoading] = useState(false)
  const [indexLoading, setIndexLoading] = useState(true)

  useEffect(() => {
    if (slug) {
      setViewState('article')
      setArticleLoading(true)
      api.getWikiArticle(slug).then((a) => {
        setArticle(a)
        setEditContent(a.content || '')
      }).catch(() => setArticle(null)).finally(() => setArticleLoading(false))
      api.getWikiLinks(slug).then(setLinks).catch(() => {})
    } else {
      setViewState('index')
      setArticle(null)
    }
  }, [slug])

  useEffect(() => {
    setIndexLoading(true)
    Promise.all([
      api.getWikiIndex().then((r) => setCategories(r.categories)).catch(() => {}),
      api.listWikiArticles().then((r) => setArticles(r.articles)).catch(() => {}),
    ]).finally(() => setIndexLoading(false))
  }, [])

  useEffect(() => {
    if (lastArticleUpdate && slug && lastArticleUpdate.slug === slug) {
      setArticle((prev) => prev ? { ...prev, content: lastArticleUpdate.content } : prev)
      setEditContent(lastArticleUpdate.content)
    }
  }, [lastArticleUpdate, slug])

  const toc = useMemo(() => {
    if (!article?.content) return []
    const headings: { level: number; text: string; id: string }[] = []
    for (const line of article.content.split('\n')) {
      const m = line.match(/^(#{2,3})\s+(.+)/)
      if (m) {
        const id = m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-')
        headings.push({ level: m[1].length, text: m[2], id })
      }
    }
    return headings
  }, [article?.content])

  const handleSave = async () => {
    if (!slug) return
    setSaving(true)
    try {
      await api.saveWikiArticle(slug, editContent)
      setArticle((prev) => prev ? { ...prev, content: editContent } : prev)
      setEditing(false)
    } catch { /* ignore */ }
    setSaving(false)
  }


  const renderWikiContent = (content: string) => {
    let processed = content.replace(/\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g, '[$2](/wiki/$1)')
    processed = processed.replace(/\[\[([a-z0-9-]+)\]\]/g, '[$1](/wiki/$1)')
    processed = processed.replace(/^#\s+.+\n*/m, '')
    return (
      <div className="prose max-w-none">
        <Markdown remarkPlugins={[remarkGfm]}>{processed}</Markdown>
      </div>
    )
  }

  const catKeys = Object.keys(categories).sort()
  const filteredCats = selectedCategory
    ? { [selectedCategory]: categories[selectedCategory] || [] }
    : categories

  return (
    <div className="flex gap-6 min-h-[calc(100vh-8rem)]">
      <aside className="w-52 shrink-0">
        <div className="space-y-1">
          <NavLink
            to="/wiki"
            end
            className={({ isActive }) =>
              `block px-3 py-1.5 text-sm rounded-md ${isActive && !slug ? 'bg-[var(--color-accent)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}`
            }
          >
            All Articles
          </NavLink>

          <div className="pt-2 pb-1 px-3 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
            Categories
          </div>
          {catKeys.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className={`block w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${
                selectedCategory === cat
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'
              }`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
              <span className="ml-1 text-xs opacity-60">({(categories[cat] || []).length})</span>
            </button>
          ))}

          {articles.length > 0 && (
            <>
              <div className="pt-3 pb-1 px-3 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                Recent
              </div>
              {articles.slice(0, 8).map((a) => (
                <NavLink
                  key={a.slug}
                  to={`/wiki/${a.slug}`}
                  className={({ isActive }) =>
                    `block px-3 py-1 text-sm rounded-md truncate ${isActive ? 'bg-[var(--color-bg-secondary)] font-medium' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}`
                  }
                >
                  {a.title}
                </NavLink>
              ))}
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {viewState === 'index' && (
          <div>
            <h1 className="text-2xl font-bold mb-4">Knowledge Base</h1>
            {Object.keys(filteredCats).sort().map((cat) => (
              <div key={cat} className="mb-6">
                <button
                  onClick={() => setSidebarCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                  className="flex items-center gap-2 text-lg font-semibold mb-2 hover:text-[var(--color-accent)]"
                >
                  <span className="text-xs">{sidebarCollapsed[cat] ? '\u25B6' : '\u25BC'}</span>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  <span className="text-sm font-normal text-[var(--color-text-secondary)]">({filteredCats[cat].length})</span>
                </button>
                {!sidebarCollapsed[cat] && (
                  <div className="space-y-1 ml-4">
                    {filteredCats[cat].map((a) => (
                      <div key={a.slug} className="flex items-baseline gap-2">
                        <NavLink
                          to={`/wiki/${a.slug}`}
                          className="text-[var(--color-accent)] hover:underline text-sm font-medium"
                        >
                          {a.title}
                        </NavLink>
                        {a.summary && (
                          <span className="text-xs text-[var(--color-text-secondary)] truncate">{a.summary.slice(0, 80)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {Object.keys(filteredCats).length === 0 && (
              indexLoading ? (
                <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm py-8">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading articles...
                </div>
              ) : (
                <p className="text-[var(--color-text-secondary)] text-sm">
                  No wiki articles yet. Drop documents into raw/ or paste a URL to get started.
                </p>
              )
            )}
          </div>
        )}

        {viewState === 'article' && article && (
          <div>
            <div className="flex items-center gap-3 mb-1">
              <button
                onClick={() => navigate('/wiki')}
                className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              >
                Wiki
              </button>
              <span className="text-[var(--color-text-secondary)]">/</span>
              {article.category && (
                <>
                  <button
                    onClick={() => { navigate('/wiki'); setSelectedCategory(article.category) }}
                    className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] capitalize"
                  >
                    {article.category}
                  </button>
                  <span className="text-[var(--color-text-secondary)]">/</span>
                </>
              )}
              <span className="text-sm font-medium">{article.title}</span>
            </div>

            <div className="flex items-center gap-2 mb-4">
              <h1 className="text-2xl font-bold flex-1">{article.title}</h1>
              <button
                onClick={() => { setEditing(!editing); setEditContent(article.content || '') }}
                className="px-3 py-1 text-sm border border-[var(--color-border)] rounded-md hover:bg-[var(--color-bg-secondary)]"
              >
                {editing ? 'Preview' : 'Edit'}
              </button>
              {editing && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-1 text-sm bg-[var(--color-accent)] text-white rounded-md disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>

            {article.tags && article.tags.length > 0 && (
              <div className="flex gap-1 mb-4">
                {article.tags.map((t) => (
                  <span key={t} className="px-2 py-0.5 text-xs bg-[var(--color-bg-secondary)] rounded-full text-[var(--color-text-secondary)]">{t}</span>
                ))}
              </div>
            )}

            {editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full min-h-[60vh] p-4 text-sm font-mono border border-[var(--color-border)] rounded-lg bg-[var(--color-bg-elevated)] resize-y"
              />
            ) : (
              renderWikiContent(article.content || '')
            )}
          </div>
        )}

        {viewState === 'article' && !article && slug && (
          articleLoading
            ? <div className="flex items-center gap-2 text-[var(--color-text-secondary)] text-sm py-8"><span className="animate-pulse">Loading article...</span></div>
            : <div className="text-[var(--color-text-secondary)]">Article not found: {slug}</div>
        )}
      </main>

      {viewState === 'article' && article && (
        <aside className="w-56 shrink-0 hidden lg:block">
          <div className="space-y-4">
            {toc.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">Contents</div>
                <div className="space-y-0.5">
                  {toc.map((h) => (
                    <a
                      key={h.id}
                      href={`#${h.id}`}
                      className={`block text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] truncate ${h.level === 3 ? 'pl-3' : ''}`}
                    >
                      {h.text}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {(links.outgoing.length > 0 || links.incoming.length > 0) && (
              <div>
                <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">Related</div>
                {links.outgoing.map((l) => (
                  <NavLink
                    key={`out-${l.slug}`}
                    to={`/wiki/${l.slug}`}
                    className="block text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] truncate mb-0.5"
                  >
                    {l.title}
                  </NavLink>
                ))}
                {links.incoming.length > 0 && (
                  <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mt-3 mb-1">Backlinks</div>
                )}
                {links.incoming.map((l) => (
                  <NavLink
                    key={`in-${l.slug}`}
                    to={`/wiki/${l.slug}`}
                    className="block text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] truncate mb-0.5"
                  >
                    {l.title}
                  </NavLink>
                ))}
              </div>
            )}

            {article.updated_at && (
              <div className="text-xs text-[var(--color-text-secondary)]">
                Updated: {formatDate(article.updated_at)}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
