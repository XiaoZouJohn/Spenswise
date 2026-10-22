import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

export function Chart({ option, height = 300, onClick }: { option: echarts.EChartsOption; height?: number; onClick?: (params: echarts.ECElementEvent) => void }) { const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (!ref.current) return; const chart = echarts.init(ref.current); chart.setOption(option); if (onClick) chart.on('click', onClick); const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current); return () => { observer.disconnect(); chart.dispose() } }, [option, onClick]); return <div ref={ref} style={{ height, width: '100%' }} role="img" aria-label="财务趋势图"/> }
