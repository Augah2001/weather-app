// app/api/track/route.ts (MOSTLY UNCHANGED)
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { location, lat, lon } = body; // Expect location name, lat, lon from frontend

        if (!location || typeof lat !== 'number' || typeof lon !== 'number') {
            return NextResponse.json({ error: 'Invalid request body: location (name), lat, and lon are required' }, { status: 400 });
        }

        console.log(`Attempting to track location: "${location}" (${lat}, ${lon})...`);

        // Find the location by name, or create it if it doesn't exist
        // Use upsert to handle both cases and set isTracking to true
        const upsertedLocation = await prisma.location.upsert({
            where: { name: location }, // Find by name
            update: { latitude: lat, longitude: lon, isTracking: true }, // Update coords and set tracking if name exists
            create: { name: location, latitude: lat, longitude: lon, isTracking: true }, // Create and set tracking if name doesn't exist
        });

        console.log(`Location "${location}" (ID: ${upsertedLocation.id}) marked for tracking.`);

        return NextResponse.json({ message: 'Location tracking status updated', location: {
             id: upsertedLocation.id,
             name: upsertedLocation.name,
             latitude: upsertedLocation.latitude,
             longitude: upsertedLocation.longitude,
             isTracking: upsertedLocation.isTracking
        }});

    } catch (error: any) {
        console.error('Error in /api/track handler:', error);
         // Check for specific Prisma errors if needed
         if (error.code === 'P2002') { // Unique constraint failed (shouldn't happen with upsert on name)
             console.warn(`Attempted to create location "${location}" but name already exists (P2002).`);
              // Upsert handles this, so this specific error check might be less needed now,
              // but general error handling is still important.
         }
        return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 });
    } finally {
         // Disconnect prisma client if necessary
         // await prisma.$disconnect();
    }
}