import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react'
import { api } from '../api/client'
import type { ActivityEvent, ActivityBatch } from '../types'

interface ActivityState {
  batches: ActivityBatch[]
  events: ActivityEvent[]
  fileEvents: Record<string, { status: string; detail: string }>
  connected: boolean
}

const ActivityContext = createContext<ActivityState>({
  batches: [],
  events: [],
  fileEvents: {},
  connected: false,
})

export function useActivity() {
  return useContext(ActivityContext)
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [batches, setBatches] = useState<ActivityBatch[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [fileEvents, setFileEvents] = useState<Record<string, { status: string; detail: string }>>({})
  const [connected, setConnected] = useState(false)
  const syncedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    api.getActivityHistory().then((data) => {
      if (cancelled) return
      if (data.batches) setBatches(data.batches)
      if (data.events) setEvents(data.events.slice(0, 200))
    }).catch(() => {})

    syncedRef.current = false
    const controller = api.activityStream((eventType, data) => {
      if (eventType === 'batch') {
        setBatches((prev) => {
          const batch = data as unknown as ActivityBatch
          const exists = prev.find((b) => b.id === batch.id)
          if (exists) return prev.map((b) => b.id === batch.id ? batch : b)
          return [batch, ...prev]
        })
      } else if (eventType === 'event') {
        const evt = data as unknown as ActivityEvent
        setEvents((prev) => [evt, ...prev].slice(0, 200))

        if (syncedRef.current && evt.type === 'file_status' && evt.batch_id && evt.file_name) {
          setFileEvents((prev) => ({ ...prev, [evt.file_name!]: { status: evt.status, detail: evt.detail } }))
          setBatches((prev) => prev.map((b) => {
            if (b.id !== evt.batch_id) return b
            return { ...b, files: { ...b.files, [evt.file_name!]: evt.status } }
          }))
        }
        if (syncedRef.current && evt.type === 'batch_end' && evt.batch_id) {
          setBatches((prev) => prev.map((b) => b.id === evt.batch_id ? { ...b, status: evt.status, completed_at: evt.timestamp } : b))
        }
      } else if (eventType === 'sync') {
        syncedRef.current = true
        setConnected(true)
      }
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  return (
    <ActivityContext.Provider value={{ batches, events, fileEvents, connected }}>
      {children}
    </ActivityContext.Provider>
  )
}
