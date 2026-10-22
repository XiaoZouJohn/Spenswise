import * as sdk from '../client/generated/sdk.gen'
import { OpenAPI } from '../client/generated/core/OpenAPI'
import type { AiConnectionOut } from '../client/generated/types.gen'

OpenAPI.BASE = import.meta.env.VITE_API_URL || ''

export type DeepSeekModel = 'deepseek-flash' | 'deepseek-v4-pro'

export type AiConnection = {
  configured: boolean
  model: DeepSeekModel
  endpoint: string
}

export type AiConnectionUpdate = {
  model: DeepSeekModel
  api_key?: string
  clear_key?: boolean
}

export type AiConnectionTest = {
  ok: boolean
  message: string
}

function connection(value: AiConnectionOut): AiConnection {
  if (value.model !== 'deepseek-flash' && value.model !== 'deepseek-v4-pro') {
    throw new Error('DeepSeek 模型配置无法识别')
  }
  return { configured: value.configured, model: value.model, endpoint: value.endpoint }
}

export async function getAiConnection(): Promise<AiConnection> {
  return connection(await sdk.getAiConnectionApiAiConnectionGet())
}

export async function putAiConnection(value: AiConnectionUpdate): Promise<AiConnection> {
  return connection(await sdk.putAiConnectionApiAiConnectionPut({ requestBody: value }))
}

export async function testAiConnection(): Promise<AiConnectionTest> {
  const result = await sdk.testAiApiAiTestPost()
  if (typeof result.ok !== 'boolean' || typeof result.message !== 'string') {
    throw new Error('连接测试返回了无法识别的结果')
  }
  return { ok: result.ok, message: result.message }
}
