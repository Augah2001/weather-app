// app/api/weather/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { fetchWeatherFromApi } from '../../lib/weatherApi'; // adjust path as needed

// Instantiate PrismaClient outside the handler for connection pooling
const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    // Fetch all tracked locations
    const locations = await prisma.location.findMany({
      where: { isTracking: true }, include:{currentWeather:true, dailyForecasts: true}
    });

    console.log('Locations to fetch weather for:', locations);

    if (locations.length === 0) {
      return NextResponse.json(
        { error: 'No locations found for tracking' },
        { status: 404 }
      );
    }

   

    // Return the aggregated weather data to the frontend
    return NextResponse.json({ data: locations });
  } catch (error) {
    console.error('Error fetching tracked weather:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  } finally {
    // Optionally disconnect or leave open
    // await prisma.$disconnect();
  }
}
