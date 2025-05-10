// lib/weatherApi.ts (Corrected again)
// In Next.js 13+, fetch is globally available on the server
// You do NOT need to import node-fetch here.
// const fetch = require('node-fetch'); // REMOVE THIS LINE

// Base URL for OpenMeteo API
const OPENMETEO_WEATHER_API_BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * Fetches current weather and 7-day daily forecast from OpenMeteo.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{current: any, daily: any[]} | undefined>} Fetched weather data or undefined on failure.
 */
export async function fetchWeatherFromApi(latitude: number, longitude: number): Promise<{ current: any; daily: any[]; } | undefined> {
    // Correctly construct URLSearchParams with repeated 'daily' keys using an array of key-value pairs
    const params = new URLSearchParams([
        ['latitude', latitude.toString()],
        ['longitude', longitude.toString()],
        ['current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code'], // 'current' takes a comma-separated list
        ['temperature_unit', 'celsius'],
        ['wind_speed_unit', 'kmh'],
        ['precipitation_unit', 'mm'],
        ['timezone', 'auto'],
        ['forecast_days', '7'],
        // Add each daily variable as a separate entry with the key 'daily'
        // REMOVE 'time' from this list
        ['daily', 'weather_code'],
        ['daily', 'temperature_2m_max'],
        ['daily', 'temperature_2m_min'],
        // ['daily', 'time'], // <-- REMOVE THIS SPECIFIC ENTRY
    ]);

    const url = `${OPENMETEO_WEATHER_API_BASE}?${params.toString()}`;
    console.log("Fetching OpenMeteo URL:", url); // Log the actual URL being fetched

    try {
        // Use the global fetch provided by Next.js
        const response = await fetch(url); // Use the global fetch
        // console.log(response)


        if (!response.ok) {
        console.error(`HTTP ${response.status}`);
        const errText = await response.text();
        console.error('Error body:', errText);
        return;
        }

        // Clone the response so you can read it twice
        const cloned = response.clone();
        const rawText = await cloned.text();
        // console.log('Raw API response:', rawText);


        const data = await response.json();
        const humidity = data.current.relative_humidity_2m;
        // console.log('Current humidity (%):', humidity);

         // Check for expected structure, including the 'time' array in daily
         if (!data || !data.current || !data.daily || !data.daily.time || !Array.isArray(data.daily.time)) {
             console.error("OpenMeteo API returned unexpected data structure or missing daily.time:", data);
             return undefined;
         }

         // console.log("Raw data from OpenMeteo:", JSON.stringify(data, null, 2)); // Optional: Log raw data

        // Map OpenMeteo data to a consistent format
        const current = {
            temperature: data.current.temperature_2m,
            wind_speed: data.current.wind_speed_10m,
            humidity: data.current.relative_humidity_2m,
            condition_code: data.current.weather_code, // WMO code
        };

        // Map daily data, using data.daily.time for the date
        const daily = data.daily.time.map((date: string, index: number) => ({
            date: date, // YYYY-MM-DD string from the provided time array
            max_temp: data.daily.temperature_2m_max[index],
            min_temp: data.daily.temperature_2m_min[index],
            condition_code: data.daily.weather_code[index], // WMO code
        }));

        return { current, daily };

    } catch (error) {
        console.error('Error fetching weather from OpenMeteo API:', error);
        return undefined; // Indicate failure
    }
}