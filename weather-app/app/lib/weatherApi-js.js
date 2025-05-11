// lib/weatherApi.js

// In Node.js 18+ `fetch` is global. If using older versions, you may need `node-fetch`.

const OPENMETEO_WEATHER_API_BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * @typedef {Object} CurrentWeather
 * @property {number} temperature   Current temperature (°C)
 * @property {number} wind_speed    Wind speed (km/h)
 * @property {number} humidity      Relative humidity (%)
 * @property {number} condition_code WMO weather code
 */

/**
 * @typedef {Object} DailyForecast
 * @property {string} date         YYYY-MM-DD
 * @property {number} max_temp     Maximum temperature (°C)
 * @property {number} min_temp     Minimum temperature (°C)
 * @property {number} condition_code WMO weather code
 */

/**
 * @typedef {Object} WeatherResponse
 * @property {CurrentWeather} current  Current weather data
 * @property {DailyForecast[]} daily   7-day forecast data
 */

/**
 * Fetches current + 7-day forecast from Open-Meteo
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<WeatherResponse|undefined>}
 */
async function fetchOpenMeteo(latitude, longitude) {
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

  const url = `${OPENMETEO_WEATHER_API_BASE}?${params}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error('[OpenMeteo] HTTP error:', res.status);
      return undefined;
    }
    const data = await res.json();

    const current = {
      temperature: data.current.temperature_2m,
      wind_speed: data.current.wind_speed_10m,
      humidity: data.current.relative_humidity_2m,
      condition_code: data.current.weather_code,
    };

    const daily = data.daily.time.map((date, i) => ({
      date,
      max_temp: data.daily.temperature_2m_max[i],
      min_temp: data.daily.temperature_2m_min[i],
      condition_code: data.daily.weather_code[i],
    }));

    return { current, daily };
  } catch (err) {
    console.error('[OpenMeteo] Fetch error:', err);
    return undefined;
  }
}

/**
 * Fetches current weather from MET Norway (instant values only)
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<CurrentWeather|undefined>}
 */
async function fetchMetNorway(latitude, longitude) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude}&lon=${longitude}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MyApp/1.0 you@example.com' }
    });
    if (!res.ok) {
      console.error('[MET Norway] HTTP error:', res.status);
      return undefined;
    }
    const data = await res.json();
    const details = data.properties.timeseries?.[0]?.data.instant.details;
    if (!details) {
      console.error('[MET Norway] Missing details');
      return undefined;
    }

    
    return {
      temperature: details.air_temperature,
      wind_speed: details.wind_speed,
      humidity: details.relative_humidity,
      condition_code: 0 // placeholder
    };
  } catch (err) {
    console.error('[MET Norway] Fetch error:', err);
    return undefined;
  }
}

/**
 * Averages two CurrentWeather objects
 * @param {CurrentWeather} a
 * @param {CurrentWeather} b
 * @returns {CurrentWeather}
 */
function averageCurrent(a, b) {
  return {
    temperature:   (a.temperature + b.temperature) / 2,
    wind_speed:    (a.wind_speed + b.wind_speed) / 2,
    humidity:      (a.humidity + b.humidity) / 2,
    condition_code: Math.round((a.condition_code + b.condition_code) / 2),
  };
}

/**
 * Fetches and aggregates weather:
 * - Averages current from Open-Meteo & MET Norway
 * - Returns Open-Meteo’s daily forecast
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<WeatherResponse|undefined>}
 */
async function fetchWeatherFromApi(latitude, longitude) {
  const [open, met] = await Promise.all([
    fetchOpenMeteo(latitude, longitude),
    fetchMetNorway(latitude, longitude)
  ]);
  if (!open) return undefined;
  if (!met) return open;

  const current = averageCurrent(open.current, met);
  return { current, daily: open.daily };
}

module.exports = { fetchWeatherFromApi };
