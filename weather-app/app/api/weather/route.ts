// app/api/weather/route.ts (MODIFIED AGAIN TO FIX HUMIDITY AND REFERENCERROR PLACEMENT)
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { fetchWeatherFromApi } from '../../lib/weatherApi'; // Adjust path if necessary

// Instantiate PrismaClient outside the handler function
const prisma = new PrismaClient();

// Get WebSocket server port from environment variables
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3002;
const WS_BROADCAST_URL = `http://localhost:${WS_PORT}/broadcast`; // URL for the internal broadcast endpoint

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    // Expect lat, lon, and the location name from the frontend
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const locationName = searchParams.get('location'); // Frontend sends this now

    // Declare finalLocationName here so it's accessible in catch blocks
    let finalLocationName = locationName; // Initialize with the value from the query parameter

    if (!lat || !lon) {
        return NextResponse.json({ error: 'Missing lat or lon parameter' }, { status: 400 });
    }
     // Add check for locationName here as well, as per the new frontend logic
    if (!finalLocationName) {
         // This case shouldn't happen if frontend correctly sends the location param
         console.error('Missing location name parameter in /api/weather GET request');
         return NextResponse.json({ error: 'Missing location name parameter' }, { status: 400 });
    }


    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);

    if (isNaN(latitude) || isNaN(longitude)) {
         return NextResponse.json({ error: 'Invalid lat or lon parameter' }, { status: 400 });
    }

    console.log(`Workspaceing weather data by coords for "${finalLocationName}" (${latitude}, ${longitude})...`);


    // --- Fetch from OpenMeteo API ---
    const apiData = await fetchWeatherFromApi(latitude, longitude);

    if (!apiData) {
        console.error(`API fetch failed for coords (${latitude}, ${longitude}).`);
        // Return error if API fetch fails
        return NextResponse.json({ error: 'Failed to fetch weather data from external API' }, { status: 500 });
    }

    console.log("Successfully fetched data from OpenMeteo.");

    // --- Save/Update data in DB and Trigger WS using a transaction ---
    try {
        let locationId;

        await prisma.$transaction(async (tx) => {
             // Upsert location: find by name (which frontend provided), create if not exists, update coords if name exists
             // This uses the name determined by the frontend (from DB lookup or Geocoding)
             // Use non-null assertion since we checked !finalLocationName above
            const upsertResult = await tx.location.upsert({
                where: { name: finalLocationName! },
                update: { latitude: latitude, longitude: longitude }, // Update coords in case they refined via map/suggestion
                create: { name: finalLocationName!, latitude: latitude, longitude: longitude }, // Create with provided name and coords
            });
             locationId = upsertResult.id; // Get the ID of the upserted location


            // Save Current Weather (INSERT OR REPLACE logic via upsert on unique key)
             await tx.currentWeather.upsert({
                where: { locationId: locationId },
                update: {
                    temperature: apiData.current.temperature,
                    windSpeed: apiData.current.wind_speed,
                    // FIX: Use relative_humidity_2m key from apiData
                    humidity: apiData.current.relative_humidity_2m,
                    conditionCode: apiData.current.condition_code,
                    fetchedAt: new Date(),
                },
                create: {
                    locationId: locationId,
                    temperature: apiData.current.temperature,
                    windSpeed: apiData.current.wind_speed,
                    // FIX: Use relative_humidity_2m key from apiData
                    humidity: apiData.current.relative_humidity_2m,
                    conditionCode: apiData.current.condition_code,
                    fetchedAt: new Date(),
                },
            });

            // Save Daily Forecast
            // Delete old forecast entries for this location first
            await tx.dailyForecast.deleteMany({
                where: { locationId: locationId },
            });

            // Insert new forecast entries
             if (apiData.daily && Array.isArray(apiData.daily) && apiData.daily.length > 0) {
                // Prepare data for createMany, mapping API keys to DB keys
                const dailyForecastData = apiData.daily.map((day: any) => ({
                    locationId: locationId,
                    date: day.date, //-MM-DD string from API
                    maxTemp: day.max_temp,
                    minTemp: day.min_temp,
                    conditionCode: day.condition_code, // WMO code from API
                }));
                await tx.dailyForecast.createMany({
                    data: dailyForecastData,
                     skipDuplicates: true, // Should be handled by deleteMany, but safe
                });
             }
        });

        console.log(`Saved fresh data for "${finalLocationName}" (ID: ${locationId}) from API.`);

        // 6. Trigger Real-time update broadcast via the separate WS server
        // Make an internal HTTP POST request to the WS server's broadcast endpoint
        const wsUpdateData = {
            temperature: apiData.current.temperature,
            windSpeed: apiData.current.wind_speed,
            humidity: apiData.current.relative_humidity_2m,
            conditionCode: apiData.current.condition_code,
            // Include name/id if WS clients need to filter messages (optional)
             // locationName: finalLocationName,
             // locationId: locationId
        };

         // Ensure WS_BROADCAST_URL is correctly defined from WS_PORT
        fetch(WS_BROADCAST_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location: finalLocationName, data: wsUpdateData }), // Send location name for WS server to route
        }).then(wsRes => {
            if (!wsRes.ok) {
                console.error(`Failed to signal WS server to broadcast: ${wsRes.status}`);
                 try { wsRes.text().then(text => console.error('WS Broadcast Error Body:', text)); } catch(e){}
            } else {
                 console.log(`Successfully signaled WS server to broadcast for "${finalLocationName}".`);
            }
        }).catch(wsErr => {
            console.error(`Error communicating with WS server for broadcast for "${finalLocationName}":`, wsErr);
        });


        // 7. Return the newly fetched data to the frontend
         // Map the fetched API data format to the frontend's expected format
         // Frontend expects { temperature, windSpeed, humidity, conditionCode, daily: [{ day, max, min, weatherCode }, ...] }
        const responseData = {
             temperature: apiData.current.temperature,
             windSpeed: apiData.current.wind_speed,
             humidity: apiData.current.relative_humidity_2m, // Map API key to frontend key
             conditionCode: apiData.current.condition_code, // Map API key to frontend key
             daily: apiData.daily.map((d: any) => ({
                // Backend needs to add 'day' name here before sending to frontend
                day: new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }), // Add day name
                max: d.max_temp, // Map API key to frontend key
                min: d.min_temp, // Map API key to frontend key
                weatherCode: d.condition_code, // Map API key to frontend key (WMO)
                // Optionally include original date string
                // date: d.date,
             })),
        };

        return NextResponse.json(responseData);

    } catch (dbError: any) {
        // finalLocationName is now defined here because it's outside the try block
        console.error(`Database transaction or WS signal failed for "${finalLocationName}":`, dbError);
        console.log(dbError)
        // If DB/WS fails, we still fetched from API. Return API data? Or error?
        // Returning API data is better UX than error if fetch succeeded
        console.warn(`Database save or WS signal failed for "${finalLocationName}", returning data fetched from API.`);

         // Map fetched API data to frontend format again for the response
        const responseData = {
           temperature: apiData.current.temperature,
           windSpeed: apiData.current.wind_speed,
           humidity: apiData.current.relative_humidity_2m,
           conditionCode: apiData.current.condition_code,
            daily: apiData.daily.map((d: any) => ({
               day: new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short' }),
               max: d.max_temp,
               min: d.min_temp,
               weatherCode: d.condition_code,
            })),
       };
        // Log the DB error to monitoring
        return NextResponse.json(responseData, { status: 200 }); // Return OK even if DB/WS failed, data was fetched
    } finally {
         // Disconnect prisma client if necessary
         // await prisma.$disconnect();
    }
}