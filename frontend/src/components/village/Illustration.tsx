import type { CSSProperties } from 'react'
import { villageMedia } from '../../lib/villageMedia'

export const illustrationNames = [
  'ledger', 'bank', 'market', 'hall',
  'income', 'expense', 'surplus', 'insight',
  'merchant', 'sprig', 'botanical', 'village',
] as const
export type IllustrationName = typeof illustrationNames[number]

export function Illustration({ name, className = '' }: { name: IllustrationName; className?: string }) {
  const index = illustrationNames.indexOf(name)
  const style: CSSProperties = {
    backgroundImage: `url('${villageMedia().illustration}')`,
    backgroundPosition: `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 50}%`,
  }
  return <span aria-hidden="true" className={`village-illustration ${className}`} style={style}/>
}
