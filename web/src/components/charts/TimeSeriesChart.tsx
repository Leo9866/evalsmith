import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface TimeSeriesChartProps {
  data: Array<{ name: string; [key: string]: string | number }>
  lines: Array<{ key: string; color: string; name?: string }>
  height?: number
  yFormatter?: (value: number) => string
}

export default function TimeSeriesChart({
  data,
  lines,
  height = 300,
  yFormatter,
}: TimeSeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
        <CartesianGrid stroke="rgba(93,83,73,0.12)" vertical={false} />
        <XAxis
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'rgba(93,83,73,0.7)', fontSize: 11 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'rgba(93,83,73,0.7)', fontSize: 11 }}
          tickFormatter={yFormatter}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 20,
            border: '1px solid rgba(93,83,73,0.14)',
            background: 'rgba(255,250,241,0.95)',
            boxShadow: '0 20px 40px rgba(72,53,39,0.12)',
          }}
        />
        {lines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.name ?? line.key}
            stroke={line.color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 5, fill: line.color }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
