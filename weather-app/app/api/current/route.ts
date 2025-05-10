''// app/api/current/route.ts
import { NextRequest, NextResponse } from 'next/server'; // Import NextRequest
import { PrismaClient } from '@prisma/client';
// In Next.js 13+, fetch is globally available, no need to import node-fetch
// import fetch from 'node-fetch';

// Instantiate PrismaClient outside the handler function
// to avoid creating new instances on every request in production
const prisma = new PrismaClient();

// Define the GET handler function using NextRequest
export async function GET(request : NextRequest) { // Use NextRequest type
  // Access search parameters directly from NextRequest
  const searchParams = request.nextUrl.searchParams; // Access searchParams via nextUrl
  console.log('searchParams:', searchParams);
  const location = searchParams.get('location');
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');
  console.log('location:', location);
  console.log('lat:', lat);
    console.log('lon:', lon);

  // Validate required parameters
  if (!location || !lat || !lon) {
    // Use NextResponse.json for returning JSON responses
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  // Parse latitude and longitude
  const locName = location;
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lon);

  // Basic validation for parsed numbers
  if (isNaN(latitude) || isNaN(longitude)) {
      return NextResponse.json({ error: 'Invalid latitude or longitude' }, { status: 400 });
  }


  try {
    // 1) Upsert the Location row
    // Use lat and lon fields in the Location model as per your schema
    const loc = await prisma.location.findMany();

    // 2) Try to read a record from the last 5 minutes
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    let latest = await prisma.weatherData.findFirst({
      where: {
        locationId: loc.id,
        fetchedAt: { gte: fiveMinAgo }
      },
      orderBy: { fetchedAt: 'desc' },
    });

    // 3) If stale/missing, fetch & insert
    if (!latest) {
      // fetch is globally available in Next.js 13+
      const apiRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=celsius&windspeed_unit=kmh&precipitation_unit=mm` // Added units for clarity
      );

      if (!apiRes.ok) {
          // Handle potential API errors
          console.error(`Error fetching weather data: ${apiRes.status}`);
          return NextResponse.json({ error: 'Failed to fetch weather data from external API' }, { status: apiRes.status });
      }

      const data = await apiRes.json();
      const cw = data.current_weather;

      // Check if current_weather data exists
      if (!cw) {
           console.error('External API did not return current_weather data:', data);
           return NextResponse.json({ error: 'External API did not return expected weather data' }, { status: 500 });
      }


      latest = await prisma.weatherData.create({
        data: {
          locationId: loc.id,
          fetchedAt: new Date(),
          temperature: cw.temperature,
          windSpeed: cw.windspeed,
          // Note: Open-Meteo's current_weather doesn't include humidity directly.
          // You might need to fetch hourly/daily data for humidity or use a different API.
          // For now, setting humidity to null or a default if not available.
          humidity: null, // Assuming humidity is not in current_weather based on docs/common usage
          conditionCode: cw.weathercode.toString(),
          rawApiPayload: data, // Store the full response
        },
      });
    }

    // Return the latest weather data
    return NextResponse.json({
      temperature: latest.temperature,
      windSpeed: latest.windSpeed,
      humidity: latest.humidity, // This will be null if not fetched/stored
      conditionCode: latest.conditionCode,
      fetchedAt: latest.fetchedAt, // Include timestamp to show data freshness
      source: latest.id ? 'cache' : 'api', // Indicate if data came from DB cache or API fetch
    });

  } catch (error) {
    console.error('API Error:', error);
    // Return a generic error response
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  } finally {
    // Disconnect Prisma client in development to prevent multiple instances
    // In production (serverless), the environment handles connection pooling
    if (process.env.NODE_ENV === 'development') {
      await prisma.$disconnect();
    }
  }
}

// You can also define other HTTP methods like POST, PUT, DELETE here
// export async function POST(request: NextRequest) { ... }
''