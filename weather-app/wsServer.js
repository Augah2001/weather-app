// wsServer.js
// This is a standalone Node.js script to run the WebSocket server

require('dotenv').config(); // Load environment variables from .env
const WebSocket = require('ws');
const http = require('http');
const express = require('express'); // Use express to create a simple HTTP endpoint for broadcasting

// --- Configuration ---
const WS_PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3002;

if (isNaN(WS_PORT)) {
    console.error('Invalid WS_PORT in environment variables.');
    process.exit(1);
}

// --- WebSocket Server Setup ---
const wss = new WebSocket.Server({ noServer: true }); // Create WS server but don't attach to a port yet

// Map to store WebSocket clients, keyed by location name (lowercase for case-insensitivity)
// { 'harare': Set<WebSocket>, 'london': Set<WebSocket> }
const clients = new Map();

wss.on('connection', (ws, request) => {
    // Extract location from the URL (e.g., ws://localhost:3002?location=Harare)
    // Use the original request URL from the upgrade handshake
    const locationName = new URL(request.url, `http://${request.headers.host}`).searchParams.get('location');

    if (!locationName) {
        console.warn('WebSocket connection denied: No location specified');
        ws.terminate(); // Close connection if no location is provided
        return;
    }

    const normalizedLocationName = locationName.toLowerCase();

    // Add the client to the map for this location
    if (!clients.has(normalizedLocationName)) {
        clients.set(normalizedLocationName, new Set());
    }
    clients.get(normalizedLocationName).add(ws);

    console.log(`WebSocket client connected for location: ${locationName} (${normalizedLocationName}). Total clients for this location: ${clients.get(normalizedLocationName).size}`);
    console.log(`Total connected locations: ${clients.size}`);


    // Handle messages from clients (optional, not strictly needed for this app's requirement)
    ws.on('message', (message) => {
        console.log(`Received message from client for ${locationName}: ${message}`);
        // You could implement logic here to handle messages from clients
        // e.g., client requests historical data, client sends a chat message, etc.
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`WebSocket client disconnected for location: ${locationName} (${normalizedLocationName})`);
        const locationClients = clients.get(normalizedLocationName);
        if (locationClients) {
            locationClients.delete(ws);
            if (locationClients.size === 0) {
                clients.delete(normalizedLocationName); // Clean up map if no clients left for location
                console.log(`No more clients for location: ${locationName}. Removed from map.`);
            }
        }
         console.log(`Total connected locations: ${clients.size}`);
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for location ${locationName}:`, error);
        // Error might occur before close, ensure cleanup happens on close event
    });
});


// --- HTTP Server for Broadcast Signal ---
// This creates a small Express app just to listen for internal POST requests
// from your Next.js API route when it needs to broadcast an update.
const app = express();
app.use(express.json()); // Middleware to parse JSON request bodies

app.post('/broadcast', (req, res) => {
    const { location, data } = req.body;

    if (!location || !data) {
        return res.status(400).json({ error: 'Missing location or data in broadcast request' });
    }

    const normalizedLocationName = location.toLowerCase();
    const locationClients = clients.get(normalizedLocationName);

    if (locationClients) {
        const message = JSON.stringify(data);
        locationClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
        console.log(`Broadcasted update for "${location}" to ${locationClients.size} clients.`);
        return res.status(200).json({ message: 'Broadcast successful', clientsSentTo: locationClients.size });
    } else {
        console.log(`No clients connected for location "${location}". No broadcast needed.`);
        return res.status(200).json({ message: 'No clients found for this location' });
    }
});


// --- Start Servers ---
// We need an HTTP server to handle the /broadcast endpoint,
// and the WebSocket server needs to "upgrade" connections from HTTP requests.
const server = http.createServer(app); // Create HTTP server using the express app

server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

    // Only handle WebSocket connections to the '/ws' path
    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request); // Emit the 'connection' event for the WS server
        });
    } else {
        // For any other path, destroy the socket (e.g., if someone tries to hit root)
        socket.destroy();
    }
});

server.listen(WS_PORT, () => {
    console.log(`HTTP server for WebSocket upgrade and broadcast listening on port ${WS_PORT}`);
});

// --- Handle process shutdown ---
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP/WS server');
    server.close(() => {
        console.log('HTTP server closed');
        // Optionally close WebSocket connections gracefully
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1000, 'Server shutting down'); // Code 1000 is normal closure
            }
        });
         console.log('WebSocket clients closed');
        // In a real app, you might wait a bit for clients to disconnect
        process.exit(0);
    });
});

process.on('SIGINT', () => {
     console.log('SIGINT signal received: closing HTTP/WS server');
     server.close(() => {
         console.log('HTTP server closed');
         wss.clients.forEach(client => {
             if (client.readyState === WebSocket.OPEN) {
                 client.close(1000, 'Server shutting down');
             }
         });
          console.log('WebSocket clients closed');
         process.exit(0);
     });
 });