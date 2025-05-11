// app/components/HomePage.tsx




'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import dynamic from 'next/dynamic';

import { motion, AnimatePresence } from 'framer-motion';

// Added Star icons and Loader2 for loading/tracking status
import { Search, Droplet, Wind, ChevronDown, ChevronUp, Loader2, Star, Bell } from 'lucide-react';

// Assuming WeatherHelpers exists and is correctly implemented
// Adjust path as necessary for your project structure
import { weatherCodeMap, getWeatherIcon } from './Components/WeatherHelpers';
import TrackedLocationsSidebar from './Components/TrackedLocationsSidebar';
import ChartComponent from './Components/ChartComponent';
import NotificationsPanel from './Components/NotificationsPanel';

type Suggestion = { name: string; lat: number; lon: number };
type LocationCoords = { lat: number; lon: number };

// Assuming MapComponent exists and is correctly implemented
// Uncomment and position as needed in your layout


const MapComponent = dynamic(
  () => import('./Components/MapComponent'), 
  { ssr: false }            // ← never render on the server
)

export default function HomePage() {

  

  // panel toggle + message list
const [showNotifications, setShowNotifications] = useState(false);
const [notifications, setNotifications] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(min-width: 768px)');
    const handleChange = (e: MediaQueryListEvent) => setShowNotifications(e.matches);

    // Initialize
    setShowNotifications(mql.matches);

    // Listen for resizes across the 768px threshold
    mql.addEventListener('change', handleChange);
    return () => {
      mql.removeEventListener('change', handleChange);
    };
  }, []);

// keep last‐seen weather for every tracked location
const prevWeatherRef = useRef<Record<
  string,
  { temp: number; wind: number; humidity: number }
