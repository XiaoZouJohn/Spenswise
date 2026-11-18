import { useState } from 'react'
import { Badge, Button, DetailDialog, FormField, Input, Textarea } from '../ui'
import { Illustration, illustrationNames } from './Illustration'
import { StoryMetrics } from './StoryParts'

const swatches = ['paper', 'paper-deep', 'forest', 'forest-light', 'gold', 'terracotta', 'water', 'ink']

export function VillageDesignSystem() {
  const [drawer, setDrawer] = useState(false)
  return <section className="village-design-system" aria-label="富贵村设计系统">
    <h1>富贵村 · 设计系统</h1>
    <p>界面与组件</p>
    <div className="design-swatches">{swatches.map(name => <figure key={name}>
      <i style={{ background: `var(--${name})` }}/><figcaption>{name}</figcaption>
    </figure>)}</div>
    <div className="design-art-row">{illustrationNames.map(name => <Illustration key={name} name={name}/>)}</div>
    <h2>操作与状态</h2>
    <div className="design-controls"><Button>保存修改</Button><Button variant="secondary">核对账单</Button><Button variant="ghost">返回</Button><Button variant="danger">删除记录</Button><Button disabled>正在保存</Button></div>
    <div className="design-controls"><Badge tone="success">已保存</Badge><Badge tone="warning">待审核</Badge><Badge tone="danger">保存失败</Badge><Badge>数据不完整</Badge></div>
    <div className="design-controls">
      <FormField label="账户名称" htmlFor="design-name"><Input id="design-name" placeholder="填写账户名称"/></FormField>
      <FormField label="输入错误" htmlFor="design-error" hint="请填写一个有效金额"><Input id="design-error" aria-invalid="true" value="" readOnly/></FormField>
      <FormField label="禁用状态" htmlFor="design-disabled"><Input id="design-disabled" value="读取中" disabled readOnly/></FormField>
    </div>
    <FormField label="补充说明" htmlFor="design-note"><Textarea id="design-note" placeholder="补充与本次操作相关的信息"/></FormField>
    <h2>Story 金额摘要</h2>
    <StoryMetrics income={111500} expense={18682} surplus={92818}/>
    <p>以上金额只展示组件排版。</p>
    <Button variant="secondary" onClick={() => setDrawer(true)}>查看详情抽屉</Button>
    <DetailDialog title="账户详情" open={drawer} onOpenChange={setDrawer}>
      <p>抽屉沿用 Radix 的焦点管理、键盘关闭与焦点返回。</p>
      <FormField label="名称" htmlFor="drawer-name"><Input id="drawer-name" placeholder="账户名称"/></FormField>
    </DetailDialog>
  </section>
}
