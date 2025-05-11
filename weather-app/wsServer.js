// wsServer.js

// --- Module Imports ---
const WebSocket = require('ws'); // WebSocket library
const http = require('http'); // Node.js built-in HTTP module
const { PrismaClient } = require('@prisma/client'); // Import Prisma Client
// Import the weather API helper.
// !!! ADJUST THIS PATH based on where wsServer.js is relative to your lib folder!
// Example: if wsServer.js is at the project root and lib is at project_root/lib
const { fetchWeatherFromApi } = require('./app/lib/weatherApi-js'); // <-- ADJUST PATH as needed!

// --- Configuration ---
// Get WebSocket server port from environment variables or default to 3002
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3002;
// Interval for background polling of tracked locations (e.g., every 30 minutes) in milliseconds
const POLLING_INTERVAL_MS = 10000; // 30 minutes

// --- Initialization ---
const prisma = new PrismaClient(); // Instantiate Prisma Client
const server = http.createServer(); // Create a basic HTTP server. WS runs on this server.
const wss = new WebSocket.Server({ server }); // Create WebSocket server instance attached to the HTTP server

// Map to store active WebSocket connections, categorized by location name.
// This allows broadcasting updates efficiently to only relevant clients.
// Key: locationName (string), Value: Set of WebSocket instances
const clientsByLocation = new Map();

// --- WebSocket Server Core Logic ---

// Event handler for when a new WebSocket connection is established
wss.on('connection', (ws, request) => {
    // Extract the location name from the query parameters provided in the connection URL (e.g., ws://localhost:3002/ws?location=Harare)
    const url = new URL(request.url, `ws://localhost:${WS_PORT}`); // Use WS_PORT for the base URL for parsing
    const locationName = url.searchParams.get('location');

    // If no location name is provided, close the connection as we don't know what updates to send.
    if (!locationName) {
        console.warn('WS: Connection attempted without location parameter. Closing connection.');
        ws.close(1008, 'Location parameter required'); // Code 1008: Policy Violation
        return; // Stop processing this connection
    }

    // --- LOG: Client connected ---
    console.log(`WS: Client connected for location: "${locationName}".`);

    // Add the new client's WebSocket instance to the map, organized by location name.
    // If this is the first client for this location, create a new Set.
    if (!clientsByLocation.has(locationName)) {
        clientsByLocation.set(locationName, new Set());
    }
    clientsByLocation.get(locationName).add(ws);

    // Optional: Send initial data to the newly connected client.
    // This ensures a client gets the current weather immediately upon connecting, even if
    // a broadcast hasn't just occurred. You could fetch the latest data from the DB here.
    // (This is commented out by default, but you can uncomment and implement it if desired)
    /*
    (async () => {
        try {
            const location = await prisma.location.findUnique({ where: { name: locationName } });
            if (location) {
                 const current = await prisma.currentWeather.findUnique({ where: { locationId: location.id } });
                 if (current) {
                     const initialData = { // Format the data as expected by the frontend WS handler
                         temperature: current.temperature,
                         windSpeed: current.windSpeed,
                         humidity: current.humidity,
                         conditionCode: current.conditionCode,
                         locationName: location.name, // Include name for client-side verification
                     };
                     // Check if connection is still open before sending
                     if (ws.readyState === WebSocket.OPEN) {
                         ws.send(JSON.stringify(initialData));
                         console.log(`WS: Sent initial data for "${locationName}" to new client.`);
                     }
                 }
            }
        } catch (err) {
            console.error(`WS: Error sending initial data for "${locationName}":`, err);
        }
    })();
    */


    // Event handler for messages received from a client (if your frontend sends messages)
    ws.on('message', (message) => {
        // --- LOG: Message received from client ---
        console.log(`WS: Received message from client for "${locationName}": ${message}`);
        // Add logic here to handle incoming messages if your frontend sends any (e.g., SUBSCRIBE, UNSUBSCRIBE, PING)
    });

    // Event handler for when a connection is closed by the client or server
    ws.on('close', (code, reason) => {
        // --- LOG: Connection closed ---
        console.log(`WS: Client disconnected for "${locationName}" with code ${code}: ${reason}`);
        // Remove the disconnected client's WebSocket instance from the map
        if (clientsByLocation.has(locationName)) {
            clientsByLocation.get(locationName).delete(ws);
            // If no clients are left for this specific location, clean up the map entry
            if (clientsByLocation.get(locationName).size === 0) {
                clientsByLocation.delete(locationName);
                 console.log(`WS: No more clients connected for "${locationName}". Cleaned up map entry.`);
            }
        }
    });

    // Event handler for connection errors
    ws.on('error', (error) => {
        // --- LOG: WebSocket error ---
        console.error(`WS: WebSocket error for "${locationName}":`, error);
        // The 'close' event will typically follow an 'error' event, handling removal from map.
    });
});

