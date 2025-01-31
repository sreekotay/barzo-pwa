/**
 * LocationService
 * 
 * A singleton service that manages location-related functionality including:
 * - User's current location tracking
 * - Location caching
 * - Debug location overrides
 * - Map location management
 * - Location change notifications
 * 
 * Key Features:
 * - Automatic location tracking with GPS
 * - Location caching in localStorage
 * - Debounced location change callbacks
 * - Debug mode for testing
 * - Distance-based update filtering (10m threshold)
 * - User location status tracking (unknown, requested, granted, denied, timed out)
 * - Permission handling and status tracking
 * 
 * Usage:
 * ```js
 * import locationService, { UserLocationStatus } from '../services/locationService';
 * 
 * // Explicitly request permission first
 * const permissionStatus = await locationService.requestPermission();
 * if (permissionStatus === 'granted') {
 *     // Start tracking location
 *     await locationService.requestGeoLocation();
 * } else {
 *     console.log('Please enable location permissions');
 * }
 * 
 * // Get current location
 * const location = locationService.getUserLocation();
 * const location = locationService.getUserLocationCached(); // last known location
 * const location = locationService.getMapLocation(); // map center
 * 
 * // Check user location status
 * const status = locationService.getUserLocationStatus();
 * if (status === UserLocationStatus.DENIED) {
 *     console.log('Please enable location permissions');
 * }
 * 
 * // Listen for location changes
 * const unsubscribe = locationService.onUserLocationChange(location => {
 *     console.log('User moved to:', location);
 * });
 * 
 * // Listen for map location changes
 * const unsubscribeMap = locationService.onMapLocationChange(location => {
 *     console.log('Map moved to:', location);
 * });
 * 
 * // Debug mode
 * locationService.setIsDebugLocation(true);
 * locationService.setDebugUserLocation({ lat: 51.5074, lng: -0.1278 });
 * 
 * // Manual map control
 * locationService.setMapLocation({ lat: 51.5074, lng: -0.1278 }); // manually set map location
 * locationService.resetMapLocation(); // reset to user location
 * 
 * // Stop tracking
 * locationService.stopWatching();
 * unsubscribe();
 * unsubscribeMap();
 * ```
 * 
 * State Management:
 * - All location and debug settings are persisted in localStorage
 * - Cached location includes timestamp for freshness checking
 * - Permission and location status are tracked separately
 * - Map location can be controlled manually or follow user location
 * 
 * Error Handling:
 * - Permission denied falls back to cached location if available
 * - Timeout errors are handled gracefully
 * - Debug mode allows testing without real GPS
 */

/** @enum {string} */
export const UserLocationStatus = {
    UNKNOWN: 'unknown',
    REQUESTED: 'requested',
    GRANTED: 'granted',
    DENIED: 'denied',
    TIMED_OUT: 'timed out'
};

const STORAGE_KEY = 'locationService';

/**
 * @typedef {Object} LatLng
 * @property {number} lat - Latitude
 * @property {number} lng - Longitude
 */

class LocationService {
    constructor() {
        // Load all persisted data
        const stored = localStorage.getItem(STORAGE_KEY);
        const data = stored ? JSON.parse(stored) : {};

        /** @type {LatLng} */
        this._userLocation = null;
        /** @type {LatLng} */
        this._userLocationCached = data.userLocationCached || null;
        /** @type {number|null} */
        this._userLocationCachedTS = data.userLocationCachedTS || null;
        /** @type {LatLng} */
        this._debugUserLocation = data.debugUserLocation || null;
        /** @type {LatLng} */
        this._mapLocation = null;
        /** @type {boolean} */
        this._isManualMap = false;
        /** @type {boolean} */
        this._isDebugLocation = data.isDebugLocation || false;
        /** @type {number|null} */
        this._watchId = null;
        /** @type {'granted'|'denied'|'prompt'|null} */
        this._permissionStatus = null;
        /** @type {UserLocationStatus} */
        this._userLocationStatus = UserLocationStatus.UNKNOWN;

        /** @type {Array<{callback: Function, debounceMs: number, timeoutId: number|null}>} */
        this._mapLocationCallbacks = [];
        /** @type {Array<{callback: Function, debounceMs: number, timeoutId: number|null}>} */
        this._userLocationCallbacks = [];
    }

