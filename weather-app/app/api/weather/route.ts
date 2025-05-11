// app/api/weather/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
// Assuming your fetchWeatherFromApi helper is in lib/weatherApi.ts
// Adjust the import path based on your actual file structure
import { fetchWeatherFromApi } from '../../lib/weatherApi';

// Instantiate PrismaClient outside the handler function for potential connection pooling
const prisma = new PrismaClient();

// Get WebSocket server port from environment variables
// Default to 3002 if WS_PORT is not set
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3002;
// URL for the internal HTTP endpoint on the WebSocket server to trigger broadcasts
const WS_BROADCAST_URL = `http://localhost:${WS_PORT}/broadcast`;

// Define cache duration for NON-TRACKED locations in minutes
// Data older than this will trigger a fetch from OpenMeteo
const NON_TRACKED_CACHE_DURATION_MINUTES = 15; // 15 minutes

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    // Get location name and coordinates from the frontend's query parameters
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const locationName = searchParams.get('location'); // Frontend sends this now

    // Declare finalLocationName here so it's accessible throughout the handler
    let finalLocationName = locationName;

    // Validate required parameters
    if (!lat || !lon) {
        console.error('Missing lat or lon parameter in /api/weather GET request');
        return NextResponse.json({ error: 'Missing lat or lon parameter' }, { status: 400 });
    }
     // The frontend is designed to always send the name, so require it here.
    if (!finalLocationName) {
         console.error('Missing location name parameter in /api/weather GET request');
         return NextResponse.json({ error: 'Missing location name parameter' }, { status: 400 });
    }

    // Parse latitude and longitude as numbers
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);

    // Validate parsed coordinates
    if (isNaN(latitude) || isNaN(longitude)) {
         console.error('Invalid lat or lon parameter in /api/weather GET request');
         return NextResponse.json({ error: 'Invalid lat or lon parameter' }, { status: 400 });
    }

    console.log(`Received request for weather for "${finalLocationName}" (${latitude}, ${longitude})...`);

    let weatherData = null; // Variable to hold the weather data that will be returned
    let weatherSource = 'unknown'; // For logging the data source (DB or API)
    let locationId = null; // To store the DB location ID

    try {
        // 1. Find the location by name to check tracking status and get ID
        // Use the *provided* name from the frontend (from DB lookup or Geocoding)
        const location = await prisma.location.findUnique({
            where: { name: finalLocationName },
            select: { id: true, name: true, latitude: true, longitude: true, isTracking: true }, // Get tracking status
        });

        // If location exists, store its ID. If not, it will be created later by upsert.
        if (location) {
             locationId = location.id;
        } else {
             console.log(`Location "${finalLocationName}" not found in DB initially. Will upsert.`);
        }


        if (location && location.isTracking) {
            // --- Scenario 1: Location is Found and is Tracked ---
            console.log(`Location "${finalLocationName}" is tracked. Attempting to fetch from DB.`);
            weatherSource = 'db_tracked';

            // Fetch data directly from DB for tracked locations
            // We assume the background tracker keeps this data fresh.
            const current = await prisma.currentWeather.findUnique({
                where: { locationId: location.id },
            });

            const daily = await prisma.dailyForecast.findMany({
                where: { locationId: location.id },
                orderBy: { date: 'asc' }, // Order by date
                take: 7, // Take up to 7 days
            });

            // Format the fetched DB data for returning to the frontend
            if (current && daily.length > 0) {
                 console.log(`Successfully fetched tracked data for "${finalLocationName}" from DB.`);
                 weatherData = {
                    temperature: current.temperature,
                    windSpeed: current.windSpeed,
                    humidity: current.humidity,
                    conditionCode: current.conditionCode,
                    updatedAt: current.fetchedAt, // Include the last updated timestamp
                    daily: daily.map(d => ({
                        // Add day name to match frontend expectation
                        day: new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
                        max: d.maxTemp,
                        min: d.minTemp,
                        weatherCode: d.conditionCode,
                    })),
                 };
                 // No API fetch or DB save/upsert needed here, assuming background tracker updates the DB
                 // No WS broadcast triggered by this DB read, as background tracker handles WS push when data *changes*
            } else {
                // This case should ideally not happen if the tracker is working and data was saved initially,
                // but handle it as a fallback.
                console.warn(`Tracked location "${finalLocationName}" found, but no data in DB. Falling back to API.`);
                weatherSource = 'api_fallback_tracked'; // Indicate it was a fallback
                 // Proceed to fetch from API and save, like the non-tracked flow.
                 // Ensure locationId is valid before calling fetchAndSaveWeather
                 if (!locationId) {
                      // This shouldn't happen if location was found, but double-check
                      throw new Error(`Location ID missing for tracked location "${finalLocationName}"`);
                 }
                 // Call the helper function to fetch from API, save to DB, and signal WS
                 weatherData = await fetchAndSaveWeather(finalLocationName, locationId, latitude, longitude);
            }

        } else {
             // --- Scenario 2: Location is NOT Tracked (or not in DB) ---
             console.log(`Location "${finalLocationName}" is not tracked (or not in DB initially). Checking DB freshness or fetching API.`);
             weatherSource = 'api_or_db_nontracked';

             // If location wasn't found initially, upsert it now based on the provided name/coords.
             // If it was found but not tracked, upsert does nothing to isTracking.
             if (!locationId) {
                  const createdLoc = await prisma.location.create({
                      data: { name: finalLocationName, latitude: latitude, longitude: longitude }
                  });
                  locationId = createdLoc.id;
                  console.log(`Created new location "${finalLocationName}" (ID: ${locationId}).`);
             } else {
                  // Update coords for existing non-tracked location in case they differ slightly (e.g., from geocoding)
                  await prisma.location.update({
                      where: { id: locationId },
                      data: { latitude: latitude, longitude: longitude }
                  });
                  console.log(`Updated coords for existing non-tracked location "${finalLocationName}" (ID: ${locationId}).`);
             }


             // Check DB freshness for non-tracked locations
             const current = await prisma.currentWeather.findUnique({
                 where: { locationId: locationId },
                 select: { fetchedAt: true } // Only need the timestamp
             });

             let isDataFresh = false;
             if (current) {
                  const fetchedAt = new Date();
                  const now = new Date();
                  const ageMinutes = (now.getTime() - fetchedAt.getTime()) / (1000 * 60);
                  isDataFresh = ageMinutes < NON_TRACKED_CACHE_DURATION_MINUTES;
                  console.log(`Data age for non-tracked "${finalLocationName}": ${ageMinutes.toFixed(1)} minutes. Fresh: ${isDataFresh}`);
             } else {
                 console.log(`No current data found for non-tracked "${finalLocationName}".`);
             }


             if (isDataFresh) {
                 console.log(`Data for non-tracked "${finalLocationName}" is fresh in DB. Serving from DB.`);
                  weatherSource = 'db_nontracked_fresh';
                 // Fetch full data from DB
                 const currentData = await prisma.currentWeather.findUnique({ where: { locationId: locationId! } }); // Use non-null assertion as locationId is guaranteed here
                 const dailyData = await prisma.dailyForecast.findMany({ where: { locationId: locationId! }, orderBy: { date: 'asc' }, take: 7 });

                 weatherData = {
                     temperature: currentData?.temperature,
                     windSpeed: currentData?.windSpeed,
                     humidity: currentData?.humidity,
                     conditionCode: currentData?.conditionCode,
                        updatedAt: currentData?.fetchedAt, // Include the last updated timestamp
                     
                     daily: dailyData.map(d => ({
                         day: new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
                         max: d.maxTemp,
                         min: d.minTemp,
                         weatherCode: d.conditionCode,
                     })),
                 };

             } else {
                 console.log(`Data for non-tracked "${finalLocationName}" is stale or missing. Fetching from API.`);
                 weatherSource = 'api_nontracked_stale';
                 // Call the helper function to fetch from API, save to DB, and signal WS
                 // locationId is guaranteed to be valid here
                 weatherData = await fetchAndSaveWeather(finalLocationName, locationId!, latitude, longitude); // Use non-null assertion
             }
        }

        // If weatherData is still null here, it means fetchAndSaveWeather failed (or DB fetch failed badly)
        if (!weatherData) {
             console.error(`Could not get weather data for "${finalLocationName}" via ${weatherSource}.`);
              return NextResponse.json({ error: `Could not retrieve weather data for ${finalLocationName}.` }, { status: 500 });
        }

        // 3. Return the data to the frontend, including the current tracking status
         // Re-fetch location to get the *latest* tracking status, in case it changed mid-request
         const finalLocation = await prisma.location.findUnique({
             where: { id: locationId! }, // locationId is guaranteed here
             select: { isTracking: true } // Get latest tracking status
         });

        const responseData = {
             ...weatherData, // Spread the current and daily data fetched/retrieved
             isTracking: finalLocation?.isTracking || false // Include tracking status in response
        };

        console.log(`Serving weather data for "${finalLocationName}" (Source: ${weatherSource}, isTracking: ${responseData.isTracking}).`);
        return NextResponse.json(responseData);

    } catch (error: any) {
        // This catch block handles errors during the initial location lookup,
        // or errors thrown by fetchAndSaveWeather (API fetch, DB save, WS signal).
        console.error(`Error in /api/weather handler for "${finalLocationName}":`, error);
        // Return a server error response
        return NextResponse.json({ error: 'Internal server error retrieving weather', details: error.message }, { status: 500 });
    } finally {
         // Optional: Disconnect prisma client if necessary
         // await prisma.$disconnect();
    }
}


