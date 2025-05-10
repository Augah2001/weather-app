// app/components/HomePage.tsx

'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'; // Added useMemo

import dynamic from 'next/dynamic';

import { motion, AnimatePresence } from 'framer-motion';

import { Search, Droplet, Wind, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'; // Added Loader2

import { weatherCodeMap, getWeatherIcon } from './WeatherHelpers';

type Suggestion = { name: string; lat: number; lon: number };
type LocationCoords = { lat: number; lon: number };

// Assuming MapComponent exists and is correctly implemented
const MapComponent = dynamic(() => import('./MapComponent'), { ssr: false });

export default function HomePage() {
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE_URL || '';

  const wsRef = useRef<WebSocket | null>(null);

  // State for the search input value
  const [inputLoc, setInputLoc] = useState('Harare');
  // State for the name of the location whose weather is currently displayed
  const [displayedLoc, setDisplayedLoc] = useState('Harare');
  // State for the coordinates of the location whose weather is currently displayed - this triggers weather fetches
  const [displayedCoords, setDisplayedCoords] = useState<LocationCoords | null>({ lat: -17.8252, lon: 31.0335 });
   // State for the map center, can be different from displayedCoords during interaction
   const mapCenter = useMemo(() => displayedCoords || { lat: 0, lon: 0 }, [displayedCoords]);


  const [current, setCurrent] = useState<{
    temp: number;
    wind: number;
    humidity: number;
    condition: string; // Expecting WMO code as string or number
  } | null>(null);

  const [forecast, setForecast] = useState<
    { day: string; max: number; min: number; weatherCode: string | number }[]
  >([]);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // State for forecast visibility toggle
  const [showFullForecast, setShowFullForecast] = useState(false);

  // Loading state for weather data fetch
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);
  // State for displaying status messages (e.g., "Location not found in DB")
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // --- Effect to fetch weather data when displayedCoords changes ---
  useEffect(() => {
    // Only fetch if we have coordinates to fetch for
    if (!displayedCoords) {
        console.log("Displayed coords not set, clearing weather.");
        setCurrent(null);
        setForecast([]);
        // Close WebSocket if we lose the displayed location
         if (wsRef.current) {
            wsRef.current.close(1000, 'No displayed location');
            wsRef.current = null;
        }
        return; // Exit if no coords
    }

    // Also require displayedLoc to be set for the WS connection and backend API call
    if (!displayedLoc) {
         console.warn("Displayed coords set but displayedLoc is missing, skipping fetch/WS.");
         // Decide how to handle this case - maybe reverse geocode here?
         // For now, exit and clear state.
         setCurrent(null);
         setForecast([]);
         if (wsRef.current) {
            wsRef.current.close(1000, 'Displayed location name missing');
            wsRef.current = null;
        }
         return;
    }


    setIsLoadingWeather(true);
    setStatusMessage(null); // Clear previous status messages

    // Close existing socket when displayed location changes
    if (wsRef.current) {
      wsRef.current.close(1000, 'Displayed location changed'); // Clean closure code
      wsRef.current = null;
      console.log('Closed existing WebSocket connection due to coords change.');
    }

    // --- Fetch weather data by coordinates ---
    const fetchWeatherByCoords = async () => {
      console.log(`Workspaceing weather data for "${displayedLoc}" (${displayedCoords.lat}, ${displayedCoords.lon})...`);
      try {
        // Call the backend endpoint that fetches weather by lat/lon (from API, upserts DB)
        // IMPORTANT: Include the location name here as the backend /api/weather expects it now
        const res = await fetch(
          `${API_BASE}/api/weather?location=${encodeURIComponent(displayedLoc)}&lat=${displayedCoords.lat}&lon=${displayedCoords.lon}`
        );

        if (!res.ok) {
           const errorBody = await res.text(); // Try to read error body
          console.error(`Weather by Coords HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
          console.error('Weather by Coords Error body:', errorBody);
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const weatherData = await res.json();
        console.log("Received weather data by coords:", weatherData);


        // Update current weather state
        setCurrent({
          temp: weatherData.temperature,
          wind: weatherData.windSpeed,
          humidity: weatherData.humidity,
          condition: weatherData.conditionCode?.toString(), // Ensure condition is string if WeatherHelpers expects string
        });

        // Update forecast state
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

         console.log(`Successfully updated weather data.`);

      } catch (err) {
        console.error("Failed to fetch weather data by coords:", err);
        setCurrent(null);
        setForecast([]);
        setStatusMessage("Failed to load weather data."); // Show error message
      } finally {
          setIsLoadingWeather(false);
      }
    };

    fetchWeatherByCoords(); // Call the async function to fetch data

    // --- Open WS for real-time pushes ---
    // Connect directly to the separate WS server process using WS_BASE
    // WS connection depends on the *displayed* location name
     if (displayedLoc) { // Only connect if we have a location name to subscribe with
        const ws = new WebSocket(`${WS_BASE}/ws?location=${encodeURIComponent(displayedLoc)}`);

        ws.onopen = () => {
            console.log(`WebSocket connection established for "${displayedLoc}" at ${WS_BASE}/ws`);
            // Optionally send initial identification message if needed by your WS server
            // ws.send(JSON.stringify({ type: 'IDENTIFY', location: displayedLoc }));
        };

        ws.onmessage = (evt) => {
            console.log('WebSocket message received:', evt.data);
            try {
                const msg = JSON.parse(evt.data);
                // Update current weather state with real-time data
                // Assuming message format from WS server matches the current state structure
                // { temperature, windSpeed, humidity, conditionCode }
                if (msg.temperature !== undefined && msg.windSpeed !== undefined && msg.humidity !== undefined && msg.conditionCode !== undefined) {
                    setCurrent(prev => { // Use functional update to merge with existing state if needed
                        return {
                            temp: msg.temperature,
                            wind: msg.windSpeed,
                            humidity: msg.humidity,
                            condition: msg.conditionCode?.toString(),
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

        ws.onerror = (event) => {
            console.error("WebSocket error:", event);
        };

         ws.onclose = (event) => {
            console.log('WebSocket connection closed:', event.code, event.reason);
            if (event.code !== 1000) {
                console.warn('WebSocket closed unexpectedly.');
                // Implement reconnect logic if desired, but typically a new effect run handles this
            }
        };

        wsRef.current = ws;
     }


    // Cleanup function to close WebSocket on component unmount or displayedCoords change
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Location change or component unmount'); // Clean closure code and reason
        wsRef.current = null;
        console.log(`WebSocket connection cleaned up.`);
      }
    };
  }, [displayedCoords, displayedLoc, API_BASE, WS_BASE]); // Effect depends on displayedCoords, displayedLoc, env vars


    // --- Handlers for Search Input and Suggestions ---

    // Handle input change - updates inputLoc and triggers geocoding suggestions
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value;
        setInputLoc(query);
        // Only search suggestions if query is not empty
        if (query.length > 0) {
           searchLocationForSuggestions(query);
        } else {
           setSuggestions([]);
           setShowSuggestions(false);
        }
    };

    // Handle search submission (e.g., pressing Enter or clicking a Search button)
    const handleSearchSubmit = async () => {
        if (!inputLoc) {
             setDisplayedCoords(null); // Clear displayed weather if search is empty
             setDisplayedLoc(''); // Clear displayed name
             setSuggestions([]); // Clear suggestions
             setShowSuggestions(false);
             setStatusMessage(null); // Clear status
             return;
        }

        console.log(`Searching for location "${inputLoc}" in DB...`);
        setIsLoadingWeather(true);
        setStatusMessage(null); // Clear previous status/error messages
        setSuggestions([]); // Clear suggestions from previous typing
        setShowSuggestions(false); // Hide suggestions list

        try {
            // Call the backend endpoint to lookup location by name in DB
            const res = await fetch(`${API_BASE}/api/location-lookup?name=${encodeURIComponent(inputLoc)}`);

            if (res.ok) { // Location found in DB
                const locationData = await res.json();
                console.log("Location found in DB:", locationData);
                // Update displayed location and coords from DB data
                setDisplayedLoc(locationData.name);
                setDisplayedCoords({ lat: locationData.latitude, lon: locationData.longitude });
                // Effect triggered by displayedCoords change will fetch weather by coords (which will use API and update DB if stale)
                setStatusMessage(null); // Clear status message
            } else if (res.status === 404) { // Location not found in DB
                console.log(`Location "${inputLoc}" not found in DB. Proceeding with geocoding.`);
                // Clear displayed weather/coords as name wasn't found (important!)
                setDisplayedCoords(null);
                setCurrent(null); // Clear current weather display immediately
                setForecast([]); // Clear forecast display immediately

                setDisplayedLoc(inputLoc); // Keep the typed name in displayedLoc temporarily for status message
                setStatusMessage(`"${inputLoc}" not found in DB. Please select from suggestions.`); // Inform user

                // Trigger geocoding search again using the input value
                searchLocationForSuggestions(inputLoc);

            } else { // Other HTTP errors from lookup
                 const errorBody = await res.text();
                console.error(`DB Lookup HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
                console.error('Lookup Error body:', errorBody);
                setStatusMessage(`Error during lookup: ${res.status}`);
                 // Clear weather/coords on error
                 setDisplayedCoords(null);
                 setCurrent(null);
                 setForecast([]);
                 setDisplayedLoc(inputLoc);
            }
        } catch (err) {
            console.error("Error during DB lookup:", err);
            setStatusMessage("An error occurred during location lookup.");
             // Clear weather/coords on error
             setDisplayedCoords(null);
             setCurrent(null);
             setForecast([]);
             setDisplayedLoc(inputLoc);
        } finally {
            // setIsLoadingWeather(false); // Loading is handled by the effect triggered by displayedCoords
            // Only turn off loading here if 404 or error occurred and effect didn't trigger fetch
            if (!displayedCoords && !statusMessage) { // If coords wasn't set by lookup success
                 setIsLoadingWeather(false);
            }
        }
    };


    // Handle selecting a suggestion from the dropdown
    const handleSelectSuggestion = (s: Suggestion) => {
        console.log("Selected suggestion:", s);
        // Update both input and displayed location name
        setInputLoc(s.name);
        setDisplayedLoc(s.name);
        // Update displayed coordinates - this triggers the weather fetch effect
        setDisplayedCoords({ lat: s.lat, lon: s.lon });
        setSuggestions([]); // Clear suggestions
        setShowSuggestions(false); // Hide suggestions list
        setStatusMessage(null); // Clear any status messages
        // setIsLoadingWeather(true); // Loading is set by the effect
    };

     // Geocoding suggestions fetch (mostly unchanged, triggered by input or DB miss)
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


  // Handle Map Click
  const handleMapClick = useCallback(
    async (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;

      const lat = e.latLng.lat();
      const lon = e.latLng.lng();
      console.log(`Map clicked at ${lat}, ${lon}.`);

      setIsLoadingWeather(true); // Show loading while processing map click
      setStatusMessage(null); // Clear status
      setSuggestions([]); // Clear suggestions
      setShowSuggestions(false); // Hide suggestions list
      setInputLoc("Identifying location..."); // Show temporary text in input

      try {
          // Reverse geocode to get location name
          const name = await reverseGeocodeCoords(lat, lon);
          console.log("Reverse geocoded name:", name);

          // Update input and displayed location name
          setInputLoc(name);
          setDisplayedLoc(name);
          // Update displayed coordinates - this triggers the weather fetch effect
          setDisplayedCoords({ lat, lon });

      } catch (error) {
          console.error("Error handling map click:", error);
          setStatusMessage("Could not identify location from map click.");
          // Decide if you want to clear displayedCoords or try to fetch with coords only
          setDisplayedCoords(null); // Clear weather on error
          setDisplayedLoc("Unknown Location"); // Set a placeholder name
          setInputLoc("Error identifying location"); // Set input to reflect error
          setIsLoadingWeather(false); // Stop loading if reverse geocode fails
      }
      // Weather fetch loading is handled by the effect triggered by displayedCoords
    },
    [] // Dependencies are empty
  );

   // Reverse Geocoding helper (used by map click)
  const reverseGeocodeCoords = async (lat: number, lon: number) => {
      console.log(`Reverse geocoding ${lat}, ${lon}...`);
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat}&longitude=${lon}&count=1`
        );
         if (!res.ok) {
              const errorBody = await res.text();
               console.error(`Reverse Geocoding API HTTP error! status: ${res.status}, statusText: ${res.statusText}`);
               console.error('Reverse Geocoding Error body:', errorBody);
              throw new Error(`HTTP error! status: ${res.status}`);
         }
        const data = await res.json();
        console.log("Reverse geocoding result:", data);

        if (data.results?.length) {
          const r = data.results[0];
          return (
            r.name +
            (r.admin1 ? `, ${r.admin1}` : '') +
            `, ${r.country}`
          );
        }
      } catch(err) {
          console.error("Failed to reverse geocode:", err);
          throw err; // Re-throw to be caught by handleMapClick
      }
      // Return a default name if API succeeds but finds nothing
      return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    };


  // Hide suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const searchArea = document.getElementById('search-area');
       // Use composedPath to handle clicks inside shadow DOM if necessary, else e.target
      const path = e.composedPath ? e.composedPath() : [];
      const clickedElement = e.target as Node;

       // Check if the click is outside the search area AND suggestions are visible
       // Check if searchArea exists and if the click path/target is NOT inside searchArea
      if (showSuggestions && searchArea && !searchArea.contains(clickedElement) && !path.some(node => node === searchArea))
        setShowSuggestions(false);
    };
    // Use capture phase to ensure handler runs before potential clicks inside suggestions list
    document.addEventListener('mousedown', handler, true);
    return () =>
      document.removeEventListener('mousedown', handler, true);
  }, [showSuggestions]); // Depend on showSuggestions so handler is correctly set/removed


  // --- Handler for the Track button ---
  const handleTrackLocation = async () => {
       // Use the displayed location name and coords for tracking
      if (!displayedLoc || !displayedCoords) {
          console.warn("No displayed location to track.");
          alert("Please select or search for a location first."); // Simple user feedback
          return;
      }

      console.log(`Attempting to track location: "${displayedLoc}" (${displayedCoords.lat}, ${displayedCoords.lon})...`);

      try {
          // POST to the /api/track endpoint with the displayed location details
          const response = await fetch(`${API_BASE}/api/track`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  // Add Authorization header if your backend requires authentication
              },
              body: JSON.stringify({
                  location: displayedLoc, // Use displayed name
                  lat: displayedCoords.lat,
                  lon: displayedCoords.lon,
                  // Potentially add a user identifier if you have authentication
              }),
          });

          if (response.ok) {
              const result = await response.json();
              console.log(`Location "${displayedLoc}" successfully sent to backend for tracking.`, result);
              alert(`Location "${displayedLoc}" is now being tracked!`); // Simple user feedback
              // Optionally update UI state if location is now explicitly marked as tracked
          } else {
               const errorBody = await response.text();
              console.error(`Failed to send location "${displayedLoc}" for tracking. Status: ${response.status}`);
              console.error('Track Error body:', errorBody);
               alert(`Failed to track location "${displayedLoc}". Please try again. Error: ${response.status}`); // Simple user feedback
          }
      } catch (err) {
          console.error(`Error sending location "${displayedLoc}" for tracking:`, err);
           alert(`An error occurred while trying to track location "${displayedLoc}".`); // Simple user feedback
      }
  };


  // --- Render ---
  return (
    <>
      {/* Map Component - Uncomment and position as needed */}
      {/* Make sure to pass necessary props like center and zoom */}
       {/* <div className="absolute inset-0 z-0">
          <MapComponent onMapClick={handleMapClick} center={mapCenter} zoom={mapCenter ? 10 : 2} />
       </div> */}


      {/* Main content container positioned over the map or as the main layout */}
      <main className="absolute top-0 left-0 right-0 p-4 z-10 max-w-md mx-auto">
        <div className="space-y-4">
          {/* Search Input Area */}
          <div id="search-area" className="relative">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="flex bg-gray-800/60 backdrop-blur-sm rounded-full overflow-hidden"
            >
              <input
                type="text"
                value={inputLoc} // Bind input to inputLoc state
                onChange={handleInputChange} // Use the new handler
                 onFocus={() => {
                     // Show suggestions on focus if input has content or if there are suggestions already
                     if (inputLoc.length > 0 || suggestions.length > 0) {
                         setShowSuggestions(true);
                     }
                 }}
                 // onBlur is handled by the outside click effect with capture phase
                 placeholder="Search City"
                 className="flex-grow px-4 py-2 bg-transparent placeholder-gray-400 text-white outline-none"
                 // Handle Enter key press to trigger search submission
                 onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                       e.preventDefault(); // Prevent default form submission if input is in a form
                       handleSearchSubmit(); // Trigger the DB lookup/geocoding flow
                    }
                 }}
              />
              {/* Search Button */}
               <button
                   onClick={handleSearchSubmit} // Trigger search submission on click
                   className="p-2 bg-teal-400/80 hover:bg-teal-400/100 transition flex items-center justify-center"
                   // Disable button while waiting for initial lookup/fetch
                   disabled={isLoadingWeather}
                >
                   {/* Show loading spinner ONLY when isLoadingWeather is true */}
                   {isLoadingWeather ? (
                       <Loader2 className="w-5 h-5 text-white animate-spin" />
                   ) : (
                        <Search className="w-5 h-5 text-white" />
                   )}
                </button>
            </motion.div>

            <AnimatePresence>
              {/* Show suggestions only if showSuggestions is true AND there are suggestions */}
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
                      // Use onMouseDown instead of onClick to ensure it fires before input blur
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

           {/* Status Message Display */}
           {/* Show status message or loading spinner depending on state */}
            {statusMessage || isLoadingWeather ? (
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
                            <span>Loading weather...</span>
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
            ) : null /* Don't render anything if no status and not loading */}


          {/* Weather Display (Show only if current data exists and not loading/showing status) */}
          {current && !isLoadingWeather && !statusMessage ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }} // Reduced delay since we have separate loading indicator
              className="space-y-4 p-4 bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-lg"
            >
              <div className="text-center">
                {/* Display the name of the location whose weather is loaded */}
                <h1 className="text-4xl font-extrabold text-white drop-shadow-lg">
                  {displayedLoc.split(',')[0]}
                </h1>
                 {/* Display full location name below if different from primary */}
                {displayedLoc.split(',').length > 1 && (
                     <p className="text-white text-sm opacity-80">{displayedLoc}</p>
                )}

                <p className="mt-2 inline-flex items-center space-x-2 text-white">
                  {/* Assuming getWeatherIcon and weatherCodeMap handle WMO codes */}
                  {getWeatherIcon(current.condition)}
                  <span className="text-xl font-semibold">
                    {/* Find descriptive text from map using WMO code */}
                    {weatherCodeMap[current.condition] || 'Unknown Condition'}
                  </span>
                </p>
              </div>

              <div className="flex justify-center">
                <span className="text-7xl font-bold text-white drop-shadow-xl">
                  {Math.round(current.temp)}°C
                </span>
              </div>

              <div className="flex justify-around text-white">
                <div className="flex flex-col items-center">
                  <Droplet className="w-5 h-5" />
                  <span className="mt-1 text-sm">
                    {current.humidity ?? '--'}%
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <Wind className="w-5 h-5" />
                  <span className="mt-1 text-sm">
                    {Math.round(current.wind)} km/h
                  </span>
                </div>
              </div>

               {/* Forecast Toggle Button */}
               {/* Only show toggle if there's forecast data */}
               {forecast.length > 0 && (
                   <motion.button
                        layout // Helps animate the button position
                        onClick={() => setShowFullForecast(!showFullForecast)}
                        className="w-full flex items-center justify-center text-white bg-gray-700/50 hover:bg-gray-700/70 transition py-2 rounded-lg mt-4"
                    >
                        {showFullForecast ? (
                            <ChevronUp className="w-5 h-5 mr-1" />
                        ) : (
                            <ChevronDown className="w-5 h-5 mr-1" />
                        )}
                        {/* Use actual number of forecast days available */}
                        {showFullForecast ? 'Hide Forecast' : `Show ${forecast.length}-Day Forecast`}
                    </motion.button>
               )}


               {/* Forecast Display (Conditional) */}
               <AnimatePresence>
                {/* Show forecast only if showFullForecast is true AND there's forecast data */}
                {showFullForecast && forecast.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                         // Use a max-height transition for smoother animation than 'auto'
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                         // overflow-hidden is important for height animation
                        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 overflow-hidden pt-4 border-t border-gray-700/50"
                    >
                        {/* Map over all available forecast days */}
                        {forecast.map((f, i) => (
                        <motion.div
                            key={f.day + i} // Use day and index for a more unique key
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }} // Stagger animation
                            className="bg-gray-700/50 rounded-xl p-3 flex flex-col items-center text-center text-white text-sm"
                        >
                            <span className="font-medium mb-1">{f.day}</span>
                             {/* Assuming getWeatherIcon handles WMO codes */}
                            {getWeatherIcon(f.weatherCode, 'w-6 h-6')} {/* Pass size class */}
                            <span className="mt-1">
                             {/* Ensure temps are numbers and round */}
                            {Math.round(f.max)}°/{Math.round(f.min)}°
                            </span>
                        </motion.div>
                        ))}
                    </motion.div>
                )}
               </AnimatePresence>

               {/* Track Button */}
                <motion.button
                    onClick={handleTrackLocation}
                     // Disable if no weather is currently displayed
                    disabled={!displayedLoc || !displayedCoords}
                    className={`w-full flex items-center justify-center text-white transition py-2 rounded-lg mt-4 font-semibold
                        ${!displayedLoc || !displayedCoords ? 'bg-gray-600/50 cursor-not-allowed' : 'bg-teal-400/80 hover:bg-teal-400/100'}`}
                >
                    Track Location
                </motion.button>


            </motion.div>
          ) : null /* Weather display section is null when loading or status is shown, or no weather loaded */}
        </div>
      </main>

       {/* Map Component (if uncommented) */}
       {/* Make sure to pass necessary props like center and zoom */}
       {/* <div className="absolute inset-0 z-0">
          <MapComponent onMapClick={handleMapClick} center={mapCenter} zoom={mapCenter ? 10 : 2} />
       </div> */}
    </>
  );
}