    /**
     * Persist current state to localStorage
     * @private
     */
    _persistState() {
        try {
            const data = {
                userLocationCached: this._userLocationCached,
                userLocationCachedTS: this._userLocationCachedTS,
                debugUserLocation: this._debugUserLocation,
                isDebugLocation: this._isDebugLocation
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
            console.warn('Failed to persist location state:', error);
        }
    }

    // User Location
    getUserLocation() {
        return this._isDebugLocation ? this._debugUserLocation : this._userLocation;
    }

    // User Location Cached
    getUserLocationCached() {
        return this._isDebugLocation ? this._debugUserLocation : this._userLocationCached;
    }

    // User Location Cached Timestamp
    getUserLocationCachedTS() {
        return this._userLocationCachedTS;
    }

    // Debug User Location
    getDebugUserLocation() {
        return this._debugUserLocation;
    }

    setDebugUserLocation(location) {
        if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
            throw new Error('Invalid location format. Expected {lat: number, lng: number}');
        }
        this._debugUserLocation = location;
        this._persistState();
    }

    // Map Location - return the user location, unless we are in manual mode or we don't have a user location
    getMapLocation() {
        return (this._isManualMap ? null : this.getUserLocationCached()) || this._mapLocation;
    }

    /**
     * Registers a callback that will be called when map location changes
     * @param {Function} callback Function to call with new location
     * @param {Object} options Callback options
     * @param {boolean} [options.realtime=false] Whether to call in realtime or debounced
     * @param {number} [options.debounceMs=1000] Debounce time in milliseconds
     * @returns {Function} Function to unregister the callback
     */
    onMapLocationChange(callback, { realtime = false, debounceMs = 1000 } = {}) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        if (typeof debounceMs !== 'number' || debounceMs < 0) {
            throw new Error('debounceMs must be a positive number');
        }

        const callbackObj = {
            callback,
            debounceMs,
            timeoutId: null,
            realtime
        };
        
        this._mapLocationCallbacks.push(callbackObj);
        
