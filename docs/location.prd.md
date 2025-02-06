**Location & Map Services -- PRD**
=================================

**1. Overview**
--------------

This document outlines the requirements and implementation for the **location and map services** that provide core location functionality for the application. The system consists of two main services:

1. **LocationService**: A singleton service managing location state and tracking
2. **MapService**: A service managing map display and interaction

These services work together to provide a seamless location-based experience while handling:
- User location tracking
- Map visualization
- Location permissions
- Geocoding
- Search functionality
- Debug/testing support

**2. LocationService**
---------------------

### 2.1 Core Features

The LocationService is a singleton that manages:

- User's current location tracking
- Location caching in localStorage
- Debug location overrides
- Map location management
- Location change notifications
- Permission handling

### 2.2 Location States

```typescript
enum UserLocationStatus {
    UNKNOWN = 'unknown',
    REQUESTED = 'requested', 
    GRANTED = 'granted',
    DENIED = 'denied',
    TIMED_OUT = 'timed out'
}

interface LatLng {
    lat: number;
    lng: number;
}
```

### 2.3 Core State Management

LocationService maintains several key states:

```typescript
class LocationService {
    private _userLocation: LatLng | null;
    private _userLocationCached: LatLng | null;
    private _userLocationCachedTS: number | null;
    private _debugUserLocation: LatLng | null;
    private _mapLocation: LatLng | null;
    private _isManualMap: boolean;
    private _isDebugLocation: boolean;
    private _watchId: number | null;
    private _permissionStatus: 'granted' | 'denied' | 'prompt' | null;
    private _userLocationStatus: UserLocationStatus;
}
```

### 2.4 Key Methods

#### Location Retrieval
```typescript
getUserLocation(): LatLng | null
getUserLocationCached(): LatLng | null
getMapLocation(): LatLng | null
```

#### Location Updates
```typescript
requestGeoLocation(): Promise<LatLng>
setMapLocation(location: LatLng): void
resetMapLocation(): void
```

#### Debug Support
```typescript
setIsDebugLocation(enabled: boolean): void
setDebugUserLocation(location: LatLng): void
```

#### Event Subscription
```typescript
onUserLocationChange(callback: (location: LatLng) => void, debounceMs?: number): () => void
onMapLocationChange(callback: (location: LatLng) => void, options?: {
    realtime?: boolean;
    debounceMs?: number;
}): () => void
```

### 2.5 Location Caching

- Locations are cached in localStorage
- Cache includes timestamps for freshness checking
- Default stale time is 15 minutes
- Cache is cleared on significant location changes

### 2.6 Permission Handling

```typescript
async requestPermission(): Promise<'granted' | 'denied' | 'prompt'> {
    // Handles browser geolocation permissions
    // Returns current permission status
}
```

**3. MapService**
----------------

### 3.1 Core Features

MapService manages:

- Mapbox GL map instance
- Map markers (user and map location)
- Search functionality (Google Places or Mapbox)
- Nearby places
- Reverse geocoding
- Map interactions

### 3.2 Initialization Options

```typescript
interface MapServiceOptions {
    mapContainer: string;
    accessToken: string;
    googleApiKey?: string;
    searchInput?: string;
    searchInputLevel?: string;
    initialZoom?: number;
    nearbyPlaces?: number | boolean;
    placesEndpoint?: 'supabase' | 'cloudflare';
    onAutocompleteSelect?: Function;
    onMapDrag?: Function;
}
```

### 3.3 Core Components

#### Markers
- User location marker (green dot)
- Map location marker (red pin)
- Place markers for nearby locations

#### Search
- Autocomplete input
- Place selection
- Reverse geocoding
- Custom search result formatting

### 3.4 Key Methods

#### Initialization
```typescript
async initialize(): Promise<void>
```

#### Map Control
```typescript
getMap(): mapboxgl.Map
fitToBounds(bounds: mapboxgl.LngLatBounds): void
centerOnCurrentLocation(): void
```

#### Search & Places
```typescript
updateSearchText(text: string): void
handleNearbyPlaces(location: LatLng): Promise<void>
reverseGeocode(location: LatLng): Promise<void>
```

#### Event Subscription
```typescript
onPlacesChange(callback: Function): void
onMarkerClick(callback: Function): void
onMapReady(callback: Function): void
```

### 3.5 Place Data Structure

```typescript
interface Place {
    place_id: string;
    name: string;
    vicinity: string;
    formatted_address: string;
    geometry: {
        location: LatLng;
    };
    distance?: number;
    formattedDistance?: string;
    business_status?: string;
    opening_hours?: {
        open_now: boolean;
    };
    rating?: number;
    user_ratings_total?: number;
    types?: string[];
}
```

**4. Integration Points**
------------------------

### 4.1 Service Communication

```typescript
// LocationService → MapService
locationService.onUserLocationChange((location) => {
    mapService._updateUserMarker(location);
});

locationService.onMapLocationChange((location) => {
    mapService._updateMapMarker(location);
});

// MapService → LocationService
mapService.centerOnCurrentLocation(() => {
    locationService.resetMapLocation();
});
```

### 4.2 Debug Integration

Both services support debug mode for testing:

```typescript
// Enable debug mode
locationService.setIsDebugLocation(true);
locationService.setDebugUserLocation({
    lat: 40.7580,
    lng: -73.9855
});

mapService.setDebugMode(true);
```

**5. Performance Considerations**
-------------------------------

### 5.1 Location Updates
- Debounced callbacks prevent excessive updates
- Distance threshold (10m) filters out minor changes
- Cached locations reduce API calls

### 5.2 Map Optimization
- Lazy loading of map resources
- Marker clustering for nearby places
- Efficient marker updates
- Search debouncing

### 5.3 Memory Management
- Proper cleanup of map instances
- Callback cleanup on service destruction
- Event listener management

**6. Error Handling**
--------------------

### 6.1 Location Errors
- Permission denied fallback to cached location
- Timeout handling with retry logic
- Graceful degradation without location

### 6.2 Map Errors
- Offline map support
- Failed geocoding handling
- Search error recovery

### 6.3 Error States
```typescript
enum LocationError {
    PERMISSION_DENIED = 'Location permission denied',
    POSITION_UNAVAILABLE = 'Location unavailable',
    TIMEOUT = 'Location request timed out',
    NETWORK_ERROR = 'Network error',
    INITIALIZATION_ERROR = 'Map initialization failed'
}
``` 