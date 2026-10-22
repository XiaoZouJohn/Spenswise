import * as sdk from '../client/generated/sdk.gen'
import { OpenAPI } from '../client/generated/core/OpenAPI'
import { ApiError as GeneratedApiError } from '../client/generated/core/ApiError'
import type {
  AssetSnapshotIn, AssetSnapshotOut, FamilyBudgetIn, FamilyBudgetOut,
  FamilyDashboardOut, FamilyGoalIn, FamilyGoalOut, FamilyProposalIn,
  FamilyProposalOut, FamilySummary as GeneratedFamilySummary, InvitationPreviewOut,
  MemberOut, ProposalPreviewIn, ProposalPreviewOut, SessionOut, SharingIn,
  UserOut,
} from '../client/generated/types.gen'

OpenAPI.BASE = import.meta.env.VITE_API_URL || ''
OpenAPI.WITH_CREDENTIALS = true
OpenAPI.CREDENTIALS = 'include'

export { ApiError as FamilyApiError } from '../client/generated/core/ApiError'
export type User = UserOut
export type FamilySummary = GeneratedFamilySummary
export type Session = SessionOut
export type Sharing = SharingIn
export type Member = MemberOut
export type AccountSnapshot = AssetSnapshotOut
export type FamilyGoal = FamilyGoalOut
export type FamilyProposal = FamilyProposalOut
export type FamilyBudget = FamilyBudgetOut
export type FamilyDashboard = FamilyDashboardOut
export type ProposalPreview = ProposalPreviewOut
export type InvitationPreview = InvitationPreviewOut

export function familyErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (error instanceof GeneratedApiError) {
    const detail = (error.body as { detail?: unknown } | null)?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const message = (detail as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
    if (error.status === 401) return '登录已失效，请重新登录'
    if (error.status === 403) return '没有权限执行此操作'
    if (error.status === 404) return '相关内容不存在或已失效'
    if (error.status === 410) return '邀请码已过期'
    if (error.status === 422) return '请检查填写内容与金额限制'
    return fallback
  }
  return error instanceof Error ? error.message : fallback
}
type TransactionFilters = {
  user_id?: number; category?: string; date_from?: string; date_to?: string;
  ids?: string; common_only?: boolean; page?: number; page_size?: number
}

