// fetchWeatherFromApi.js
// This script contains a function to fetch weather data from the OpenMeteo API.

// In Node.js, 'fetch' is globally available in recent versions (Node 18+).
// If you are using an older Node.js version, you might need to install and require 'node-fetch'.
// const fetch = require('node-fetch'); // Uncomment this line if using older Node.js

// Base URL for OpenMeteo Forecast API
const OPENMETEO_WEATHER_API_BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * Fetches current weather and 7-day daily forecast from OpenMeteo.
 * Handles API parameter construction and basic error checking.
 * Maps relevant API response keys to simpler keys.
 * @param {number} latitude - The latitude of the location.
 * @param {number} longitude - The longitude of the location.
 * @returns {Promise<object | undefined>} Fetched weather data in a mapped format or undefined on failure.
 */
async function fetchWeatherFromApi(latitude, longitude) {
    // Construct URLSearchParams using an array of key-value pairs to handle repeated 'daily' keys correctly
    const params = new URLSearchParams([
        ['latitude', latitude.toString()], // Convert numbers to strings for URL params
        ['longitude', longitude.toString()], // Convert numbers to strings for URL params
        // Request current weather variables as a comma-separated list
        ['current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code'],
        // Specify units
        ['temperature_unit', 'celsius'],
        ['wind_speed_unit', 'kmh'],
        ['precipitation_unit', 'mm'],
        // Set timezone to auto-detect based on coordinates
        ['timezone', 'auto'],
        // Request 7 days of forecast
        ['forecast_days', '7'],
        // Add each required daily variable as a separate 'daily' parameter
        // Note: Do NOT request 'time' here; the API includes it automatically with other daily variables.
        ['daily', 'weather_code'], // WMO Weather interpretation code
        ['daily', 'temperature_2m_max'], // Maximum daily temperature
        ['daily', 'temperature_2m_min'], // Minimum daily temperature
    ]);

    // Construct the full API URL
    const url = `${OPENMETEO_WEATHER_API_BASE}?${params.toString()}`;
    console.log("[fetchWeatherFromApi] Fetching OpenMeteo URL:", url); // Log the actual URL being fetched

    try {
        // Use the global fetch provided by Node.js (Node 18+)
        const response = await fetch(url);

        // Check if the HTTP response status is OK (200-299)
        if (!response.ok) {
            console.error(`[fetchWeatherFromApi] OpenMeteo API HTTP error! status: ${response.status}`);
             try {
                // Attempt to read the error body from the API response
                const errorBody = await response.text();
                console.error('[fetchWeatherFromApi] OpenMeteo API Error Body:', errorBody);
            } catch (e) {
                 console.error('[fetchWeatherFromApi] Could not read OpenMeteo error body:', e);
            }
            return undefined; // Indicate failure to the caller
        }

        // Parse the JSON response from the API
        const data = await response.json();
        // console.log(data)

         // Perform basic validation on the received data structure
         // Check if expected top-level keys and essential daily data (like time) are present
         if (!data || !data.current || !data.daily || !data.daily.time || !Array.isArray(data.daily.time)) {
             console.error("[fetchWeatherFromApi] OpenMeteo API returned unexpected data structure or missing daily.time:", data);
             return undefined; // Indicate invalid data received
         }

         // Optional: Log the raw data received from OpenMeteo (can be verbose)
         // console.log("[fetchWeatherFromApi] Raw data from OpenMeteo:", JSON.stringify(data, null, 2));


        // Map relevant API data keys to a consistent, simpler format for internal use
        const current = {
            temperature: data.current.temperature_2m,
            wind_speed: data.current.wind_speed_10m,
            humidity: data.current.relative_humidity_2m, // <-- Mapping humidity to correct key
            condition_code: data.current.weather_code, // WMO code
        };

        // Map daily forecast data. OpenMeteo provides daily variables as parallel arrays indexed by 'time'.
        const daily = data.daily.time.map((date, index) => ({
            date: date, // YYYY-MM-DD string provided in data.daily.time array
            max_temp: data.daily.temperature_2m_max[index], // Access max temp using the same index
            min_temp: data.daily.temperature_2m_min[index], // Access min temp using the same index
            condition_code: data.daily.weather_code[index], // Access WMO code using the same index
        }));

        // Return the mapped current and daily data
        // console.log("[fetchWeatherFromApi] Mapped weather data:", { current, daily });
        return { current, daily };

    } catch (error) {
        // Catch any network errors or issues during JSON parsing
        console.error('[fetchWeatherFromApi] Error fetching weather from OpenMeteo API:', error);
        return undefined; // Indicate failure
    }
    // No finally block needed here; cleanup handled by the caller
}

// Export the function using CommonJS module syntax so it can be required by wsServer.js
module.exports = {
    fetchWeatherFromApi
};
