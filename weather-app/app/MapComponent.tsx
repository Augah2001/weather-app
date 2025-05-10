// components/MapComponent.tsx
'use client';
import { GoogleMap, useLoadScript, Marker } from '@react-google-maps/api';
import type { MouseEvent } from 'react';

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
  coords: { lat: number; lon: number };
  onClick: (e: google.maps.MapMouseEvent) => void;
};

export default function MapComponent({ coords, onClick }: MapProps) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_Maps_API_KEY!,
  });
  if (loadError) return <div className="text-red-500">Map load error</div>;
  if (!isLoaded) return <div className="text-white">Loading map...</div>;

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={{ lat: coords.lat, lng: coords.lon }}
      zoom={10}
      options={mapOptions}
      onClick={onClick}
    >
      <Marker position={{ lat: coords.lat, lng: coords.lon }} />
    </GoogleMap>
  );
}