// --- Broadcast Function ---
// This function sends data (weather updates) to all clients currently subscribed to a specific location name.
// It is called by the internal /broadcast HTTP endpoint AND the background tracker.
const sendUpdateToSubscribers = (locationName, data) => {
    const clients = clientsByLocation.get(locationName); // Get the Set of clients for this location
    if (clients) {
        // --- LOG: Starting broadcast ---
        console.log(`WS: Broadcasting update for "${locationName}" to ${clients.size} client(s).`);
        const message = JSON.stringify(data); // Stringify the data to be sent over WS

        // Iterate over the clients and send the message
        clients.forEach(client => {
            // Check if the client connection is still in the OPEN state before sending
            if (client.readyState === WebSocket.OPEN) {
                client.send(message, (error) => {
                    if (error) {
                        console.error(`WS: Error sending message to client for "${locationName}":`, error);
                    }
                });
            } else {
                 // --- LOG: Attempted send to non-open client ---
                 console.warn(`WS: Attempted to send message to a non-open client for "${locationName}". State: ${client.readyState}`);
                 // The 'close' handler should remove these, but this helps catch issues.
            }
        });
    } else {
        // --- LOG: No clients for broadcast ---
        console.log(`WS: No clients connected for "${locationName}". Skipping broadcast.`);
    }
};

// --- Internal HTTP Endpoint for Broadcast (Called by Next.js API route or potentially Background Tracker) ---
// This sets up a minimal HTTP server endpoint (`/broadcast`) that listens for POST requests.
// This allows other processes (like your Next.js API routes or a separate background script)
// to trigger a WebSocket broadcast by sending data to this endpoint.
server.on('request', (req, res) => {
    // Handle only POST requests specifically to the '/broadcast' path
    if (req.method === 'POST' && req.url === '/broadcast') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString(); // Accumulate the request body data
        });
        req.on('end', () => {
            try {
                // Parse the incoming JSON body, expecting { location: string, data: object }
                const { location, data } = JSON.parse(body);
                if (location && data) {
                    // --- LOG: Received broadcast signal ---
                    console.log(`WS: Received HTTP broadcast signal for "${location}".`);
                    // Use the local sendUpdateToSubscribers function to actually perform the broadcast
                    sendUpdateToSubscribers(location, data);
                    // Send a success response back to the caller (e.g., your Next.js API route)
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: `Broadcast signaled for ${location}` }));
                } else {
                    // --- LOG: Invalid broadcast signal ---
                    console.warn('WS: Received invalid broadcast signal format.');
                    // Send a bad request response
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Invalid broadcast payload' }));
                }
            } catch (error) {
                // --- LOG: Error processing broadcast signal ---
                console.error('WS: Error processing broadcast signal:', error);
                // Send a server error response
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Internal server error processing broadcast' }));
            }
        });
    } else {
        // Respond with 404 for any other HTTP requests to this server instance
        res.writeHead(404);
        res.end('Not Found');
    }
});


// --- Background Tracking Polling Logic ---
// This section implements the periodic update process for locations marked as tracked in the database.

