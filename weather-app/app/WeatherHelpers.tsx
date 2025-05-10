import { ReactNode } from 'react';
import { Sun, Cloud, Droplet, Wind } from 'lucide-react';

export const weatherCodeMap: Record<string, string> = {
  '0': 'Clear sky',
  '1': 'Mostly clear',
  '2': 'Partly cloudy',
  '3': 'Overcast',
  '45': 'Fog',
  '48': 'Depositing rime fog',
  '51': 'Drizzle: Light',
  '53': 'Drizzle: Moderate',
  '55': 'Drizzle: Dense intensity',
  '56': 'Freezing Drizzle: Light',
  '57': 'Freezing Drizzle: Dense intensity',
  '61': 'Rain: Light',
  '63': 'Rain: Moderate',
  '65': 'Rain: Heavy intensity',
  '66': 'Freezing Rain: Light',
  '67': 'Freezing Rain: Heavy intensity',
  '71': 'Snow fall: Slight',
  '73': 'Snow fall: Moderate',
  '75': 'Snow fall: Heavy intensity',
  '77': 'Snow grains',
  '80': 'Rain showers: Slight',
  '81': 'Rain showers: Moderate',
  '82': 'Rain showers: Violent',
  '85': 'Snow showers: Slight',
  '86': 'Snow showers: Heavy',
  '95': 'Thunderstorm: Slight or moderate',
  '96': 'Thunderstorm with slight hail',
  '99': 'Thunderstorm with heavy hail',
};

export function getWeatherIcon(code: string): ReactNode {
  const codeNum = parseInt(code, 10);
  if ([0, 1].includes(codeNum)) return <Sun className="w-6 h-6 text-white" />;
  if ([2, 3].includes(codeNum)) return <Cloud className="w-6 h-6 text-white" />;
  if ([45, 48].includes(codeNum)) return <Cloud className="w-6 h-6 text-white" />;
  if (codeNum >= 51 && codeNum <= 67) return <Droplet className="w-6 h-6 text-white" />;
  if (codeNum >= 71 && codeNum <= 77) return <Cloud className="w-6 h-6 text-white" />;
  if (codeNum >= 80 && codeNum <= 82) return <Droplet className="w-6 h-6 text-white" />;
  if (codeNum >= 85 && codeNum <= 86) return <Cloud className="w-6 h-6 text-white" />;
  if (codeNum >= 95) return <Cloud className="w-6 h-6 text-white" />;
  return <Sun className="w-6 h-6 text-white" />;
}