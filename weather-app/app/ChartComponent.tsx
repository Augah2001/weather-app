// app/components/ChartComponent.tsx

'use client';
import { FC } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts';

type ForecastDay = {
  day: string;
  max: number;
  min: number;
  weatherCode?: string | number;
};

type ChartProps = {
  data: ForecastDay[];
  visible: boolean;
};

const ChartComponent: FC<ChartProps> = ({ data, visible }) => {
  if (!visible || data.length === 0) return null;

  return (
    <div className="mt-6 p-4 bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-lg">
      <h3 className="text-white font-semibold mb-2 text-center">7-Day Temperature Trend</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="day" stroke="#ffffff" tick={{ fill: '#ffffff' }} />
          <YAxis stroke="#ffffff" tick={{ fill: '#ffffff' }} />
          
          {/* Built-in legend */}
          <Legend
            verticalAlign="top"
            align="center"
            wrapperStyle={{ color: '#ffffff', paddingBottom: 10 }}
          />

          <Tooltip
            contentStyle={{ backgroundColor: '#2d2d2d', border: 'none', borderRadius: '4px' }}
            labelStyle={{ color: '#ffffff' }}
            itemStyle={{ color: '#ffffff' }}
          />

          <Line
            type="monotone"
            dataKey="max"
            name="Max Temp"
            stroke="#eb3434"
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="min"
            name="Min Temp"
            stroke="#346eeb"
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ChartComponent;