// Helper function to handle API fetch, DB save/upsert, and WS signal
// This is called by the main GET handler when data is needed from OpenMeteo
async function fetchAndSaveWeather(locationName: string, locationId: number, latitude: number, longitude: number): Promise<any | undefined> {
     console.log(`[fetchAndSaveHelper] Starting API fetch & save for "${locationName}" (ID: ${locationId})...`);

     // --- Fetch from OpenMeteo API ---
     const apiData = await fetchWeatherFromApi(latitude, longitude);

     if (!apiData) {
         console.error(`[fetchAndSaveHelper] API fetch failed for "${locationName}".`);
         // Do NOT throw here, just return undefined so the caller can handle it
         return undefined;
     }

     console.log(`[fetchAndSaveHelper] Successfully fetched data from OpenMeteo for "${locationName}".`);

     // --- Save/Update data in DB and Trigger WS using a transaction ---
     try {
         await prisma.$transaction(async (tx) => {
              // Ensure location coords are up-to-date based on the coords used for this API fetch
              // This is important if coords slightly differ (e.g., from geocoding vs original DB entry)
              // Only update if locationId is valid
             await tx.location.update({
                 where: { id: locationId },
                 data: { latitude: latitude, longitude: longitude }
             });
             console.log(`[fetchAndSaveHelper] Updated location coords in DB for ID ${locationId}.`);


             // Save Current Weather (INSERT OR REPLACE logic via upsert on unique key: locationId)
             await tx.currentWeather.upsert({
                 where: { locationId: locationId },
                 update: {
                     temperature: apiData.current.temperature,
                     windSpeed: apiData.current.wind_speed,
                     // *** CORRECTED HUMIDITY KEY ***
                     humidity: apiData.current.humidity, // <-- MUST be relative_humidity_2m
                     conditionCode: apiData.current.condition_code,
                     fetchedAt: new Date(),
                 },
                 create: { // Should only be reached if locationId somehow existed without current data
                     locationId: locationId, // <-- Link to the location
                     temperature: apiData.current.temperature,
                     windSpeed: apiData.current.wind_speed,
                     // *** CORRECTED HUMIDITY KEY ***
                     humidity: apiData.current.humidity, // <-- MUST be relative_humidity_2m
                     conditionCode: apiData.current.condition_code,
                     fetchedAt: new Date(),
                 },
             });
             console.log(`[fetchAndSaveHelper] Upserted current weather for ID ${locationId}.`);


             // Save Daily Forecast
             // Delete old daily forecast entries for this location first
             await tx.dailyForecast.deleteMany({ where: { locationId: locationId } });
             console.log(`[fetchAndSaveHelper] Deleted old daily forecasts for ID ${locationId}.`);

             // Insert new forecast entries
              if (apiData.daily && Array.isArray(apiData.daily) && apiData.daily.length > 0) {
                 const dailyForecastData = apiData.daily.map((day: any) => ({
                     locationId: locationId, // <-- Link to the location
                     date: day.date, // YYYY-MM-DD string from API
                     maxTemp: day.max_temp,
                     minTemp: day.min_temp,
                     conditionCode: day.condition_code, // WMO code from API
                 }));
                 await tx.dailyForecast.createMany({ data: dailyForecastData, skipDuplicates: true });
                 console.log(`[fetchAndSaveHelper] Created ${dailyForecastData.length} new daily forecasts for ID ${locationId}.`);
              } else {
                  console.warn(`[fetchAndSaveHelper] No daily forecast data received from API for ID ${locationId}.`);
              }
         });

         console.log(`[fetchAndSaveHelper] Database transaction successful for "${locationName}".`);

         // 6. Trigger Real-time update broadcast via the separate WS server
         // This fetch call is outside the transaction, but its failure is caught by the helper's catch
         const currentWeatherDataForBroadcast = {
             temperature: apiData.current.temperature,
             windSpeed: apiData.current.wind_speed,
             // *** CORRECTED HUMIDITY KEY FOR BROADCAST ***
             humidity: apiData.current.relative_humidity_2m, // <-- Use correct key here for WS data
             conditionCode: apiData.current.condition_code,
             // Optionally include location name in broadcast data if WS server needs it for routing
             locationName: locationName,
         };
         // Ensure WS_BROADCAST_URL is correctly defined from WS_PORT (should be http://localhost:3002/broadcast)
         fetch(WS_BROADCAST_URL, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ location: locationName, data: currentWeatherDataForBroadcast }), // Send location name for WS server to route
         }).then(wsRes => {
             if (!wsRes.ok) {
                 // Log WS signal failure, but don't necessarily fail the entire weather fetch
                 console.error(`[fetchAndSaveHelper] Failed to signal WS server to broadcast: ${wsRes.status}`);
                 try { wsRes.text().then(text => console.error('WS Broadcast Error Body:', text)); } catch(e){}
             } else {
                  console.log(`[fetchAndSaveHelper] Successfully signaled WS server to broadcast for "${locationName}".`);
             }
         }).catch(wsErr => {
              // Log network error when signaling WS server
             console.error(`[fetchAndSaveHelper] Error communicating with WS server for broadcast for "${locationName}":`, wsErr);
         });


         // 7. Format the fetched API data for returning to the main GET handler
         // This format should match what the frontend expects
         const { fetchedAt }: any = await prisma.currentWeather.findUnique({
            where: { locationId },
            select: { fetchedAt: true }
            });

         const responseData = {
             temperature: apiData.current.temperature,
             updatedAt: fetchedAt, // Include the last updated timestamp
             windSpeed: apiData.current.wind_speed,
             // *** CORRECTED HUMIDITY KEY FOR RESPONSE ***
             humidity: apiData.current.relative_humidity_2m, // <-- Use correct key here for response data
             conditionCode: apiData.current.condition_code,
             daily: apiData.daily.map((d: any) => ({
                // Backend maps API date string to frontend day name
                day: new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }), // Add day name
                max: d.max_temp, // Map API key to frontend key
                min: d.min_temp, // Map API key to frontend key
                weatherCode: d.condition_code, // Map API key to frontend key (WMO)
                // Optionally include original date string if needed by frontend
                // date: d.date,
             })),
         };
         return responseData; // Return the formatted data


     } catch (dbOrWsError: any) {
         // Catch errors during DB transaction or the WS signal fetch call
         console.error(`[fetchAndSaveHelper] Database transaction or WS signal failed for "${locationName}":`, dbOrWsError);
          // Log the full error details from the catch block
         console.error('[fetchAndSaveHelper] Caught Error Details:', dbOrWsError);

         // IMPORTANT: Re-throw the error so the main GET handler's catch block can catch it
         // This ensures that the main handler knows the save/signal failed and logs it.
         throw dbOrWsError;

         // ALTERNATIVE: If you didn't re-throw, you would return undefined here,
         // and the main handler would need to check `if (!weatherData) ...`
         // return undefined;
     }
     // No finally block needed here, the main GET handler has a finally block for prisma disconnect
}