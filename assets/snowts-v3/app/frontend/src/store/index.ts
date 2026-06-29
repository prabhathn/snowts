import { create } from 'zustand'
import type { AppStatus, NoteEntry, Client } from '../types'

interface ArticleUpdate {
  slug: string
  content: string
  ts: number
}

interface AppStore {
  status: AppStatus | null
  recentNotes: NoteEntry[]
  clients: Client[]
  commandPaletteOpen: boolean
  lastArticleUpdate: ArticleUpdate | null

  setStatus: (s: AppStatus) => void
  addRecentNote: (n: NoteEntry) => void
  setClients: (c: Client[]) => void
  setCommandPaletteOpen: (open: boolean) => void
  setArticleUpdate: (slug: string, content: string) => void
}

export const useAppStore = create<AppStore>((set) => ({
  status: null,
  recentNotes: [],
  clients: [],
  commandPaletteOpen: false,
  lastArticleUpdate: null,

  setStatus: (status) => set({ status }),
  addRecentNote: (n) => set((s) => ({ recentNotes: [n, ...s.recentNotes].slice(0, 20) })),
  setClients: (clients) => set({ clients }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setArticleUpdate: (slug, content) => set({ lastArticleUpdate: { slug, content, ts: Date.now() } }),
}))
