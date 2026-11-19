import * as sdk from '../client/generated/sdk.gen'
import { OpenAPI } from '../client/generated/core/OpenAPI'

OpenAPI.BASE = import.meta.env.VITE_API_URL || ''
OpenAPI.WITH_CREDENTIALS = true
OpenAPI.CREDENTIALS = 'include'
export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

// Transport is generated from FastAPI OpenAPI; pages keep a short adapter.
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET'
  const body = options?.body && !(options.body instanceof FormData) ? JSON.parse(String(options.body)) : undefined
  const url = new URL(path, 'http://local')
  try {
    let result: unknown
    if (url.pathname === '/overview') result = await sdk.overviewApiOverviewGet()
    else if (url.pathname === '/budget/status') result = await sdk.getBudgetStatusApiBudgetStatusGet()
    else if (url.pathname === '/budget/preview' && method === 'POST') result = await sdk.previewBudgetApiBudgetPreviewPost({ requestBody: body })
    else if (url.pathname === '/settings' && method === 'GET') result = await sdk.getSettingsApiSettingsGet()
    else if (url.pathname === '/settings' && method === 'PUT') result = await sdk.putSettingsApiSettingsPut({ requestBody: body })
    else if (url.pathname === '/transactions' && method === 'GET') result = await sdk.transactionsApiTransactionsGet({ page: Number(url.searchParams.get('page') || 1), pageSize: Number(url.searchParams.get('page_size') || 25), category: url.searchParams.get('category'), txType: url.searchParams.get('tx_type') as 'expense' | 'income' | 'refund' | 'transfer' | null, merchant: url.searchParams.get('merchant'), dateFrom: url.searchParams.get('date_from'), dateTo: url.searchParams.get('date_to'), ids: url.searchParams.get('ids'), accountKey: url.searchParams.get("account_key"), review: url.searchParams.get('review') === 'true' })
    else if (url.pathname === '/transactions' && method === 'POST') result = await sdk.createTransactionApiTransactionsPost({ requestBody: body })
    else if (url.pathname === '/transactions' && method === 'DELETE') result = await sdk.deleteAllTransactionsApiTransactionsDelete()
    else if (/^\/transactions\/\d+$/.test(url.pathname) && method === 'DELETE') result = await sdk.deleteTransactionApiTransactionsTransactionIdDelete({ transactionId: Number(url.pathname.split('/').at(-1)) })
    else if (url.pathname === '/transactions/batch-category') result = await sdk.updateCategoriesApiTransactionsBatchCategoryPost({ requestBody: body })
    else if (url.pathname === '/transactions/undo-category') result = await sdk.undoCategoriesApiTransactionsUndoCategoryPost({ requestBody: body })
    else if (url.pathname === '/simulate') result = await sdk.simulateApiSimulatePost({ requestBody: body })
    else if (url.pathname === '/scenarios' && method === 'GET') result = await sdk.scenariosApiScenariosGet()
    else if (url.pathname === '/scenarios' && method === 'POST') result = await sdk.saveScenarioApiScenariosPost({ requestBody: body })
    else if (url.pathname === '/import/preview') result = await sdk.previewImportApiImportPreviewPost({ formData: { file: (options!.body as FormData).get('file') as File } })
    else if (url.pathname === '/import/confirm') result = await sdk.confirmImportApiImportConfirmPost({ requestBody: body })
    else if (url.pathname.startsWith('/import/jobs/')) result = await sdk.importStatusApiImportJobsJobIdGet({ jobId: url.pathname.split('/').at(-1)! })
    else if (url.pathname === '/ai/status') result = await sdk.aiStatusApiAiStatusGet()
    else if (url.pathname === '/ai/review-transactions' && method === 'POST') result = await sdk.reviewAiApiAiReviewTransactionsPost({ requestBody: body })
    else if (url.pathname === '/ai/review-all-transactions' && method === 'POST') result = await sdk.reviewAllAiApiAiReviewAllTransactionsPost()
    else if (url.pathname === '/ai/review-pending-transactions' && method === 'POST') result = await sdk.reviewPendingAiApiAiReviewPendingTransactionsPost()
    else if (url.pathname === '/ai/apply-transaction-categories' && method === 'POST') result = await sdk.applyAiCategoriesApiAiApplyTransactionCategoriesPost({ requestBody: body })
    else throw new Error(`未接入的 API: ${method} ${path}`)
    return result as T
  } catch (error) {
    if (error instanceof Error) throw new ApiError('status' in error ? Number(error.status) : 0, error.message)
    throw error
  }
}
