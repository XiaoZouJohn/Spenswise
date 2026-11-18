import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Illustration } from './Illustration'
import type { Source } from '../../lib/lifeApi'

export function Paper({ title, children }: { title: string; children: ReactNode }) {
  return <section className="life-paper"><h2>{title}</h2>{children}</section>
}
export function SourceLink({ source }: { source: Source }) {
  return source.deleted ? <span className="source-tag is-deleted">{source.label || '来源已删除'}</span>
    : <Link className="source-tag" to={source.href}>{source.label || '查看来源'} ↗</Link>
}
export function CharacterHint({ text }: { text: string }) {
  return <div className="character-hint"><Illustration name="merchant"/><p>{text}</p></div>
}
export function DraftStatus({ status, retry, reload }: { status: string; retry: () => unknown; reload?: () => unknown }) {
  return <div className="draft-status" role="status"><span>{status}</span>{/失败|冲突/.test(status) && <><button onClick={() => retry()}>重试同步</button>{reload && <button onClick={() => reload()}>读取服务端草稿</button>}</>}</div>
}
