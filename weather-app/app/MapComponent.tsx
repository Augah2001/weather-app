// components/MapComponent.tsx
'use client';
import { useRef, useCallback, useEffect } from 'react';
import { GoogleMap, useLoadScript, Marker } from '@react-google-maps/api';

const containerStyle = {
  width: '100vw',
  height: '100vh',
  position: 'fixed',
  top: 0,
  left: 0,
  zIndex: -1,
};
const mapOptions = {
  disableDefaultUI: true,
  zoomControl: false,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: false,
};

type MapProps = {
  center: { lat: number; lon: number };
  onMapClick: (e: google.maps.MapMouseEvent) => void;
  zoom?: number;
};

export default function MapComponent({ center, onMapClick, zoom = 10 }: MapProps) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_Maps_API_KEY!,
  });

  // Ref to hold the map instance
  const mapRef = useRef<google.maps.Map | null>(null);

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  // Pan smoothly whenever center changes
  useEffect(() => {
    if (mapRef.current) {
      // panTo produces a smooth animation
      mapRef.current.panTo({ lat: center.lat, lng: center.lon });
    }
  }, [center]);

  if (loadError) return <div className="text-red-500">Map load error</div>;
  if (!isLoaded) return <div className="text-white">Loading map...</div>;

  const handleMapClick = (e: google.maps.MapMouseEvent) => {
    if (e.latLng) {
      const lat = e.latLng.lat();
      const lon = e.latLng.lng();
      console.log('Map clicked at:', { lat, lon });
    }
    onMapClick(e);
  };

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={{ lat: center.lat, lng: center.lon }}
      zoom={zoom}
      options={mapOptions}
      onClick={handleMapClick}
      onLoad={onLoad}
      onUnmount={onUnmount}
    >
      <Marker position={{ lat: center.lat, lng: center.lon }} />
    </GoogleMap>
  );
}