        return () => {
            const index = this._mapLocationCallbacks.findIndex(cb => cb === callbackObj);
            if (index !== -1) {
                if (callbackObj.timeoutId) {
                    clearTimeout(callbackObj.timeoutId);
                }
                this._mapLocationCallbacks.splice(index, 1);
            }
        };
    }

    setMapLocation(location) {
        if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
            throw new Error('Invalid location format. Expected {lat: number, lng: number}');
        }

        this._isManualMap = true;
        this._mapLocation = location;

        // Trigger debounced callbacks
        this._mapLocationCallbacks.forEach(callbackObj => {
            if (callbackObj.timeoutId) {
                clearTimeout(callbackObj.timeoutId);
            }

            callbackObj.timeoutId = setTimeout(() => {
                callbackObj.callback(location);
                callbackObj.timeoutId = null;
            }, callbackObj.debounceMs);
        });
    }

    /**
     * Triggers callbacks for map location changes
     * @private
     * @param {LatLng} location 
     */
    _triggerMapLocationCallbacks(location) {
        this._mapLocationCallbacks.forEach(callbackObj => {
            if (callbackObj.realtime) {
                // Call immediately for realtime callbacks
                callbackObj.callback(location);
            } else {
                // Debounce for non-realtime callbacks
                if (callbackObj.timeoutId) {
                    clearTimeout(callbackObj.timeoutId);
                }
                callbackObj.timeoutId = setTimeout(() => {
                    callbackObj.callback(location);
                    callbackObj.timeoutId = null;
                }, callbackObj.debounceMs);
            }
        });
    }

    resetMapLocation() {
        this._isManualMap = false;
        const location = this.getMapLocation();
        if (location) {
            this._mapLocation = location;
            this._triggerMapLocationCallbacks(location);
        }
    }

    // Debug mode
    getIsDebugLocation() {
        return this._isDebugLocation;
    }

    setIsDebugLocation(value) {
        if (typeof value !== 'boolean') {
            throw new Error('isDebugLocation must be a boolean');
        }
        this._isDebugLocation = value;
        this._persistState();
    }

    /**
     * Registers a callback that will be called when user location changes
     * @param {Function} callback Function to call with new location
     * @param {number} debounceMs Debounce time in milliseconds
     * @returns {Function} Function to unregister the callback
     */
    onUserLocationChange(callback, debounceMs = 1000) {
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        if (typeof debounceMs !== 'number' || debounceMs < 0) {
            throw new Error('debounceMs must be a positive number');
        }
        const callbackObj = {
            callback,
            debounceMs,
            timeoutId: null
        };
        
        this._userLocationCallbacks.push(callbackObj);
        
        // Return unsubscribe function
        return () => {
            const index = this._userLocationCallbacks.findIndex(cb => cb === callbackObj);
            if (index !== -1) {
                if (callbackObj.timeoutId) {
                    clearTimeout(callbackObj.timeoutId);
                }
                this._userLocationCallbacks.splice(index, 1);
            }
        };
    }

    /**
     * Triggers callbacks for user location changes and optionally map location callbacks
     * @private
     * @param {LatLng} location 
     */
    _triggerUserLocationCallbacks(location) {
        // Trigger user location callbacks
        this._userLocationCallbacks.forEach(callbackObj => {
            if (callbackObj.timeoutId) {
                clearTimeout(callbackObj.timeoutId);
            }

            callbackObj.timeoutId = setTimeout(() => {
                callbackObj.callback(location);
                callbackObj.timeoutId = null;
            }, callbackObj.debounceMs);
        });

        // If not in manual mode, trigger map location callbacks too
        if (!this._isManualMap) {
            this._triggerMapLocationCallbacks(location);
        }
    }

    /**
     * Requests the user's current location using the browser's Geolocation API
     * and sets up continuous location watching if available
     * @returns {Promise<LatLng>} A promise that resolves with the user's location
     */
    async requestGeoLocation() {
        if (!navigator.geolocation) {
            this._userLocationStatus = UserLocationStatus.DENIED;
            throw new Error('Geolocation is not supported by your browser');
        }

        this._userLocationStatus = UserLocationStatus.REQUESTED;
        try {
            // First get the initial position with increased timeout
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 15000,  // Increased from 5000 to 20000 ms (20 seconds)
                    maximumAge: 0
                });
            });

            const location = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            // Update userLocation
            this._userLocation = location;
            this._userLocationStatus = UserLocationStatus.GRANTED;
            
            // Cache the location with timestamp
            this._userLocationCached = location;
            this._userLocationCachedTS = Date.now();
            this._persistState();

            // Trigger user location callbacks
            this._triggerUserLocationCallbacks(location);
            
            // Clear any existing watch
            if (this._watchId !== null) {
                navigator.geolocation.clearWatch(this._watchId);
            }

            // Set up the location watcher
            this._watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const newLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    
                    // Only update if location has changed significantly (more than 10 meters)
                    if (this._hasLocationChangedSignificantly(newLocation, this._userLocation)) {
                        this._userLocation = newLocation;
                        this._userLocationCached = newLocation;
                        this._userLocationCachedTS = Date.now();
                        this._persistState();
                        
                        // Trigger user location callbacks
                        this._triggerUserLocationCallbacks(newLocation);                        
                    }
                },
                (error) => {
                    console.warn('Watch position error:', error.message);
                    if (error.code === error.PERMISSION_DENIED) {
                        this._userLocationStatus = UserLocationStatus.DENIED;
                    } else if (error.code === error.TIMEOUT) {
                        this._userLocationStatus = UserLocationStatus.TIMED_OUT;
                    }
                },
                {
                    enableHighAccuracy: true,
                    timeout: 20000,  // Increased from 10000 to 20000 ms
                    maximumAge: 0
                }
            );

            return location;
        } catch (error) {
            console.warn('Geolocation error:', error.message);
            
            // Set appropriate status
            if (error.code === 1) { // PERMISSION_DENIED
                this._userLocationStatus = UserLocationStatus.DENIED;
            } else if (error.code === 3) { // TIMEOUT
                this._userLocationStatus = UserLocationStatus.TIMED_OUT;
            }

            // Try to use cached location if available
            if (this._userLocationCached && !this.isLocationStale()) {
                console.log('Using cached location due to geolocation error');
                return this._userLocationCached;
            }

            // If no cached location or it's stale, throw a more user-friendly error
            const errorMessage = {
                1: 'Location permission denied. Please enable location services.',
                2: 'Location information unavailable. Please try again.',
                3: 'Location request timed out. Please check your connection and try again.'
            }[error.code] || 'Failed to get location';

            throw new Error(errorMessage);
        }
    }

    /**
     * Calculates if the location has changed significantly (more than 10 meters)
     * @private
     * @param {LatLng} location1 
     * @param {LatLng} location2 
     * @returns {boolean}
     */
    _hasLocationChangedSignificantly(location1, location2) {
        if (!location1 || !location2) return true;

        // Approximate distance calculation using the Haversine formula
        const R = 6371e3; // Earth's radius in meters
        const φ1 = location1.lat * Math.PI/180;
        const φ2 = location2.lat * Math.PI/180;
        const Δφ = (location2.lat - location1.lat) * Math.PI/180;
        const Δλ = (location2.lng - location1.lng) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        const distance = R * c;
        return distance > 10; // Return true if distance is more than 10 meters
    }

    /**
     * Stops watching the user's location
     */
    stopWatching() {
        if (this._watchId !== null) {
            navigator.geolocation.clearWatch(this._watchId);
            this._watchId = null;
            this._userLocationStatus = UserLocationStatus.UNKNOWN; // Reset status

            // Clear all pending callbacks
            this._userLocationCallbacks.forEach(callbackObj => {
                if (callbackObj.timeoutId) {
                    clearTimeout(callbackObj.timeoutId);
                }
            });
            this._userLocationCallbacks = []; // Clear all callbacks

            // Clear map callbacks too
            this._mapLocationCallbacks.forEach(callbackObj => {
                if (callbackObj.timeoutId) {
                    clearTimeout(callbackObj.timeoutId);
                }
            });
            this._mapLocationCallbacks = [];
        }
    }

    /**
     * Get the current user location status
     * @returns {UserLocationStatus}
     */
    getUserLocationStatus() {
        return this._isDebugLocation ? UserLocationStatus.GRANTED : this._userLocationStatus;
    }

    getPermissionStatus() {
        return this._permissionStatus;
    }

    // Permission and geolocation methods
    async requestPermission() {
        try {
            if (navigator.permissions && navigator.permissions.query) {
                const result = await navigator.permissions.query({ name: 'geolocation' });
                
                if (result.state === 'prompt') {
                    return new Promise((resolve) => {
                        navigator.geolocation.getCurrentPosition(
                            () => {
                                this._permissionStatus = 'granted';
                                resolve('granted');
                            },
                            (error) => {
                                this._permissionStatus = error.code === 1 ? 'denied' : 'prompt';
                                resolve(this._permissionStatus);
                            },
                            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                        );
                    });
                }
                
                this._permissionStatus = result.state;
                return result.state;
            }
            
            return new Promise((resolve) => {
                navigator.geolocation.getCurrentPosition(
                    () => {
                        this._permissionStatus = 'granted';
                        resolve('granted');
                    },
                    (error) => {
                        this._permissionStatus = error.code === 1 ? 'denied' : 'prompt';
                        resolve(this._permissionStatus);
                    },
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                );
            });
        } catch (error) {
            console.error('Error requesting permission:', error);
            this._permissionStatus = 'denied';
            return 'denied';
        }
    }

    /**
     * Check if the cached location is older than the given time
     * @param {number} maxAgeMs Maximum age in milliseconds
     * @returns {boolean}
     */
    isLocationStale(maxAgeMs = 15 * 60 * 1000) { // default 15 minutes
        if (!this._userLocationCachedTS) return true;
        return Date.now() - this._userLocationCachedTS > maxAgeMs;
    }

    /**
     * Clear all cached location data
     */
    clearCache() {
        this._userLocationCached = null;
        this._userLocationCachedTS = null;
        this._persistState();
    }

    /**
     * Calculate distance between two locations in meters
     * @param {LatLng} location1 
     * @param {LatLng} location2 
     * @returns {number} Distance in meters
     */
    getDistanceBetween(location1, location2) {
        if (!location1 || !location2) return Infinity;

        const R = 6371e3;
        const φ1 = location1.lat * Math.PI/180;
        const φ2 = location2.lat * Math.PI/180;
        const Δφ = (location2.lat - location1.lat) * Math.PI/180;
        const Δλ = (location2.lng - location1.lng) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    }

    /**
     * Get age of cached location in milliseconds
     * @returns {number|null}
     */
    getLocationAge() {
        if (!this._userLocationCachedTS) return null;
        return Date.now() - this._userLocationCachedTS;
    }

    // Add public methods to manage manual mode
    setManualMode(isManual) {
        this._isManualMap = isManual;
    }

    isManualMode() {
        return this._isManualMap;
    }
}

export default new LocationService(); 