// app/api/location-lookup/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

// Instantiate PrismaClient outside the handler function
const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const locationName = searchParams.get('name'); // Get the location name from query parameter

    // Validate input
    if (!locationName) {
        return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    console.log(`Attempting to look up location "${locationName}" in DB.`);

    try {
        // Query the database to find a unique location by its name
        // Select only the fields needed by the frontend lookup result
        const location = await prisma.location.findUnique({
            where: { name: locationName },
            select: { id: true, name: true, latitude: true, longitude: true, isTracking: true }, // <-- Included isTracking
        });

        // If location is found, return its details
        if (location) {
            console.log(`Location "${locationName}" found in DB (isTracking: ${location.isTracking}).`);
            return NextResponse.json({
                 name: location.name,
                 latitude: location.latitude,
                 longitude: location.longitude,
                 isTracking: location.isTracking // <-- Return tracking status
            });
        } else {
            // If location is not found, return a 404 Not Found response
            console.log(`Location "${locationName}" not found in DB.`);
            return NextResponse.json({ error: 'Location not found in database' }, { status: 404 });
        }

    } catch (error: any) {
        // Log and return a server error if something goes wrong during the DB query
        console.error('Error during DB location lookup:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    } finally {
         // Optional: Disconnect prisma client if necessary in some deployment environments
         // await prisma.$disconnect();
    }
}