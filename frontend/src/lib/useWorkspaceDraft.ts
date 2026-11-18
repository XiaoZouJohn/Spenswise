import { usePersistentDraft } from './usePersistentDraft'

export function useWorkspaceDraft<T extends object>(name: string, initial: T) {
  const draft = usePersistentDraft('workspace', name, initial)
  return [draft.value, draft.change] as const
}