export const familyApi = {
  me: () => sdk.meApiAuthMeGet(),
  register: (data: { email: string; password: string; display_name: string }) => sdk.registerApiAuthRegisterPost({ requestBody: data }),
  login: (data: { email: string; password: string }) => sdk.loginApiAuthLoginPost({ requestBody: data }),
  logout: () => sdk.logoutApiAuthLogoutPost(),
  claimLegacy: (code: string) => sdk.claimLegacyApiAuthClaimLegacyPost({ requestBody: { code } }),
  updateMe: (display_name: string) => sdk.updateProfileApiUsersMePut({ requestBody: { display_name } }),
  changePassword: (current_password: string, new_password: string) => sdk.changePasswordApiUsersMePasswordPost({ requestBody: { current_password, new_password } }),
  deleteAccount: (password: string) => sdk.deleteMyAccountApiUsersMeDelete({ requestBody: { password } }),
  sessions: () => sdk.sessionsApiAuthSessionsGet(),
  revokeSession: (sessionId: string) => sdk.revokeSessionApiAuthSessionsSessionIdDelete({ sessionId }),
  exportData: () => sdk.exportMyDataApiUsersMeExportGet(),

  assets: () => sdk.assetsApiUsersMeAssetsGet(),
  saveAsset: (data: AssetSnapshotIn) => sdk.createAssetApiUsersMeAssetsPost({ requestBody: data }),
  assetCoverage: () => sdk.assetCoverageApiUsersMeAssetsCoverageGet(),
  updateAssetCoverage: (confirmed: boolean) => sdk.setAssetCoverageApiUsersMeAssetsCoveragePut({ requestBody: { confirmed } }),
  assetCoveragePolicy: () => sdk.getAssetCoveragePolicyApiUsersMeAssetsCoveragePolicyGet(),
  updateAssetCoveragePolicy: (valid_days: number) => sdk.putAssetCoveragePolicyApiUsersMeAssetsCoveragePolicyPut({ requestBody: { valid_days } }),
  archiveAsset: (accountKey: string) => sdk.archiveAssetApiUsersMeAssetsAccountKeyArchivePost({ accountKey }),

  currentFamily: () => sdk.getFamilyApiFamiliesGet(),
  createFamily: (name: string) => sdk.createFamilyApiFamiliesPost({ requestBody: { name } }),
  members: () => sdk.getMembersApiFamiliesMembersGet(),
  invite: (email?: string) => sdk.createInvitationApiFamiliesInvitationsPost({ requestBody: email ? { email } : {} }),
  previewInvitation: (code: string) => sdk.previewInvitationApiFamiliesInvitationsPreviewGet({ code }),
  acceptInvite: (code: string, sharing: SharingIn) => sdk.acceptInvitationApiFamiliesInvitationsAcceptPost({ requestBody: { code, ...sharing } }),
  sharing: () => sdk.getSharingApiFamiliesSharingGet(),
  updateSharing: (sharing: SharingIn) => sdk.putSharingApiFamiliesSharingPut({ requestBody: sharing }),
  leaveFamily: () => sdk.leaveApiFamiliesLeavePost(),
  removeMember: (userId: number) => sdk.removeMemberApiFamiliesMembersUserIdDelete({ userId }),
  transferLeader: (userId: number) => sdk.transferApiFamiliesTransferPost({ requestBody: { user_id: userId } }),
  dissolveFamily: () => sdk.dissolveApiFamiliesDelete(),

  dashboard: (asOf?: string) => sdk.dashboardApiFamiliesDashboardGet({ asOf }),
  transactions: (params: TransactionFilters) => sdk.transactionsApiFamiliesTransactionsGet({
    userId: params.user_id, category: params.category, dateFrom: params.date_from,
    dateTo: params.date_to, ids: params.ids, commonOnly: params.common_only,
    page: params.page, pageSize: params.page_size,
  }),
  shareTransaction: (id: number, shared: boolean) => sdk.setSharedApiTransactionsTransactionIdFamilySharingPatch({ transactionId: id, requestBody: { shared } }),
  internalTransaction: (id: number, internal: boolean) => sdk.setInternalApiTransactionsTransactionIdFamilyInternalPatch({ transactionId: id, requestBody: { internal } }),

  budget: () => sdk.getBudgetApiFamiliesBudgetGet(),
  updateBudget: (data: FamilyBudgetIn) => sdk.putBudgetApiFamiliesBudgetPut({ requestBody: data }),
  proposals: () => sdk.proposalsApiFamiliesProposalsGet(),
  createProposal: (data: FamilyProposalIn) => sdk.createProposalApiFamiliesProposalsPost({ requestBody: data }),
  previewProposal: (data: ProposalPreviewIn) => sdk.previewProposalApiFamiliesProposalsPreviewPost({ requestBody: data }),
  decideProposal: (id: number, decision: 'approved' | 'returned') => sdk.decideProposalApiFamiliesProposalsProposalIdConfirmPost({ proposalId: id, requestBody: { decision } }),
  commentProposal: (id: number, content: string) => sdk.commentProposalApiFamiliesProposalsProposalIdCommentsPost({ proposalId: id, requestBody: { content } }),
  linkProposal: (id: number, transaction_id: number) => sdk.linkTransactionApiFamiliesProposalsProposalIdLinkTransactionPost({ proposalId: id, requestBody: { transaction_id } }),
  unlinkProposal: (id: number) => sdk.unlinkTransactionApiFamiliesProposalsProposalIdLinkTransactionDelete({ proposalId: id }),
  goals: () => sdk.goalsApiFamiliesGoalsGet(),
  createGoal: (data: FamilyGoalIn) => sdk.createGoalApiFamiliesGoalsPost({ requestBody: data }),
  updateGoal: (id: number, data: FamilyGoalIn) => sdk.updateGoalApiFamiliesGoalsGoalIdPut({ goalId: id, requestBody: data }),
}
