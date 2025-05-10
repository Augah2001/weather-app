// app/api/weather/route.ts (MODIFIED AGAIN FOR TRACKING LOGIC)
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { fetchWeatherFromApi } from '../../lib/weatherApi'; // Adjust path if necessary

const prisma = new PrismaClient();

// Get WebSocket server port from environment variables
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3002;
const WS_BROADCAST_URL = `http://localhost:${WS_PORT}/broadcast`; // URL for the internal broadcast endpoint

// Define cache duration for NON-TRACKED locations
const NON_TRACKED_CACHE_DURATION_MINUTES = 15;

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    // Expect lat, lon, and the location name from the frontend
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const locationName = searchParams.get('location'); // Frontend sends this now

    let finalLocationName = locationName; // Declare here

    if (!lat || !lon) {
        return NextResponse.json({ error: 'Missing lat or lon parameter' }, { status: 400 });
    }
    // Add check for locationName here as well, as per the new frontend logic
    if (!finalLocationName) {
         console.error('Missing location name parameter in /api/weather GET request');
         return NextResponse.json({ error: 'Missing location name parameter' }, { status: 400 });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);

    if (isNaN(latitude) || isNaN(longitude)) {
         return NextResponse.json({ error: 'Invalid lat or lon parameter' }, { status: 400 });
    }

    console.log(`Received request for weather for "${finalLocationName}" (${latitude}, ${longitude})...`);

    try {
        // 1. Find the location by name to check tracking status
        // Use the *provided* name from the frontend, which came from DB lookup or Geocoding
        const location = await prisma.location.findUnique({
            where: { name: finalLocationName },
            select: { id: true, name: true, latitude: true, longitude: true, isTracking: true },
        });

        let weatherData = null; // Data to return to frontend
        let weatherSource = 'unknown'; // For logging
        let locationId = location?.id; // Get ID if location exists

        if (location && location.isTracking) {
            // --- Scenario 1: Location is Tracked ---
            console.log(`Location "${finalLocationName}" is tracked. Attempting to fetch from DB.`);
            weatherSource = 'db_tracked';

            // Fetch data directly from DB for tracked locations
            const current = await prisma.currentWeather.findUnique({
                where: { locationId: location.id },
            });
            

            const daily = await prisma.dailyForecast.findMany({
                where: { locationId: location.id },
                orderBy: { date: 'asc' },
                take: 7,
            });

            if (current && daily.length > 0) {
                 console.log(`Successfully fetched tracked data for "${finalLocationName}" from DB.`);
                // Format data for frontend
                 weatherData = {
                    temperature: current.temperature,
                    windSpeed: current.windSpeed,
                    humidity: current.humidity,
                    conditionCode: current.conditionCode,
                    daily: daily.map(d => ({
                        day: new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
                        max: d.maxTemp,
                        min: d.minTemp,
                        weatherCode: d.conditionCode,
                    })),
                 };
                 // No API fetch or DB save/upsert needed here, assuming background tracker updates the DB
                 // No WS broadcast triggered by this DB read, as background tracker handles WS push when data *changes*
            } else {
                // This case should ideally not happen if the tracker is working, but handle it
                console.warn(`Tracked location "${finalLocationName}" found, but no data in DB. Falling back to API.`);
                weatherSource = 'api_fallback_tracked'; // Indicate it was a fallback
                 // Proceed to fetch from API and save, like the non-tracked flow
                 // Need to ensure locationId is available if we proceed to upsert
                 if (!locationId) {
                      // Should not happen if location was found, but safety check
                     const foundOrCreatedLoc = await prisma.location.upsert({
                         where: { name: finalLocationName! },
                         update: { latitude: latitude, longitude: longitude },
                         create: { name: finalLocationName!, latitude: latitude, longitude: longitude },
                     });
                     locationId = foundOrCreatedLoc.id;
                 }
                 weatherData = await fetchAndSaveWeather(finalLocationName, locationId, latitude, longitude);
            }

        } else {
             // --- Scenario 2: Location Not Tracked (or not in DB) ---
             console.log(`Location "${finalLocationName}" not tracked (or not in DB). Checking DB freshness or fetching API.`);
             weatherSource = 'api_or_db_nontracked';

             // First, ensure the location exists in DB (if not already)
             // If location exists but is not tracked, upsert won't change tracking status
             const foundOrCreatedLoc = await prisma.location.upsert({
                 where: { name: finalLocationName! }, // Use non-null assertion
                 update: { latitude: latitude, longitude: longitude }, // Update coords if name exists
                 create: { name: finalLocationName!, latitude: latitude, longitude: longitude }, // Create if name doesn't exist
             });
             locationId = foundOrCreatedLoc.id;

             // Check DB freshness for non-tracked locations
             const current = await prisma.currentWeather.findUnique({
                 where: { locationId: locationId },
                 select: { fetchedAt: true }
             });

             let isDataFresh = false;
             if (current) {
                  const fetchedAt = new Date(current.fetchedAt);
                  const now = new Date();
                  const ageMinutes = (now.getTime() - fetchedAt.getTime()) / (1000 * 60);
                  isDataFresh = ageMinutes < NON_TRACKED_CACHE_DURATION_MINUTES;
             }

             if (isDataFresh) {
                 console.log(`Data for non-tracked "${finalLocationName}" is fresh in DB. Serving from DB.`);
                  weatherSource = 'db_nontracked_fresh';
                 // Fetch full data from DB
                 const currentData = await prisma.currentWeather.findUnique({ where: { locationId: locationId } });
                 const dailyData = await prisma.dailyForecast.findMany({ where: { locationId: locationId }, orderBy: { date: 'asc' }, take: 7 });

                 weatherData = {
                     temperature: currentData?.temperature,
                     windSpeed: currentData?.windSpeed,
                     humidity: 1,
                     conditionCode: currentData?.conditionCode,
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
                 // Fetch from API and save
                 weatherData = await fetchAndSaveWeather(finalLocationName, locationId, latitude, longitude);
             }
        }

        // If weatherData is still null here, something went wrong
        if (!weatherData) {
             console.error(`Could not get weather data for "${finalLocationName}" via ${weatherSource}.`);
              return NextResponse.json({ error: `Could not retrieve weather data for ${finalLocationName}.` }, { status: 500 });
        }

        // 3. Return the data, including tracking status
         const finalLocation = await prisma.location.findUnique({
             where: { id: locationId! },
             select: { isTracking: true } // Get latest tracking status
         });

        const responseData = {
             ...weatherData, // Spread the current and daily data
             isTracking: finalLocation?.isTracking || false // Include tracking status in response
        };

        console.log(`Serving weather data for "${finalLocationName}" (Source: ${weatherSource}, isTracking: ${responseData.isTracking}).`);
        return NextResponse.json(responseData);

    } catch (error: any) {
        // This catch block handles errors during initial location lookup or fetchAndSaveWeather call itself
        console.error(`Error in /api/weather handler for "${finalLocationName}"`, error);
        // Decide what to return on a primary error - maybe last known data if available?
        // For now, return a server error
        return NextResponse.json({ error: 'Internal server error retrieving weather', details: error.message }, { status: 500 });
    } finally {
         // Disconnect prisma client if necessary
         // await prisma.$disconnect();
    }
}


