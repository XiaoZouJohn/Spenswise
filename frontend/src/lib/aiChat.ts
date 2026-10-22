import * as sdk from '../client/generated/sdk.gen'
import { OpenAPI } from '../client/generated/core/OpenAPI'
import type { AiConnectionOut, AiStatusOut, ChatConversationDetail, ChatConversationOut, ChatLedgerConsentOut, ChatMessageOut } from '../client/generated/types.gen'

OpenAPI.BASE = import.meta.env.VITE_API_URL || ''

export type AiConnection = AiConnectionOut
export type AiStatus = AiStatusOut
export type AiConversationSummary = ChatConversationOut
export type AiMessage = Omit<ChatMessageOut, 'id' | 'reasoning'> & { id: string | number; reasoning: string | null }
export type AiConversation = Omit<ChatConversationDetail, 'messages'> & { messages: AiMessage[] }
export type AiLedgerConsent = ChatLedgerConsentOut

export type AiStreamEvent =
  | { type: 'status'; phase: 'connecting' | 'thinking' | 'answering' }
  | { type: 'reasoning'; text: string }
  | { type: 'content'; text: string }
  | { type: 'done'; conversation_id: string }
  | { type: 'error'; message: string }

const apiRoot = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/ai`

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: string | { msg?: string; message?: string } | { msg?: string }[]; message?: string }
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) return body.detail.map(item => item.msg).filter(Boolean).join('；')
    if (body.detail && typeof body.detail === 'object') return body.detail.message || body.detail.msg || `请求失败（${response.status}）`
    if (body.message) return body.message
  } catch { /* The response may not contain JSON. */ }
  return `请求失败（${response.status}）`
}

export const getAiConnection = () => sdk.getAiConnectionApiAiConnectionGet()
export const getAiStatus = () => sdk.aiStatusApiAiStatusGet()
export const getAiConversations = () => sdk.listAiConversationsApiAiConversationsGet()
export const getAiConversation = (id: string) => sdk.getAiConversationApiAiConversationsConversationIdGet({ conversationId: id })

export const getAiLedgerConsent = () => sdk.getChatLedgerConsentApiAiChatLedgerConsentGet()
export const putAiLedgerConsent = (enabled: boolean) => sdk.putChatLedgerConsentApiAiChatLedgerConsentPut({ requestBody: { enabled } })

export async function streamAiChat(
  input: { conversation_id: string | null; message: string; thinking: boolean },
  onEvent: (event: AiStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${apiRoot}/chat/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  if (!response.body) throw new Error('服务器没有返回对话内容，请重试。')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []
  let complete = false

  function dispatch() {
    if (!dataLines.length) {
      eventName = ''
      return
    }
    const raw = dataLines.join('\n')
    dataLines = []
    let value: Record<string, unknown>
    try { value = JSON.parse(raw) as Record<string, unknown> }
    catch { eventName = ''; return }
    const type = eventName || (typeof value.type === 'string' ? value.type : '')
    eventName = ''
    if (type === 'status' && (value.phase === 'connecting' || value.phase === 'thinking' || value.phase === 'answering')) {
      onEvent({ type, phase: value.phase })
    } else if ((type === 'reasoning' || type === 'content') && typeof value.text === 'string') {
      onEvent({ type, text: value.text })
    } else if (type === 'done' && typeof value.conversation_id === 'string') {
      complete = true
      onEvent({ type, conversation_id: value.conversation_id })
    } else if (type === 'error') {
      onEvent({ type, message: typeof value.message === 'string' ? value.message : '回复失败，请重试。' })
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line
      if (!clean) dispatch()
      else if (clean.startsWith('event:')) eventName = clean.slice(6).trim()
      else if (clean.startsWith('data:')) dataLines.push(clean.slice(5).trimStart())
    }
  }
  buffer += decoder.decode()
  if (buffer) {
    const clean = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
    if (clean.startsWith('data:')) dataLines.push(clean.slice(5).trimStart())
  }
  dispatch()
  if (!complete && !signal.aborted) throw new Error('连接已中断，回复可能未完成。')
}
