import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface DistributionChartProps {
  data: { name: string; value: number }[]
  color?: string
  height?: number
}

export default function DistributionChart({
  data,
  color = 'var(--color-accent)',
  height = 240,
}: DistributionChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
        <CartesianGrid stroke="rgba(93,83,73,0.12)" vertical={false} />
        <XAxis
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'rgba(93,83,73,0.7)', fontSize: 11 }}
        />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'rgba(93,83,73,0.7)', fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: 'rgba(186,91,42,0.05)' }}
          contentStyle={{
            borderRadius: 20,
            border: '1px solid rgba(93,83,73,0.14)',
            background: 'rgba(255,250,241,0.95)',
            boxShadow: '0 20px 40px rgba(72,53,39,0.12)',
          }}
        />
        <Bar dataKey="value" fill={color} radius={[10, 10, 4, 4]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  )
}
