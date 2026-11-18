import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from './session'
import { lifeApi } from './lifeApi'

export function clearLocalDrafts() {
  for (const key of Object.keys(sessionStorage)) if (key.startsWith('spendwise-draft:')) sessionStorage.removeItem(key)
}

export function usePersistentDraft<T extends object>(kind: string, id: string, initial: T) {
  const client = useQueryClient()
  const owner = useSession().data?.user.id
  const key = `spendwise-draft:${owner}:${kind}:${id}`
  const [value, setValue] = useState<T>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null')?.content ?? initial } catch { return initial }
  })
  const [status, setStatus] = useState('正在读取草稿')
  const latest = useRef(value)
  const revision = useRef(0)
  const ready = useRef(false)
  const dirty = useRef(false)
  const alive = useRef(true)
  const pending = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const persist = useRef<() => Promise<void>>(async () => {})

  persist.current = async () => {
    if (!ready.current || !dirty.current || pending.current) return
    const session = client.getQueryData<{ user: { id: number } } | null>(['session'])
    if (session?.user.id !== owner) return
    const snapshot = latest.current
    const request = (async () => {
      try {
        const stored = await lifeApi.saveDraft(kind, id, snapshot, revision.current, owner)
        revision.current = stored.revision
        if (JSON.stringify(snapshot) === JSON.stringify(latest.current)) dirty.current = false
        sessionStorage.setItem(key, JSON.stringify({ content: latest.current, revision: stored.revision, unsynced: dirty.current }))
        if (alive.current) setStatus(`草稿已保存 ${new Date(stored.updated_at!).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
      } catch { if (alive.current) setStatus('草稿同步失败，当前内容已在本窗口保留；可重试或重新读取') }
      finally { pending.current = null }
    })()
    pending.current = request
    await request
    if (dirty.current && JSON.stringify(snapshot) !== JSON.stringify(latest.current)) await persist.current()
  }

  useEffect(() => {
    alive.current = true
    let cancelled = false
    void lifeApi.draft<T>(kind, id).then(stored => {
      if (cancelled) return
      revision.current = stored.revision
      const local = JSON.parse(sessionStorage.getItem(key) || 'null')
      if (local?.unsynced) {
        latest.current = local.content
        setValue(local.content)
        if (local.revision !== stored.revision) {
          setStatus('草稿冲突，本窗口内容已保留，请读取服务端版本后合并')
          return
        }
        dirty.current = true
        setStatus('已恢复本窗口未同步草稿')
      } else if (!dirty.current && Object.keys(stored.content).length) {
        latest.current = stored.content
        setValue(stored.content)
        sessionStorage.setItem(key, JSON.stringify(stored))
        setStatus('已恢复服务端草稿')
      } else setStatus('草稿准备就绪')
      ready.current = true
      if (dirty.current) void persist.current()
    }).catch(() => { if (!cancelled) setStatus('草稿读取失败，可继续编辑并手动保存') })
    const pagehide = () => { void persist.current() }
    window.addEventListener('pagehide', pagehide)
    return () => {
      cancelled = true
      alive.current = false
      clearTimeout(timer.current)
      void persist.current()
      window.removeEventListener('pagehide', pagehide)
    }
  }, [kind, id, key])

  function change(next: SetStateAction<T>) {
    const content = typeof next === 'function' ? (next as (value: T) => T)(latest.current) : next
    dirty.current = true
    latest.current = content
    setValue(content)
    sessionStorage.setItem(key, JSON.stringify({ content, revision: revision.current, unsynced: true }))
    setStatus('草稿待保存')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void persist.current() }, 800)
  }

  async function clear(next: T) {
    clearTimeout(timer.current)
    if (pending.current) await pending.current
    dirty.current = false
    await lifeApi.clearDraft(kind, id, revision.current, owner)
    revision.current += 1
    latest.current = next
    setValue(next)
    sessionStorage.removeItem(key)
    setStatus('已保存')
  }
  async function reload() {
    const stored = await lifeApi.draft<T>(kind, id)
    revision.current = stored.revision
    ready.current = true
    dirty.current = false
    latest.current = Object.keys(stored.content).length ? stored.content : initial
    setValue(latest.current)
    sessionStorage.setItem(key, JSON.stringify(stored))
    setStatus('已读取服务端草稿')
  }
  return { value, change, clear, status, retry: () => persist.current(), reload }
}
