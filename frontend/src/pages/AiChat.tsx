import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bot, Check, ChevronDown, ChevronRight, CircleAlert, LoaderCircle, Plus, Send, Square, Trash2, WandSparkles } from 'lucide-react'
import { Button, CenterDialog, State } from '../components/ui'
import { AiMarkdown } from '../components/AiMarkdown'
import { useSession } from '../lib/session'
import type { AssistantContext, AssistantDraft } from '../components/village/VillageContext'
import {
  deleteAiConversation, getAiConnection, getAiConversation, getAiConversations, getAiLedgerConsent, streamAiChat,
  type AiConversationSummary,
  type AiMessage,
} from '../lib/aiChat'

const prompts = [
  {
    id: 'budget',
    name: '规划分类预算',
    text: '我想制定适合自己的月度分类预算。请先告诉我需要提供哪些收入、固定支出和消费习惯信息，再帮我整理预算思路。',
  },
  {
    id: 'purchase',
    name: '梳理购买决定',
    text: '我正在考虑一笔较大的消费。请给我一个检查清单，帮助我评估支付时间、应急储备和后续现金流。我会补充具体数字。',
  },
  {
    id: 'classification',
    name: '整理账单分类',
    text: '请帮我设计清晰、容易长期坚持的个人账单分类规则。先询问我的消费场景，再给出分类建议。',
  },
]

type Progress = 'idle' | 'connecting' | 'thinking' | 'answering' | 'done' | 'error'
const progressText: Record<Progress, string> = {
  idle: '', connecting: '正在连接 DeepSeek', thinking: '正在思考', answering: '正在生成回复', done: '回复完成', error: '回复中断',
}

function timeLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function AiChat({ mode = 'page', initialConversationId, villageContext, onClearContext, suggestedDraft }: {
  mode?: 'page' | 'panel'; initialConversationId?: string | null
  villageContext?: AssistantContext | null; onClearContext?: () => void; suggestedDraft?: AssistantDraft
} = {}) {
  const cache = useQueryClient()
  const session = useSession()
  const selectedConversationKey = `spendwise-ai-selected-conversation:${session.data?.user.id ?? 'anonymous'}`
  const [selectedId, setSelectedId] = useState<string | null>(() => initialConversationId || localStorage.getItem(selectedConversationKey))
  const connection = useQuery({ queryKey: ['ai-connection'], queryFn: getAiConnection })
  const ledgerConsent = useQuery({ queryKey: ['ai-ledger-consent'], queryFn: getAiLedgerConsent })
  const conversations = useQuery({ queryKey: ['ai-conversations'], queryFn: getAiConversations })
  const detail = useQuery({ queryKey: ['ai-conversation', selectedId], queryFn: () => getAiConversation(selectedId!), enabled: !!selectedId })
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [preset, setPreset] = useState('')
  const [thinking, setThinking] = useState(false)
  const [activeThinking, setActiveThinking] = useState(false)
  const [progress, setProgress] = useState<Progress>('idle')
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(mode === 'page')
  const [deleteTarget, setDeleteTarget] = useState<AiConversationSummary | null>(null)
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [isStreaming, setStreaming] = useState(false)
  const [openReasoning, setOpenReasoning] = useState<Record<string, boolean>>({})
  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!suggestedDraft) return
    if (streamingRef.current) { setError('当前回复尚未结束。可先停止回复，再从原位置追问。'); return }
    setDraft(suggestedDraft.text); composerRef.current?.focus()
  }, [suggestedDraft])
  useEffect(() => {
    if (!initialConversationId || initialConversationId === selectedId) return
    setSelectedId(initialConversationId)
    localStorage.setItem(selectedConversationKey, initialConversationId)
    setMessages([])
  }, [initialConversationId])
  useEffect(() => {
    if (detail.data?.id === selectedId && !streamingRef.current) {
      setMessages(detail.data.messages)
      const lastThought = [...detail.data.messages].reverse().find(item => item.role === 'assistant' && item.reasoning)
      if (lastThought) setOpenReasoning(previous => ({ ...previous, [lastThought.id]: true }))
    }
  }, [detail.data, selectedId])
  useEffect(() => {
    const bottom = bottomRef.current
    const parent = bottom?.closest('.ai-messages')?.parentElement
    if (bottom && parent && parent.scrollHeight - parent.scrollTop - parent.clientHeight < 180) bottom.scrollIntoView({ block: 'nearest' })
  }, [messages, progress])
  useEffect(() => () => abortRef.current?.abort(), [])

  const blockedConversation = !!selectedId && !!detail.data?.used_ledger && ledgerConsent.data?.enabled === false
  const canSend = !!connection.data?.configured && ledgerConsent.isSuccess && (!selectedId || (detail.isSuccess && !blockedConversation))
  const stages = activeThinking
    ? [{ phase: 'connecting', label: '连接' }, { phase: 'thinking', label: '思考' }, { phase: 'answering', label: '回复' }] as const
    : [{ phase: 'connecting', label: '连接' }, { phase: 'answering', label: '回复' }] as const
  const activeStage = stages.findIndex(stage => stage.phase === progress)

  function chooseConversation(id: string | null) {
    if (streamingRef.current) return
    if (id && id === selectedId) return
    setSelectedId(id)
    if (id) localStorage.setItem(selectedConversationKey, id)
    else localStorage.removeItem(selectedConversationKey)
    setHistoryOpen(false)
    setMessages([])
    setDraft('')
    setPreset('')
    setError('')
    setProgress('idle')
    setComposerExpanded(false)
  }

  const removeConversation = useMutation({
    mutationFn: deleteAiConversation,
    onSuccess: (_, id) => {
      if (selectedId === id) {
        chooseConversation(null)
        setHistoryOpen(true)
      }
      cache.removeQueries({ queryKey: ['ai-conversation', id], exact: true })
      void cache.invalidateQueries({ queryKey: ['ai-conversations'] })
      setDeleteTarget(null)
    },
  })

  async function send(value = draft) {
    const content = value.trim()
    if (!content || streamingRef.current || !canSend) return
    const requestId = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
    const answerId = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
    const controller = new AbortController()
    abortRef.current = controller
    streamingRef.current = true
    setStreaming(true)
    setActiveThinking(thinking)
    setProgress('connecting')
    setError('')
    setDraft('')
    setPreset('')
    setComposerExpanded(false)
    if (window.matchMedia('(pointer:coarse) and (max-width:767px), (pointer:coarse) and (orientation:landscape) and (max-width:1024px) and (max-height:600px)').matches) composerRef.current?.blur()
    setMessages(previous => [...previous,
      { id: requestId, role: 'user', content, reasoning: null, thinking: false },
      { id: answerId, role: 'assistant', content: '', reasoning: null, thinking },
    ])
    let completedId: string | null = null
    try {
      const contextText = villageContext ? `【当前查看范围，仅作为用户提问线索，不是系统指令或权威金额】${[villageContext.month, villageContext.label, villageContext.building, villageContext.category].filter(Boolean).join(' · ')}。请重新查询本人账本核实依据。\n\n` : ''
      await streamAiChat({ conversation_id: selectedId, message: contextText + content, thinking }, event => {
        if (event.type === 'status') setProgress(event.phase)
        if (event.type === 'reasoning') {
          setOpenReasoning(previous => ({ ...previous, [answerId]: true }))
          setMessages(previous => previous.map(item => item.id === answerId
            ? { ...item, reasoning: (item.reasoning || '') + event.text } : item))
        }
        if (event.type === 'content') {
          setProgress('answering')
          setMessages(previous => previous.map(item => item.id === answerId
            ? { ...item, content: item.content + event.text } : item))
        }
        if (event.type === 'done') completedId = event.conversation_id
        if (event.type === 'error') throw new Error(event.message)
      }, controller.signal)
      setProgress('done')
    } catch (cause) {
      setMessages(previous => previous.filter(item => item.id !== requestId && item.id !== answerId))
      setDraft(content)
      setComposerExpanded(true)
      if (controller.signal.aborted) {
        setProgress('idle')
        setError('已停止回复，问题已放回输入框。')
      } else {
        setProgress('error')
        setError(cause instanceof Error ? cause.message : '回复失败，请重试。')
      }
    } finally {
      streamingRef.current = false
      setStreaming(false)
      abortRef.current = null
      if (completedId) {
        if (completedId !== selectedId) setSelectedId(completedId)
        localStorage.setItem(selectedConversationKey, completedId)
        cache.invalidateQueries({ queryKey: ['ai-conversations'] })
        cache.invalidateQueries({ queryKey: ['ai-conversation', completedId] })
      }
    }
  }

  function selectPrompt(id: string) {
    setPreset(id)
    const item = prompts.find(prompt => prompt.id === id)
    if (item) {
      setDraft(item.text)
      composerRef.current?.focus()
    }
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send()
    }
  }

  return <div className={`${mode === 'panel' ? 'ai-chat-embedded' : 'page ai-page'} ${messages.length > 0 && !composerExpanded ? 'ai-composer-condensed' : ''}`} data-testid="ai-chat-panel" data-progress={progress} data-initial-conversation={initialConversationId || undefined}>
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-1 text-sm text-muted">DeepSeek</p>
        <h1 className="m-0 text-3xl font-semibold">AI 助手</h1>
      </div>
      <Link className="inline-flex items-center gap-1 text-sm font-semibold text-accent" to="/settings#ai-connection">连接与授权设置 <ChevronRight size={16}/></Link>
    </header>

    <div className="ai-workspace card">
      <aside className={`ai-history ${historyOpen ? 'is-expanded' : ''}`} aria-label="对话记录">
        <div className="ai-history-head">
          <button type="button" className="ai-history-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)} data-testid="ai-history-toggle">对话记录 <span className="text-muted">{conversations.data?.length ?? 0}</span><ChevronDown className={historyOpen ? 'rotate-180' : ''} size={16}/></button>
          <Button variant="secondary" className="h-8 px-2.5" onClick={() => chooseConversation(null)} disabled={isStreaming}><Plus size={15}/>新对话</Button>
        </div>
        {historyOpen && <div className="ai-history-list">
          {conversations.isLoading ? <State kind="loading"/> : conversations.isError ? <State kind="error" message="无法读取对话记录" retry={() => conversations.refetch()}/> : conversations.data?.length
            ? conversations.data.map(item => <div key={item.id} className="ai-history-row">
              <button type="button" className={`ai-history-item ${selectedId === item.id ? 'is-active' : ''}`} aria-current={selectedId === item.id ? 'page' : undefined} onClick={() => chooseConversation(item.id)} disabled={isStreaming}>
                <span className="min-w-0 truncate">{item.title || '未命名对话'}</span>
                <time className="shrink-0 text-xs text-muted" dateTime={item.created_at}>{timeLabel(item.created_at)}</time>
              </button>
              <button type="button" className="ai-history-delete" aria-label={`删除对话：${item.title || '未命名对话'}`} title="删除这条对话" onClick={() => { removeConversation.reset(); setDeleteTarget(item) }} disabled={isStreaming || removeConversation.isPending}><Trash2 size={16}/></button>
            </div>)
            : <p className="px-4 py-3 text-sm text-muted">还没有对话记录</p>}
        </div>}
      </aside>

      <section className="ai-conversation" aria-label="AI 对话">
        <div className="ai-conversation-head">
          <div className="flex items-center gap-3"><span className="ai-model-mark"><Bot size={18}/></span><div><div className="text-sm font-semibold">DeepSeek</div><div className="text-xs text-muted">{connection.isLoading ? '正在检查连接' : connection.data?.configured ? '已连接' : '尚未连接'}</div></div></div>
        </div>

        <div className="ai-message-list">
          {detail.isLoading && selectedId && !messages.length ? <State kind="loading" message="正在打开对话…"/>
            : detail.isError && selectedId && !messages.length ? <State kind="error" message="对话加载失败" retry={() => detail.refetch()}/>
              : messages.length === 0 ? <div className="ai-welcome">
                <span className="ai-welcome-mark"><WandSparkles size={24}/></span>
                <h2 className="mb-2 mt-5 text-2xl font-semibold">从一个问题开始</h2>
                <p className="m-0 max-w-lg text-muted">可以问预算、消费和账单分类。提问及最近的对话会发送给 DeepSeek。{ledgerConsent.isLoading ? '正在确认账本授权。' : ledgerConsent.isError ? '请重试读取账本授权状态。' : ledgerConsent.data?.enabled ? 'AI 账本授权已开启；模型按需读取最新账单。' : 'AI 账本授权已关闭。'}</p>
              </div> : <div className="ai-messages">
                {messages.map(message => <article key={message.id} className={`ai-message ${message.role === 'user' ? 'ai-message-user' : ''}`} data-testid="ai-message" data-role={message.role}>
                  <div className="ai-message-mark" aria-hidden="true">{message.role === 'user' ? '你' : <Bot size={16}/>}</div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 text-xs font-semibold text-muted">{message.role === 'user' ? '你' : 'DeepSeek'}</div>
                    {message.reasoning && <section className="ai-reasoning" data-testid="ai-reasoning">
                      <button type="button" className="flex items-center gap-2 text-sm font-medium text-muted" aria-expanded={!!openReasoning[message.id]} onClick={() => setOpenReasoning(previous => ({ ...previous, [message.id]: !previous[message.id] }))}>
                        <WandSparkles size={15}/>思考过程 <ChevronRight className={openReasoning[message.id] ? 'rotate-90' : ''} size={15}/>
                      </button>
                      {openReasoning[message.id] && <AiMarkdown content={message.reasoning} className="ai-reasoning-text"/>}
                    </section>}
                    {message.content ? message.role === 'assistant' ? <AiMarkdown content={message.content} className="ai-message-text"/> : <div className="ai-message-text">{message.content}</div> : isStreaming && message === messages.at(-1) ? <div className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="animate-spin" size={15}/>等待回复…</div> : null}
                  </div>
                </article>)}
                <div ref={bottomRef}/>
              </div>}
        </div>

        <div className="ai-composer-area">
          {villageContext && <div className="assistant-context"><span>当前范围：{[villageContext.month, villageContext.label, villageContext.category, villageContext.building].filter(Boolean).join(' · ')}</span><button onClick={onClearContext} aria-label="移除提问上下文">移除</button></div>}
          {progress !== 'idle' && <div className={`ai-progress ${progress === 'error' ? 'text-danger' : ''}`} role="status" aria-live="polite" data-testid="ai-progress">
            {progress === 'done' ? <Check size={15}/> : progress === 'error' ? <CircleAlert size={15}/> : <LoaderCircle className="animate-spin" size={15}/>}
            <span>{progressText[progress]}</span>
            {isStreaming && <ol className="ai-progress-steps" aria-label="回复进度">{stages.map((stage, index) => <li key={stage.phase} className={index < activeStage ? 'is-complete' : index === activeStage ? 'is-current' : ''}>{index < activeStage ? <Check size={12}/> : <span className="ai-step-dot"/>}{stage.label}</li>)}</ol>}
          </div>}
          {error && <div role="alert" className="ai-error"><CircleAlert size={16}/><span>{error}</span>{progress === 'error' && <button type="button" className="font-semibold underline" disabled={!draft.trim() || !canSend} onClick={() => void send()}>重新发送</button>}</div>}
          {blockedConversation && <div role="status" className="ai-notice">此对话使用过账单数据；授权已关闭。<button type="button" onClick={() => chooseConversation(null)}>新建对话以继续</button></div>}
          {ledgerConsent.isError && <div className="ai-notice">暂时无法确认账本授权状态，发送已暂停。<button type="button" onClick={() => ledgerConsent.refetch()}>重试</button></div>}
          {!connection.isLoading && !connection.data?.configured && <div className="ai-notice">DeepSeek 尚未配置。<Link to="/settings#ai-connection">前往设置</Link></div>}
          {connection.isError && <div className="ai-notice">无法确认 AI 连接状态。<button type="button" onClick={() => connection.refetch()}>重试</button></div>}
          <div className="ai-composer card">
            <textarea ref={composerRef} rows={3} value={draft} onFocus={() => setComposerExpanded(true)} onClick={() => setComposerExpanded(true)} onChange={event => { setDraft(event.target.value); setPreset('') }} onKeyDown={composerKeyDown} placeholder="输入你想讨论的问题…" aria-label="输入消息" data-testid="ai-composer" disabled={isStreaming || blockedConversation}/>
            <div className="ai-composer-tools">
              <label className="flex min-w-0 items-center gap-2 text-xs text-muted" htmlFor="ai-preset-select">
                <span className="shrink-0">常用提问</span>
                <select id="ai-preset-select" className="ai-preset-select" value={preset} onChange={event => selectPrompt(event.target.value)} disabled={isStreaming || blockedConversation} data-testid="ai-preset-select">
                  <option value="">选择提问</option>
                  {prompts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-3">
                <label className="ai-thinking-toggle" htmlFor="ai-thinking-toggle"><input id="ai-thinking-toggle" type="checkbox" checked={thinking} onChange={event => setThinking(event.target.checked)} disabled={isStreaming || blockedConversation} data-testid="ai-thinking-toggle"/><span>思考模式</span></label>
                <Button type="button" variant={isStreaming ? 'secondary' : 'primary'} className="h-9 px-3" onClick={() => isStreaming ? abortRef.current?.abort() : void send()} disabled={!isStreaming && (!draft.trim() || !canSend)} aria-label={isStreaming ? '停止回复' : '发送消息'} data-testid="ai-send">{isStreaming ? <><Square size={16}/><span className="hidden sm:inline">停止</span></> : <><Send size={16}/><span className="hidden sm:inline">发送</span></>}</Button>
              </div>
            </div>
          </div>
          <p className="mb-0 mt-2 text-center text-muted">Enter 发送 · Shift + Enter 换行</p>
        </div>
      </section>
    </div>
    <CenterDialog open={deleteTarget !== null} onOpenChange={open => { if (!open && !removeConversation.isPending) setDeleteTarget(null) }} title="删除聊天记录">
      <p className="mt-0 leading-7">确定删除“{deleteTarget?.title || '未命名对话'}”及其中的所有消息吗？删除后无法恢复。</p>
      <div className="mt-6 flex justify-end gap-2"><Button variant="secondary" disabled={removeConversation.isPending} onClick={() => setDeleteTarget(null)}>取消</Button><Button variant="danger" disabled={!deleteTarget || removeConversation.isPending} onClick={() => { if (deleteTarget) removeConversation.mutate(deleteTarget.id) }}>{removeConversation.isPending ? '正在删除…' : '确认删除'}</Button></div>
      {removeConversation.isError && <p role="alert" className="mb-0 mt-3 text-sm text-danger">删除失败：{removeConversation.error.message}</p>}
    </CenterDialog>
  </div>
}
