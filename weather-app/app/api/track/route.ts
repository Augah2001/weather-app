// app/api/track/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

// Instantiate PrismaClient outside the handler function
const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
    try {
        // Parse the JSON request body
        const body = await request.json();
        // Expect location name, lat, and lon from frontend
        const { location, lat, lon } = body;

        // Validate incoming data
        if (!location || typeof location !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') {
            console.error('Invalid request body for /api/track:', body);
            return NextResponse.json({ error: 'Invalid request body: location (string), lat (number), and lon (number) are required' }, { status: 400 });
        }

        console.log(`Attempting to mark location for tracking: "${location}" (${lat}, ${lon})...`);

        // Use upsert to find the location by name, or create it if it doesn't exist.
        // In either case (found or created), ensure isTracking is set to true.
        // This handles cases where a non-tracked location is tracked, or a new location is tracked immediately.
        const upsertedLocation = await prisma.location.upsert({
            where: { name: location }, // Try to find by the unique name
            update: { latitude: lat, longitude: lon, isTracking: true }, // If found, update coords and set isTracking
            create: { name: location, latitude: lat, longitude: lon, isTracking: true }, // If not found, create with these values and set isTracking
        });

        console.log(`Location "${upsertedLocation.name}" (ID: ${upsertedLocation.id}) is now marked for tracking.`);

        // Return success response with relevant location info
        return NextResponse.json({ message: 'Location tracking status updated', location: {
             id: upsertedLocation.id,
             name: upsertedLocation.name,
             latitude: upsertedLocation.latitude,
             longitude: upsertedLocation.longitude,
             isTracking: upsertedLocation.isTracking
        }});

    } catch (error: any) {
        // Log and return a server error if something goes wrong during the DB operation
        console.error('Error in /api/track handler:', error);
         // Check for specific Prisma errors if needed (e.g., unique constraint violations, though upsert should prevent name duplicates)
         if (error.code === 'P2002') {
              console.warn(`Attempted to track location "${location}" but a unique constraint was violated (P2002).`);
              // Return a specific error for unique constraint if necessary
              return NextResponse.json({ error: 'Location name already exists with conflicting data' }, { status: 409 }); // Conflict
         }
        return NextResponse.json({ error: 'Internal server error while updating tracking status', details: error.message }, { status: 500 });
    } finally {
         // Optional: Disconnect prisma client if necessary
         // await prisma.$disconnect();
    }
}