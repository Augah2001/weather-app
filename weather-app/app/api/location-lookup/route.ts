// app/api/location-lookup/route.ts (MODIFIED)
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const locationName = searchParams.get('name');

    if (!locationName) {
        return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
    }

    console.log(`Attempting to look up location "${locationName}" in DB.`);

    try {
        // Find location in DB by name and include isTracking status
        const location = await prisma.location.findUnique({
            where: { name: locationName },
            select: { id: true, name: true, latitude: true, longitude: true, isTracking: true }, // <-- Added isTracking
        });

        if (location) {
            console.log(`Location "${locationName}" found in DB (isTracking: ${location.isTracking}).`);
            // Return the location details including coordinates and tracking status
            return NextResponse.json({
                 name: location.name,
                 latitude: location.latitude,
                 longitude: location.longitude,
                 isTracking: location.isTracking // <-- Return tracking status
            });
        } else {
            console.log(`Location "${locationName}" not found in DB.`);
            // Return 404 if location is not found
            return NextResponse.json({ error: 'Location not found in database' }, { status: 404 });
        }

    } catch (error: any) {
        console.error('Error during DB location lookup:', error);
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    } finally {
         // Disconnect prisma client if necessary (depending on Next.js version and deployment)
         // await prisma.$disconnect();
    }
}