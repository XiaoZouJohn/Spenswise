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

function connection(value: AiConnectionOut): AiConnection {
  if (value.model !== 'deepseek-flash' && value.model !== 'deepseek-v4-pro') {
    throw new Error('DeepSeek 模型配置无法识别')
  }
  return { configured: value.configured, model: value.model, endpoint: value.endpoint }
}

export async function getAiConnection(): Promise<AiConnection> {
  return connection(await sdk.getAiConnectionApiAiConnectionGet())
}
