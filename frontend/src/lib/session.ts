import { useQuery } from '@tanstack/react-query'
import { FamilyApiError, familyApi } from './familyApi'

export function useSession() { return useQuery({ queryKey: ['session'], queryFn: async () => { try { return await familyApi.me() } catch (error) { if (error instanceof FamilyApiError && error.status === 401) return null; throw error } }, retry: false }) }