const updateTrackedLocations = async () => {
    // --- LOG: Starting background update cycle ---
    console.log('BG: Starting background update for tracked locations...');
    let processedCount = 0; // Counter for successfully updated locations in this cycle
    try {
        // 1. Query the database to find all locations where isTracking is true
        const trackedLocations = await prisma.location.findMany({
            where: { isTracking: true },
            // Select only the necessary fields to avoid excessive data transfer
            select: { id: true, name: true, latitude: true, longitude: true }
        });

        // --- LOG: Number of tracked locations found ---
        console.log(`BG: Found ${trackedLocations.length} locations marked for tracking.`);

        // 2. Loop through each tracked location found
        for (const location of trackedLocations) {
            // --- LOG: Processing individual tracked location ---
            console.log(`BG: Processing update for tracked location: "${location.name}" (ID: ${location.id})`);
            try {
                // 2a. Fetch fresh weather data from the external OpenMeteo API using the helper function
                const apiData = await fetchWeatherFromApi(location.latitude, location.longitude);

                if (!apiData) {
                    // --- LOG: API fetch failed for specific location ---
                    console.error(`BG: Failed to fetch API data for tracked location: "${location.name}". Skipping DB update and broadcast.`);
                    continue; // Skip to the next location in the loop if API fetch failed
                }

                // --- LOG: API fetch successful for specific location ---
                console.log(`BG: Successfully fetched data from OpenMeteo for "${location.name}".`);
                let weather; // Declare variable to hold current weather data
                // 2b. Save the newly fetched data in the Database
                // Use a transaction to ensure atomicity for updates related to a single location
                await prisma.$transaction(async (tx) => {
                    // Update current weather for this location (upsert handles insert/update based on locationId)
                    const weather_up =await tx.currentWeather.upsert({
                        where: { locationId: location.id },
                        update: {
                            temperature: apiData.current.temperature,
                            windSpeed: apiData.current.wind_speed,
                            humidity: apiData.current.humidity, // Use the correct key from apiData
                            conditionCode: apiData.current.condition_code,
                            fetchedAt: new Date(), // Update the fetched timestamp
                        },
                        create: { // This create path is a fallback; update path is used if current data exists
                            locationId: location.id, // Link to the location
                            temperature: apiData.current.temperature,
                            windSpeed: apiData.current.wind_speed,
                            humidity: apiData.current.humidity, // Use the correct key
                            conditionCode: apiData.current.condition_code,
                            fetchedAt: new Date(), // Set initial timestamp
                        },
                    });
                    weather = weather_up; // Assign the upserted weather data to the variable
                    // console.log(weather)

                    // console.log(apiData)

                    // Delete old daily forecast entries for this location first
                    await tx.dailyForecast.deleteMany({ where: { locationId: location.id } });

                    // Insert the new 7-day daily forecast entries
                     if (apiData.daily && Array.isArray(apiData.daily) && apiData.daily.length > 0) {
                        const dailyForecastData = apiData.daily.map((day) => ({
                            locationId: location.id, // Link to the location
                            date: day.date, // Date string (e.g., "YYYY-MM-DD") from API
                            maxTemp: day.max_temp, // Access max temp using index of date in time array
                            minTemp: day.min_temp, // Access min temp using index of date in time array
                            conditionCode: day.condition_code, // Access WMO code using index of date in time array
                            // --- Previous Mapping Logic ---
                            // date: day.date, // Date string (e.g., "YYYY-MM-DD") from API
                            // maxTemp: day.max_temp, // Mapping max temp (Assuming apiData.daily.map structure)
                            // minTemp: day.min_temp, // Mapping min temp (Assuming apiData.daily.map structure)
                            // conditionCode: day.condition_code, // Mapping WMO code (Assuming apiData.daily.map structure)
                        }));
                         // Correcting daily forecast data mapping based on OpenMeteo structure where
                         // daily variables are parallel arrays indexed by time.
                         const dailyData = apiData.daily.map((day) => ({
                            locationId: location.id, // Link to the location
                            date: day.date, // Date string (e.g., "YYYY-MM-DD") from API
                            maxTemp: day.max_temp, // Access max temp using index of date in time array
                            minTemp: day.min_temp, // Access min temp using index of date in time array
                            conditionCode: day.condition_code, // Access WMO code using index of date in time array
                        
                         }));

                        await tx.dailyForecast.createMany({
                            data: dailyData, // Use the corrected dailyData mapping
                            skipDuplicates: true // Should be fine due to deleteMany, but safe
                        });
                         // --- LOG: Saved new daily forecasts ---
                         console.log(`BG: Created ${dailyData.length} new daily forecasts for ID ${location.id}.`);

                     } else {
                         console.warn(`BG: No daily forecast data received from API for "${location.name}".`);
                     }
                });

                // --- LOG: Database transaction successful ---
                console.log(`BG: Database transaction successful for tracked location: "${location.name}".`);

                // 2c. Signal the local WS server's broadcast function to send the new current weather data
                // Format the current weather data to be sent via WebSocket
                const currentWeatherDataForBroadcast = {
                     temperature: apiData.current.temperature,
                     updatedAt: weather.fetchedAt, // Timestamp of the update
                     windSpeed: apiData.current.wind_speed,
                     humidity: apiData.current.humidity, // Use the correct key for broadcast data
                     conditionCode: apiData.current.condition_code,
                     locationName: location.name, // Include location name so broadcast function knows who to send to
                };
                // Call the local function that handles sending messages to subscribers
                console.log(currentWeatherDataForBroadcast)
                sendUpdateToSubscribers(location.name, currentWeatherDataForBroadcast);

                processedCount++; // Increment count for successfully processed locations in this cycle


            } catch (locationUpdateError) {
                // --- LOG: Error updating specific location ---
                console.error(`BG: Error updating tracked location "${location.name}" (ID: ${location.id}):`, locationUpdateError);
                // Continue with the next location in the loop even if one fails
            }
        } // End of loop through tracked locations

    } catch (overallError) {
        // --- LOG: Error during overall background update process (e.g., DB query failed) ---
        console.error('BG: Error finding tracked locations in DB or during polling loop:', overallError);
    } finally {
        // --- LOG: Background update cycle complete ---
        console.log(`BG: Background update cycle complete. Successfully processed ${processedCount} tracked location(s).`);
        // The next run is automatically scheduled by setInterval
    }
};