>>({});


  // Environment variables for API and WebSocket base URLs
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || ''; // e.g., '' or '/' for same-origin
  const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE_URL || ''; // e.g., 'ws://localhost:3002'
  const [showChart, setShowChart] = useState(false);
  // Ref to hold the WebSocket instance
  
  // State for the text currently in the search input
  const [inputLoc, setInputLoc] = useState('Harare');
  // State for the name of the location whose weather is currently displayed
  const [displayedLoc, setDisplayedLoc] = useState('Harare');
  // State for the coordinates of the location whose weather is currently displayed
  // Updating this state triggers the weather data fetch effect.
  const [displayedCoords, setDisplayedCoords] = useState<LocationCoords | null>({ lat: -17.8252, lon: 31.0335 });

  // Search & map state
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);

  const mapCenter = useMemo(() => displayedCoords || { lat: 0, lon: 0 }, [displayedCoords]);
  const wsRef = useRef<WebSocket | null>(null);

  // Handler when a tracked location is selected from the sidebar
  const handleSelectTracked = (loc: any) => {
    setSelectedLocationId(loc.id);
    setDisplayedLoc(loc.name);
    setDisplayedCoords({ lat: loc.latitude, lon: loc.longitude });
    setStatusMessage(null);
    setCurrent(null);
    setForecast([]);
    setIsDisplayedLocationTracked(true);
  };

   // State for the map center, derived from displayedCoords for convenience
   


  // State for the current weather data being displayed
  const [current, setCurrent] = useState<{
    temp: number;
    wind: number;
    humidity: number;
    condition: string; // Expecting WMO code as string or number
    updatedAt?: string; // Optional timestamp for when the data was last updated
  } | null>(null);

  // State for the forecast data being displayed
  const [forecast, setForecast] = useState<
    { day: string; max: number; min: number; weatherCode: string | number }[]
  >([]);

  // State for location suggestions from the Geocoding API
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // State to control the visibility of the suggestion dropdown
  const [showSuggestions, setShowSuggestions] = useState(false);

  // State for forecast visibility toggle
  const [showFullForecast, setShowFullForecast] = useState(false);

  // Loading state for weather data fetch
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);
  // State for displaying status messages (e.g., "Location not found in DB", errors)
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // State to store the tracking status of the currently displayed location
  const [isDisplayedLocationTracked, setIsDisplayedLocationTracked] = useState(false);

  useEffect(() => {
  fetch(`${API_BASE}/api/notifications`)
    .then((r) => r.json())
    .then((data: { locationName: string; message: string; createdAt: string }[]) => {
      setNotifications(
        data.map(
          (n) =>
            `${new Date(n.createdAt).toLocaleTimeString()} – ${n.locationName}: ${n.message}`
        )
      );
    })
    .catch(console.error);
}, []);


  // --- Effect to fetch weather data when displayedCoords or displayedLoc changes ---
  // This effect is the core driver for fetching weather data once a location (name+coords)
  // has been determined via search lookup, suggestion selection, or map click.
  useEffect(() => {
    // Only fetch if we have valid coordinates AND a location name to fetch for
    if (!displayedCoords || typeof displayedCoords.lat !== 'number' || typeof displayedCoords.lon !== 'number' || !displayedLoc) {
        console.log("Displayed location or coords incomplete, clearing weather/WS.");
        setCurrent(null);
        setForecast([]);
        setIsDisplayedLocationTracked(false); // Clear tracking status
        // Close WebSocket if we lose the displayed location
         if (wsRef.current) {
            wsRef.current.close(1000, 'No displayed location');
            wsRef.current = null;
        }
        return; // Exit if data is incomplete
    }

    setIsLoadingWeather(true); // Set loading state
    setStatusMessage(null); // Clear previous status messages
    // Tracking status is determined by the fetch result, no need to clear here

    // Close existing socket when displayed location changes
    if (wsRef.current) {
      wsRef.current.close(1000, 'Displayed location changed'); // Clean closure code (1000) and reason
      wsRef.current = null;
      console.log('Closed existing WebSocket connection due to coords change.');
    }

    // --- Fetch weather data by coordinates ---
    // This endpoint handles the DB vs API decision internally based on tracking status
    const fetchWeatherByCoords = async () => {
      console.log(`Workspaceing weather data for "${displayedLoc}" (${displayedCoords.lat}, ${displayedCoords.lon})...`);
      try {
        // Make the HTTP GET request to your backend's weather API route.
        // Include both location name and coordinates. The backend needs the name for DB lookup/upsert.
        const res = await fetch(
          `${API_BASE}/api/weather?location=${encodeURIComponent(displayedLoc)}&lat=${displayedCoords.lat}&lon=${displayedCoords.lon}`
        );

        if (!res.ok) {
           const errorBody = await res.text(); // Attempt to read error body for debugging
          console.error(`Weather by Coords HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
          console.error('Weather by Coords Error body:', errorBody);
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const weatherData = await res.json(); // Parse the JSON response
        console.log("Received weather data from /api/weather:", weatherData);
        

        const timeWithMs = weatherData.updatedAt.split('T')[1];            // "07:59:21.737Z"
        const time = timeWithMs.split('.')[0]; 
        const hours =parseInt(time.substring(0, 2));
        const minutes = parseInt(time.substring(3, 5));
        const seconds = parseInt(time.substring(6, 8));
        const final_time = `${hours+2}:${minutes}`; // Format time as "HH:MM:SS"


        // Update current weather state using data from the response
        setCurrent({
          temp: weatherData.temperature,
          wind: weatherData.windSpeed,
          humidity: weatherData.humidity,
          condition: weatherData.conditionCode?.toString(),
          updatedAt: final_time // Ensure condition is string for Helper
        });

        // Update forecast state using data from the response
        if (weatherData.daily && Array.isArray(weatherData.daily)) {
             setForecast(
               weatherData.daily.map((d: any) => ({
                 day: d.day, // Backend provides 'day'
                 max: d.max, // Backend provides 'max'
                 min: d.min, // Backend provides 'min'
                 weatherCode: d.weatherCode, // Backend provides 'weatherCode' (WMO)
               }))
             );
             console.log(`Received ${weatherData.daily.length} forecast days.`);
        } else {
             console.warn("Weather data response did not contain a valid 'daily' array:", weatherData);
             setForecast([]); // Clear forecast if data is missing/invalid
        }

         // Update tracking status state from the response
         setIsDisplayedLocationTracked(weatherData.isTracking || false);

         console.log(`Successfully updated weather data for "${displayedLoc}". Location is tracked: ${weatherData.isTracking}`);

      } catch (err) {
        console.error("Failed to fetch weather data by coords:", err);
        // Clear states and show error message on failure
        setCurrent(null);
        setForecast([]);
        setIsDisplayedLocationTracked(false); // Clear tracking status on error
        setStatusMessage("Failed to load weather data."); // Show error message to user
      } finally {
          setIsLoadingWeather(false); // Turn off loading state
      }
    };

    fetchWeatherByCoords(); // Call the async function to initiate the fetch


    // --- Open WS for real-time pushes ---
    // Establish WebSocket connection only if a displayed location name is available
     if (displayedLoc) {
        // Construct the WebSocket URL using the WS_BASE environment variable and include location name
        const ws = new WebSocket(`${WS_BASE}/ws?location=${encodeURIComponent(displayedLoc)}`);

        // Handle WebSocket open event
        ws.onopen = () => {
            console.log(`WebSocket connection established for "${displayedLoc}" at ${WS_BASE}/ws`);
          // Optionally send initial identification message if needed by your WS server
            // ws.send(JSON.stringify({ type: 'IDENTIFY', location: displayedLoc }));
        };

        // Handle incoming WebSocket messages
        ws.onmessage = (evt) => {
            console.log('WebSocket message received:', evt.data);
            try {
                const msg = JSON.parse(evt.data); // Parse the message assuming it's JSON
                // Update current weather state with real-time data if the format matches
                // Assuming message format from WS server matches the current state structure:
                // { temperature, windSpeed, humidity, conditionCode }

                // build the new incoming “current” object
const curr = {
  temp: msg.temperature,
  wind: msg.windSpeed,
  humidity: msg.humidity,
};

// get the key for this update (e.g. location name or ID)
const key = displayedLoc; 

// compare to previous
const prev = prevWeatherRef.current[key];
if (prev) {
  const diffs: string[] = [];
  if (prev.temp !== curr.temp)
    diffs.push(`Temp ${prev.temp}→${curr.temp}°C`);
  if (prev.wind !== curr.wind)
    diffs.push(`Wind ${prev.wind}→${curr.wind} km/h`);
  if (prev.humidity !== curr.humidity)
    diffs.push(`Humidity ${prev.humidity}→${curr.humidity}%`);

  if (diffs.length) {
    const note = `Update for ${key}: ${diffs.join(', ')}`;
    setNotifications((n) => [note, ...n]);

    // persist to backend
    fetch(`${API_BASE}/api/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationName: key,
        message: diffs.join(', ')
      })
    }).catch(console.error);
  }
}

