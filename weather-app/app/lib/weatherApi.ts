// lib/weatherApi.ts

// In Next.js 13+, fetch is globally available on the server
// You do NOT need to import node-fetch here.

const OPENMETEO_WEATHER_API_BASE = 'https://api.open-meteo.com/v1/forecast';

export type CurrentWeather = {
  temperature: number;
  wind_speed: number;
  humidity: number;
  condition_code: number;
};

export type DailyForecast = {
  date: string;            // YYYY-MM-DD
  max_temp: number;
  min_temp: number;
  condition_code: number;
};

export type WeatherResponse = {
  current: CurrentWeather;
  daily: DailyForecast[];
};

/**
 * Fetches weather from Open-Meteo: current + 7-day daily forecast
 */
async function fetchOpenMeteo(
  latitude: number,
  longitude: number
): Promise<WeatherResponse | undefined> {
  const params = new URLSearchParams([
    ['latitude', latitude.toString()],
    ['longitude', longitude.toString()],
    ['current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code'],
    ['temperature_unit', 'celsius'],
    ['wind_speed_unit', 'kmh'],
    ['precipitation_unit', 'mm'],
    ['timezone', 'auto'],
    ['forecast_days', '7'],
    ['daily', 'weather_code'],
    ['daily', 'temperature_2m_max'],
    ['daily', 'temperature_2m_min'],
  ]);

  const url = `${OPENMETEO_WEATHER_API_BASE}?${params.toString()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error('[OpenMeteo] HTTP error:', res.status);
      return undefined;
    }
    const data = await res.json();

    const current: CurrentWeather = {
      temperature: data.current.temperature_2m,
      wind_speed: data.current.wind_speed_10m,
      humidity: data.current.relative_humidity_2m,
      condition_code: data.current.weather_code,
    };

    const daily: DailyForecast[] = data.daily.time.map(
      (date: string, i: number) => ({
        date,
        max_temp: data.daily.temperature_2m_max[i],
        min_temp: data.daily.temperature_2m_min[i],
        condition_code: data.daily.weather_code[i],
      })
    );

    return { current, daily };
  } catch (err) {
    console.error('[OpenMeteo] Fetch error:', err);
    return undefined;
  }
}

/**
 * Fetches current weather from MET Norway API (instant details only)
 */
async function fetchMetNorway(
  latitude: number,
  longitude: number
): Promise<CurrentWeather | undefined> {
  const url =
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude}&lon=${longitude}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MyApp/1.0 you@example.com' },
    });
    if (!res.ok) {
      console.error('[MET Norway] HTTP error:', res.status);
      return undefined;
    }
    const data = await res.json();
    const details = data.properties.timeseries?.[0]?.data.instant.details;
    if (!details) {
      console.error('[MET Norway] Missing instant details');
      return undefined;
    }

    
    return {
      temperature: details.air_temperature,
      wind_speed: details.wind_speed,
      humidity: details.relative_humidity,
      condition_code: 0, // placeholder (MET uses symbol_code)
    };
  } catch (err) {
    console.error('[MET Norway] Fetch error:', err);
    return undefined;
  }
}

/**
 * Averages two CurrentWeather objects
 */
function averageCurrent(
  a: CurrentWeather,
  b: CurrentWeather
): CurrentWeather {
  return {
    temperature: (a.temperature + b.temperature) / 2,
    wind_speed: (a.wind_speed + b.wind_speed) / 2,
    humidity: (a.humidity + b.humidity) / 2,
    condition_code: Math.round(
      (a.condition_code + b.condition_code) / 2
    ),
  };
}

/**
 * Fetches and aggregates: current weather (averaged) + OpenMeteo daily forecast
 */
export async function fetchWeatherFromApi(
  latitude: number,
  longitude: number
): Promise<WeatherResponse | undefined> {
  const [open, met] = await Promise.all([
    fetchOpenMeteo(latitude, longitude),
    fetchMetNorway(latitude, longitude),
  ]);

  if (!open) return undefined;
  if (!met) {
    // only OpenMeteo available
    return open;
  }

  // average current, keep OpenMeteo daily
  const current = averageCurrent(open.current, met);
  return { current, daily: open.daily };
}
