import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

export function Chart({ option, height = 300, onClick, label = '财务趋势图' }: {
  option: echarts.EChartsOption; height?: number; onClick?: (params: echarts.ECElementEvent) => void; label?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chart.setOption({ textStyle: { fontSize: 12 }, ...option, animationDuration: 400, animation: !matchMedia('(prefers-reduced-motion: reduce)').matches, aria: { enabled: true, label: { description: label } } })
    if (onClick) chart.on('click', onClick)
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(ref.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [option, onClick, label])
  return <div ref={ref} style={{ height, width: '100%' }} role="img" aria-label={label}/>
}
