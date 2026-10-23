import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import type { Transaction } from '../types'
import { transactionTypeLabel } from '../lib/format'
import { DateLabel, Money } from './business'
import { Badge, Button, State } from './ui'

export function TransactionTable({
  items,
  selected = [],
  onSelect,
  onDetail,
  onDelete,
}: {
  items: Transaction[]
  selected?: number[]
  onSelect?: (ids: number[]) => void
  onDetail: (item: Transaction) => void
  onDelete?: (item: Transaction) => void
}) {
  const columns: ColumnDef<Transaction>[] = [
    ...(onSelect ? [{
      id: 'select',
      header: '选择',
      cell: ({ row }: { row: { original: Transaction } }) => <input
        type="checkbox"
        aria-label={`选择账单 ${row.original.id}`}
        checked={selected.includes(row.original.id)}
        onChange={() => onSelect(selected.includes(row.original.id)
          ? selected.filter(id => id !== row.original.id)
          : [...selected, row.original.id])}
      />,
    } as ColumnDef<Transaction>] : []),
    { accessorKey: 'tx_date', header: '日期', cell: ({ row }) => <DateLabel value={row.original.tx_date}/> },
    { accessorKey: 'merchant', header: '商户', cell: ({ row }) => <button className="font-semibold hover:text-accent" onClick={() => onDetail(row.original)}>{row.original.merchant || row.original.description || '未命名账单'}</button> },
    { accessorKey: 'category', header: '分类', cell: ({ row }) => <Badge tone={row.original.category === '待确认' ? 'warning' : 'neutral'}>{row.original.category}</Badge> },
    { accessorKey: 'tx_type', header: '类型', cell: ({ row }) => transactionTypeLabel(row.original.tx_type) },
    { accessorKey: 'amount_cents', header: '金额', cell: ({ row }) => <Money cents={row.original.amount_cents} tone={row.original.tx_type === 'expense' ? 'negative' : 'positive'}/> },
    ...(onDelete ? [{
      id: 'actions',
      header: '操作',
      cell: ({ row }: { row: { original: Transaction } }) => <Button
        variant="ghost"
        className="h-8 px-2 text-danger hover:bg-red-50"
        onClick={() => onDelete(row.original)}
      >删除</Button>,
    } as ColumnDef<Transaction>] : []),
  ]
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() })
  return items.length ? <div className="overflow-x-auto"><table>
    <thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
    <tbody>{table.getRowModel().rows.map(row => <tr key={row.id} className="hover:bg-canvas">{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody>
  </table></div> : <State kind="empty"/>
}