// store for next time
prevWeatherRef.current[key] = curr;

                if (msg.temperature !== undefined && msg.windSpeed !== undefined && msg.humidity !== undefined && msg.conditionCode !== undefined) {
                  const timeWithMs = msg.updatedAt.split('T')[1];            // "07:59:21.737Z"
                  // "07:59:21.737Z"
                  const time = timeWithMs.split('.')[0]; 
                  const hours =parseInt(time.substring(0, 2));
                  const minutes = parseInt(time.substring(3, 5));
                  const seconds = parseInt(time.substring(6, 8));
                  const final_time = `${hours+2}:${minutes}`; // Format time as "HH:MM:SS" 
                    
                  setCurrent(prev => {
                        // Use functional update to merge with existing state
                        // (Good practice, but simpler to just return new object here if replacing entire state)
                        // You might want to check if msg.locationName matches displayedLoc if your WS server sends it
                        // if (msg.locationName && msg.locationName !== displayedLoc) return prev;
                        return {
                            temp: msg.temperature,
                            wind: msg.windSpeed,
                            humidity: msg.humidity,
                            condition: msg.conditionCode?.toString(),
                            updatedAt: final_time // Ensure condition is string
                        };
                    });
                     console.log(`Current weather updated via WebSocket for "${displayedLoc}".`);
                } else {
                    console.warn("Received unexpected WebSocket message format:", msg);
                }
            } catch (e) {
                console.error("Failed to parse WebSocket message:", e);
            }
        };

        // Handle WebSocket error event
        ws.onerror = (event) => {
            console.error("WebSocket error:", event);
        };

        // Handle WebSocket close event
         ws.onclose = (event) => {
            console.log('WebSocket connection closed:', event.code, event.reason);
            if (event.code !== 1000) { // Code 1000 is a normal closure
                console.warn('WebSocket closed unexpectedly.');
                // Implement reconnect logic if desired (e.g., using a timer),
                // but often a new effect run triggered by state changes handles reconnections.
            }
        };

        // Store the WebSocket instance in the ref
        wsRef.current = ws;
     }


    // --- Cleanup function ---
    // This runs when the component unmounts or when the dependencies (displayedCoords, displayedLoc) change,
    // ensuring the old WebSocket connection is closed cleanly.
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Location change or component unmount'); // Use code 1000 for clean closure
        wsRef.current = null; // Clear the ref
        console.log(`WebSocket connection cleaned up.`);
      }
    };
  }, [displayedCoords, displayedLoc, API_BASE, WS_BASE]); // Effect dependencies: re-run when location or env vars change

  
  // --- Handlers for Search Input and Suggestions ---

  // Handles changes in the search input field
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setInputLoc(query); // Update the input state
      // Only search suggestions if query is not empty
      if (query.length > 0) {
         searchLocationForSuggestions(query); // Trigger geocoding search
      } else {
         setSuggestions([]); // Clear suggestions if input is empty
         setShowSuggestions(false); // Hide suggestions dropdown
      }
  };

  // Handles the search action when the user presses Enter or clicks the Search button
  const handleSearchSubmit = async () => {
      // If input is empty, clear display and show prompt
      if (!inputLoc) {
           setDisplayedCoords(null); // Clear displayed weather if search is empty
           setDisplayedLoc(''); // Clear displayed name
           setSuggestions([]); // Clear suggestions
           setShowSuggestions(false);
           setStatusMessage("Please enter a location name."); // Prompt user
           setCurrent(null); // Clear display
           setForecast([]);
           setIsDisplayedLocationTracked(false);
           return; // Stop the search process
      }

      console.log(`Starting search process for "${inputLoc}"... Checking DB first.`);
      setIsLoadingWeather(true); // Set loading state
      setStatusMessage(null); // Clear previous status/error messages
      setSuggestions([]); // Clear suggestions from previous typing
      setShowSuggestions(false); // Hide suggestions list
       // Clear displayed weather/coords while searching/loading
      setDisplayedCoords(null);
      setCurrent(null);
      setForecast([]);
      setIsDisplayedLocationTracked(false);


      try {
          // 1. Call the backend endpoint to lookup location by name in DB
          const res = await fetch(`${API_BASE}/api/location-lookup?name=${encodeURIComponent(inputLoc)}`);

          if (res.ok) { // Location found in DB
              const locationData = await res.json();
              console.log("Location found in DB:", locationData);
              // Update displayed location and coords from the DB data.
              // This triggers the main useEffect to fetch weather via /api/weather.
              setDisplayedLoc(locationData.name);
              setDisplayedCoords({ lat: locationData.latitude, lon: locationData.longitude });

              setStatusMessage(null); // Clear status message

              // The useEffect triggered by displayedCoords change will now call /api/weather,
              // which will handle fetching from DB (since it's tracked) or API.
              // The /api/weather response includes isTracking status which updates state.

          } else if (res.status === 404) { // Location not found in DB
              console.log(`Location "${inputLoc}" not found in DB. Proceeding with geocoding.`);
              // Clear displayed weather/coords (already done above)

              setDisplayedLoc(inputLoc); // Keep the typed name in displayedLoc temporarily for status message
              setStatusMessage(`"${inputLoc}" not found in DB. Please select from suggestions or map.`); // Inform user

              // 2. Trigger geocoding search again using the input value (fallback)
              searchLocationForSuggestions(inputLoc);

          } else { // Other unexpected HTTP errors from lookup endpoint
               const errorBody = await res.text();
              console.error(`DB Lookup HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
              console.error('Lookup Error body:', errorBody);
              setStatusMessage(`Error during lookup: ${res.status}`);
               // Clear weather/coords on error (already done above)
              setDisplayedLoc(inputLoc); // Keep typed name for error message context
          }
      } catch (err) { // Network or other errors during the fetch call itself
          console.error("Error during DB lookup fetch:", err);
          setStatusMessage("An error occurred during location lookup.");
           // Clear weather/coords on error (already done above)
          setDisplayedLoc(inputLoc); // Keep typed name for error message context
      } finally {
          // Loading state is now primarily managed by the effect triggered by displayedCoords.
          // Only stop loading here if NO weather fetch is about to be triggered (i.e., 404 or other lookup error)
          // If displayedCoords was successfully set, the useEffect handles loading.
          if (!displayedCoords) {
               setIsLoadingWeather(false);
          }
      }
  };


  // Fetches location suggestions from the OpenMeteo Geocoding API
  // Triggered by typing in the search box or after a DB lookup miss.
  const searchLocationForSuggestions = async (query: string) => {
    if (!query) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
    }
    console.log(`Workspaceing geocoding suggestions for "${query}"...`);
    // Do NOT set loading for weather here, only for suggestions if needed separately
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5`
      );
      if (!res.ok) {
           const errorBody = await res.text();
            console.error(`Geocoding API HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
            console.error('Geocoding Error body:', errorBody);
           throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      console.log("Geocoding suggestions received:", data);

      // Process and set the suggestions
      if (data.results && Array.isArray(data.results)) {
        setSuggestions(
          data.results.map((r: any) => ({
            name:
              r.name +
              (r.admin1 ? `, ${r.admin1}` : '') +
              `, ${r.country}`,
            lat: r.latitude,
            lon: r.longitude,
          }))
        );
         // Only show suggestions if there are results
        if (data.results.length > 0) {
           setShowSuggestions(true);
        } else {
           setShowSuggestions(false);
        }
      } else {
           console.warn("Geocoding API returned no results or unexpected format:", data);
           setSuggestions([]);
           setShowSuggestions(false);
      }
    } catch(err) {
      console.error("Failed to fetch suggestions:", err);
      setSuggestions([]);
      setShowSuggestions(false);
       // Optionally set a status message for suggestion fetching errors
    }
  };

  // Handles the selection of a location suggestion from the dropdown
  const handleSelectSuggestion = (s: Suggestion) => {
      console.log("Selected suggestion:", s);
      // Update both input and displayed location name to the suggestion's name
      setInputLoc(s.name);
      setDisplayedLoc(s.name);
      // Update displayed coordinates to the suggestion's coords - this triggers the weather fetch effect
      setDisplayedCoords({ lat: s.lat, lon: s.lon });
      setSuggestions([]); // Clear suggestions
      setShowSuggestions(false); // Hide suggestions list
      setStatusMessage(null); // Clear any status messages
      // setIsLoadingWeather(true); // Loading is set by the effect triggered by displayedCoords
      setIsDisplayedLocationTracked(false); // Assume not tracked until /api/weather confirms
  };


  // Handles a click event on the map
const handleMapClick = useCallback(
    async (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat();
      const lon = e.latLng.lng();
      console.log(`Map clicked at ${lat}, ${lon}.`);

      setIsLoadingWeather(true);
      setStatusMessage(null);
      setSuggestions([]);
      setShowSuggestions(false);
      setInputLoc('Identifying location...');
      setDisplayedCoords(null);
      setCurrent(null);
      setForecast([]);
      setIsDisplayedLocationTracked(false);

      // Attempt reverse geocode, but always return a string
      const name = await reverseGeocodeCoords(lat, lon);
      console.log('Reverse geocoded name:', name);

      setInputLoc(name);
      setDisplayedLoc(name);
      setDisplayedCoords({ lat, lon });
    },
    []
  );

  // Helper function to perform reverse geocoding using OpenMeteo Geocoding API
     const reverseGeocodeCoords = async (lat: number, lon: number): Promise<string> => {
    console.log(`Reverse geocoding ${lat}, ${lon}...`);
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat}&longitude=${lon}&count=1`
      );
      if (!res.ok) {
        console.warn(
          `Reverse Geocoding HTTP error ${res.status}: ${res.statusText}. Falling back to coordinates.`
        );
        return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
      }
      const data = await res.json();
      console.log('Reverse geocoding result:', data);

      if (Array.isArray(data.results) && data.results.length > 0) {
        const r = data.results[0];
        // Ensure name exists
        const namePart = r.name || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        const admin = r.admin1 ? `, ${r.admin1}` : '';
        return `${namePart}${admin}, ${r.country}`;
      } else {
        console.warn('No results from reverse geocoding; falling back to coordinates');
        return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
      }
    } catch (err) {
      console.error('Failed to reverse geocode, using fallback:', err);
      return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    }
  };


  // Effect to hide suggestions dropdown when clicking outside the search area
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const searchArea = document.getElementById('search-area');
       // Use composedPath to handle clicks inside shadow DOM if necessary, else e.target
      const path = e.composedPath ? e.composedPath() : [];
      const clickedElement = e.target as Node;

       // Check if the click is outside the search area AND suggestions are currently visible
       // `searchArea.contains(clickedElement)` is the standard check.
       // `path.some(...)` is a fallback/alternative that can help with certain DOM structures.
      if (showSuggestions && searchArea && !searchArea.contains(clickedElement) && !path.some(node => node === searchArea))
        setShowSuggestions(false);
    };
    // Use capture phase (true) to ensure this handler runs before potential clicks *inside* the suggestions list,
    // which allows `handleSelectSuggestion`'s onMouseDown to fire first.
    document.addEventListener('mousedown', handler, true);
    // Cleanup function to remove the event listener
    return () =>
      document.removeEventListener('mousedown', handler, true);
  }, [showSuggestions]); // Depend on showSuggestions so handler is correctly set/removed


  // --- Handler for the Track button ---
  // Sends the currently displayed location's details to the backend to mark it as tracked.
  const handleTrackLocation = async () => {
       // Use the displayed location name and coords for tracking
      if (!displayedLoc || !displayedCoords) {
          console.warn("No displayed location to track.");
          alert("Please select or search for a location first."); // Simple user feedback
          return;
      }

      console.log(`Attempting to track location: "${displayedLoc}" (${displayedCoords.lat}, ${displayedCoords.lon})...`);
       // Optionally show a tracking state/spinner on the button (beyond just disabled state)

      try {
          // Make the HTTP POST request to your backend's track API route
          const response = await fetch(`${API_BASE}/api/track`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  // Add Authorization header if your backend requires authentication
                  // 'Authorization': `Bearer ${yourAuthToken}`,
              },
              body: JSON.stringify({
                  location: displayedLoc, // Use the displayed name
                  lat: displayedCoords.lat, // Use the displayed coords
                  lon: displayedCoords.lon,
                  // Potentially add a user identifier if you have authentication
              }),
          });

          if (response.ok) {
              const result = await response.json(); // Assuming backend returns success message/data
              console.log(`Location "${displayedLoc}" successfully sent to backend for tracking.`, result);
              // Update frontend state to reflect that the displayed location is now tracked
              setIsDisplayedLocationTracked(true);
              alert(`Location "${displayedLoc}" is now being tracked!`); // Simple user feedback
          } else {
               const errorBody = await response.text(); // Attempt to read error body
              console.error(`Failed to send location "${displayedLoc}" for tracking. Status: ${response.status}`);
              console.error('Track Error body:', errorBody);
               alert(`Failed to track location "${displayedLoc}". Please try again. Error: ${response.status}`); // Simple user feedback
          }
      } catch (err) { // Network or other error during the fetch call
          console.error(`Error sending location "${displayedLoc}" for tracking:`, err);
           alert(`An error occurred while trying to track location "${displayedLoc}".`); // Simple user feedback
      }
  };

  
