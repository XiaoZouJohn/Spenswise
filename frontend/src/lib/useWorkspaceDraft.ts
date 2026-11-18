import { useEffect, useState, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from './session'

// Private in-memory drafts survive route changes and follow the session cache lifecycle.
export function useWorkspaceDraft<T>(name: string, initial: T) {
  const client = useQueryClient()
  const session = useSession()
  const owner = session.data?.user.id
  const [value, setValue] = useState<T>(() => client.getQueryData<T>(['workspace-draft', owner, name]) ?? initial)
  useEffect(() => { client.setQueryData(['workspace-draft', owner, name], value) }, [client, owner, name, value])
  const update = (next: SetStateAction<T>) => setValue(next)
  return [value, update] as const
}