// --- Scheduling ---
// 3. Schedule the updateTrackedLocations function to run periodically at the defined interval.
// This starts the background polling.
console.log(`BG: Scheduling background update to run every ${POLLING_INTERVAL_MS / 1000} seconds (${POLLING_INTERVAL_MS / 60 / 1000} minutes).`);
setInterval(updateTrackedLocations, POLLING_INTERVAL_MS);

// Optional: Run the update once immediately when the WS server script starts.
// This ensures fresh data is fetched shortly after the server comes online.
console.log('BG: Running initial background update on startup.');
updateTrackedLocations();


// --- Start the HTTP and WebSocket Server ---
// Listen on the configured port
server.listen(WS_PORT, () => {
    // --- LOG: Server started ---
    console.log(`WS: WebSocket server running on port ${WS_PORT}`);
    console.log(`WS: Internal broadcast HTTP endpoint: http://localhost:${WS_PORT}/broadcast`);
    console.log(`WS: WebSocket connection endpoint: ws://localhost:${WS_PORT}`);
});

// --- Graceful Shutdown Handling ---
// Listen for termination signals (like from docker stop or manual kill)
// This attempts to close the Prisma client connection cleanly before the process exits.
process.on('SIGTERM', async () => {
    console.log('Server: SIGTERM signal received. Closing resources.');
    await prisma.$disconnect(); // Disconnect Prisma Client
    server.close(() => { // Close the HTTP server
        console.log('Server: HTTP server closed.');
        // Optionally close all WS connections here if needed before exiting
        // wss.clients.forEach(client => client.terminate()); // Forcefully terminate all WS connections
        process.exit(0); // Exit the Node.js process cleanly
    });
});

// Listen for interrupt signal (like Ctrl+C)
process.on('SIGINT', async () => {
    console.log('Server: SIGINT signal received. Closing resources.');
    await prisma.$disconnect(); // Disconnect Prisma Client
     server.close(() => { // Close the HTTP server
        console.log('Server: HTTP server closed.');
        process.exit(0); // Exit the Node.js process cleanly
     });
});

// Handle unhandled promise rejections to prevent the process from crashing unexpectedly
process.on('unhandledRejection', (reason, promise) => {
  console.error('Server: Unhandled Rejection at:', promise, 'reason:', reason);
  // Depending on the nature of the error, you might want to trigger a graceful shutdown
  // process.exit(1); // Exit with a non-zero code indicating an error
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Server: Uncaught Exception:', err);
  // This is a critical error that indicates a bug.
  // Perform cleanup and exit gracefully.
  // process.exit(1);
});