// Helper function to handle API fetch, DB save/upsert, and WS signal
// Called by /api/weather when data needs to be fetched from OpenMeteo
// app/api/weather/route.ts (The fetchAndSaveWeather helper function)

// ... (code above, including the main GET handler)

// Helper function to handle API fetch, DB save/upsert, and WS signal
// Called by /api/weather when data needs to be fetched from OpenMeteo
async function fetchAndSaveWeather(locationName: string, locationId: number, latitude: number, longitude: number): Promise<any | undefined> {
     console.log(`[fetchAndSaveHelper] Fetching from API for "${locationName}" (${latitude}, ${longitude})...`);

     const apiData = await fetchWeatherFromApi(latitude, longitude);
    

     if (!apiData) {
         console.error(`[fetchAndSaveHelper] API fetch failed for "${locationName}".`);
         return undefined; // Indicate failure
     }

     try {
         await prisma.$transaction(async (tx) => {
              // Ensure location coords are up-to-date based on the coords used for API fetch
              // This is important if coords slightly differ (e.g., from geocoding vs original DB entry)
             await tx.location.update({
                 where: { id: locationId },
                 data: { latitude: latitude, longitude: longitude }
             });

             // Save Current Weather
             await tx.currentWeather.upsert({
                 where: { locationId: locationId },
                 update: {
                     temperature: apiData.current.temperature,
                     windSpeed: apiData.current.wind_speed,
                     // *** THIS IS THE LINE THAT NEEDS TO BE CORRECTED ***
                     humidity: apiData.current.humidity, // <-- MUST be relative_humidity_2m
                     conditionCode: apiData.current.condition_code,
                     fetchedAt: new Date(),
                 },
                 create: { // Should only be reached if locationId somehow existed without current data
                     locationId: locationId,
                     temperature: apiData.current.temperature,
                     windSpeed: apiData.current.wind_speed,
                     // *** THIS LINE ALSO NEEDS TO BE CORRECTED ***
                     humidity: apiData.current.humidity, // <-- MUST be relative_humidity_2m
                     conditionCode: apiData.current.condition_code,
                     fetchedAt: new Date(),
                 },
             });

             // Save Daily Forecast
             await tx.dailyForecast.deleteMany({ where: { locationId: locationId } });

             if (apiData.daily && Array.isArray(apiData.daily) && apiData.daily.length > 0) {
                 const dailyForecastData = apiData.daily.map((day: any) => ({
                     locationId: locationId,
                     date: day.date,
                     maxTemp: day.max_temp,
                     minTemp: day.min_temp,
                     conditionCode: day.condition_code,
                 }));
                 await tx.dailyForecast.createMany({ data: dailyForecastData, skipDuplicates: true });
             }
         });

          console.log(`[fetchAndSaveHelper] Saved fresh data for "${locationName}".`);

         // Signal WS server AFTER successful DB save
         const wsUpdateData = {
             temperature: apiData.current.temperature,
             windSpeed: apiData.current.wind_speed,
             humidity: apiData.current.relative_humidity_2m, // <-- Also use correct key here for WS data
             conditionCode: apiData.current.condition_code,
         };
         // Ensure WS_BROADCAST_URL is correctly defined from WS_PORT
         // This fetch call is outside the transaction, but its failure is caught by the helper's catch
         fetch(WS_BROADCAST_URL, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ location: locationName, data: wsUpdateData }),
         }).then(wsRes => {
             if (!wsRes.ok) {
                 console.error(`[fetchAndSaveHelper] Failed to signal WS server to broadcast: ${wsRes.status}`);
                 try { wsRes.text().then(text => console.error('WS Broadcast Error Body:', text)); } catch(e){}
             } else {
                  console.log(`[fetchAndSaveHelper] Successfully signaled WS server to broadcast for "${locationName}".`);
             }
         }).catch(wsErr => {
             console.error(`[fetchAndSaveHelper] Error communicating with WS server for broadcast for "${locationName}":`, wsErr);
         });


         // Format the fetched API data for returning to the frontend
         const responseData = {
             temperature: apiData.current.temperature,
             windSpeed: apiData.current.wind_speed,
             humidity: apiData.current.relative_humidity_2m, // <-- Also use correct key here for response
             conditionCode: apiData.current.condition_code,
             daily: apiData.daily.map((d: any) => ({
                 day: new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
                 max: d.max_temp,
                 min: d.min_temp,
                 weatherCode: d.condition_code,
             })),
         };
         return responseData;


     } catch (dbOrWsError: any) {
         console.error(`[fetchAndSaveHelper] Database transaction or WS signal failed for "${locationName}":`, dbOrWsError);
          // Log the full error details here as well
         // Re-throw the error so it's caught by the main GET handler's catch block
         throw dbOrWsError;
     }
}