// Inside your component, before the return:
const nextSixDays = forecast.slice(1, 7);

return (
  <>
    {/* Toggle Notifications */}
    <button
      className="flex absolute top-4 right-4 p-2 bg-gray-800/90 rounded-full hover:bg-gray-800/90 z-20"
      onClick={() => setShowNotifications(v => !v)}
    >
      <span className="hidden lg:inline text-yellow-400 mx-2">Notifications</span>
      <Bell className="w-6 h-6 text-white" />
    </button>

    {/* Notifications Panel */}
    <NotificationsPanel
      isOpen={showNotifications}
      notifications={notifications}
      onClose={() => setShowNotifications(false)}
    />

    {/* Sidebar for tracked locations */}
    <TrackedLocationsSidebar
      onSelectLocation={handleSelectTracked}
      activeLocationId={selectedLocationId ?? undefined}
    />

    {/* Map Background */}
    <div className="absolute inset-0 z-0">
      <MapComponent
        onMapClick={handleMapClick}
        center={mapCenter}
        zoom={mapCenter ? 10 : 2}
      />
    </div>

    {/* Main Content */}
    <main className="absolute inset-x-0 top-0 p-4 z-10 mx-auto max-w-xs sm:max-w-md">
      <div className="space-y-4">
        {/* Search Input & Suggestions */}
        <div id="search-area" className="relative">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex w-[60%] sm:w-full mx-auto bg-gray-800/60 backdrop-blur-sm rounded-full overflow-hidden"
          >
            <input
              type="text"
              value={inputLoc}
              onChange={handleInputChange}
              onFocus={() => {
                if (inputLoc.length > 0 || suggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              placeholder="Search City"
              className="flex-grow px-4 py-2 bg-transparent placeholder-gray-400 text-white outline-none"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearchSubmit();
                }
              }}
            />
            <button
              onClick={handleSearchSubmit}
              className="p-2 bg-teal-400/80 hover:bg-teal-400/100 transition flex items-center justify-center"
              disabled={isLoadingWeather}
            >
              {isLoadingWeather ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : (
                <Search className="w-5 h-5 text-white" />
              )}
            </button>
          </motion.div>

          <AnimatePresence>
            {showSuggestions && suggestions.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.3 }}
                className="absolute top-full left-0 right-0 mt-1 bg-gray-800/70 backdrop-blur-sm rounded-lg overflow-auto max-h-40 shadow-lg z-20 text-white"
              >
                {suggestions.map((s, i) => (
                  <li
                    key={i}
                    onMouseDown={() => handleSelectSuggestion(s)}
                    className="px-4 py-2 cursor-pointer hover:bg-gray-700/80 border-b border-gray-600 last:border-b-0"
                  >
                    {s.name}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        {/* Status / Loading */}
        {(statusMessage && !current) || isLoadingWeather ? (
          <AnimatePresence mode="wait">
            {isLoadingWeather ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex justify-center items-center text-white mt-2 p-4 bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-lg"
              >
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span>{statusMessage || 'Loading weather...'}</span>
              </motion.div>
            ) : (
              <motion.div
                key="status"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center text-white text-sm mt-2 p-4 bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-lg"
              >
                {statusMessage}
              </motion.div>
            )}
          </AnimatePresence>
        ) : null}

        {/* Current Weather */}
        {current && !statusMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="space-y-4 p-4 bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-lg"
          >
            <div className="text-center">
              <h1 className="text-4xl font-extrabold text-white drop-shadow-lg inline-flex items-center space-x-2">
                <span>{displayedLoc.split(',')[0]}</span>
                <AnimatePresence>
                  {isDisplayedLocationTracked && (
                    <motion.span
                      key="tracked-star"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={{ duration: 0.2 }}
                      title="This location is tracked"
                    >
                      <Star className="w-6 h-6 text-yellow-400 fill-yellow-400" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </h1>
              {displayedLoc.includes(',') && <p className="text-white text-sm opacity-80">{displayedLoc}</p>}
              <p className="mt-2 inline-flex items-center space-x-2 text-white">
                {getWeatherIcon(current.condition)}
                <span className="text-xl font-semibold">{weatherCodeMap[current.condition] || 'Unknown'}</span>
              </p>
            </div>
            <div className="flex justify-center">
              <span className="text-7xl font-bold text-white drop-shadow-xl">{Math.round(current.temp)}°C</span>
            </div>
            <div className="flex justify-around text-white">
              <div className="flex flex-col items-center">
                <Droplet className="w-5 h-5" />
                <span className="mt-1 text-sm">{current.humidity ?? '--'}%</span>
              </div>
              <div className="flex flex-col items-center">
                <Wind className="w-5 h-5" />
                <span className="mt-1 text-sm">{Math.round(current.wind)} km/h</span>
              </div>
            </div>
            <div className="flex justify-center">
              <p className="font-medium text-md text-yellow-500">
                Last updated at: {current.updatedAt ?? 'Location not being tracked'}
              </p>
            </div>

            {/* Forecast & Chart Controls */}
            <div className="flex justify-center">
              {forecast.length > 0 && (
                <motion.button
                  layout
                  onClick={() => { setShowChart(false); setShowFullForecast(!showFullForecast); }}
                  className="w-full flex items-center justify-center text-white bg-gray-700/50 hover:bg-gray-700/70 transition py-2 rounded-lg mt-4"
                >
                  {showFullForecast ? <ChevronUp className="w-5 h-5 mr-1" /> : <ChevronDown className="w-5 h-5 mr-1" />}
                  {showFullForecast ? 'Hide Forecast' : `Show ${nextSixDays.length}-Day Forecast`}
                </motion.button>
              )}
              <button
                onClick={() => { setShowFullForecast(false); setShowChart(prev => !prev); }}
                className="text-sm text-white bg-teal-400/80 hover:bg-teal-400/100 px-2 py-2 rounded-lg mt-4 mx-2 text-nowrap transition"
              >
                {showChart ? 'Hide Chart' : 'Show Chart'}
              </button>
            </div>

            {/* Forecast Display */}
            <AnimatePresence>
              {showFullForecast && nextSixDays.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.4, ease: 'easeInOut' }}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 md:gap-4 lg:grid-cols-6 lg:gap-4 overflow-hidden pt-4 border-t border-gray-700/50"
                >
                  {nextSixDays.map((f, i) => (
                    <motion.div
                      key={f.day + i}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="bg-gray-700/50 rounded-xl p-2 sm:p-3 flex flex-col items-center text-center text-white text-xs sm:text-sm break-words"
                    >
                      <span className="font-medium mb-1 truncate">{f.day}</span>
                      {getWeatherIcon(f.weatherCode, 'w-6 h-6')}
                      <span className="mt-1">{Math.round(f.max)}° / {Math.round(f.min)}°</span>
                    </motion.div>
                  ))}
                </motion.div>
              )}
              <div>
                <ChartComponent data={forecast} visible={showChart} />
              </div>
            </AnimatePresence>

            {/* Track Button */}
            <motion.button
              onClick={handleTrackLocation}
              disabled={!displayedLoc || !displayedCoords || isDisplayedLocationTracked}
              className={`w-full flex items-center justify-center text-white transition py-2 rounded-lg mt-4 font-semibold
                ${!displayedLoc || !displayedCoords || isDisplayedLocationTracked
                  ? 'bg-gray-600/50 cursor-not-allowed'
                  : 'bg-teal-400/80 hover:bg-teal-400/100'}`}
            >
              {isDisplayedLocationTracked ? (
                <>
                  <Star className="w-5 h-5 mr-2 fill-yellow-400 text-yellow-400" />Tracking
                </>
              ) : 'Track Location'}
            </motion.button>
          </motion.div>
        )}
      </div>
    </main>
  </>
);

  // --- Render ---
}