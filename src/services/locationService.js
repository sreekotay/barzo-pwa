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
        const data = {
            userLocationCached: this._userLocationCached,
            userLocationCachedTS: this._userLocationCachedTS,
            debugUserLocation: this._debugUserLocation,
            isDebugLocation: this._isDebugLocation
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /**
     * Get the current user location status
     * @returns {UserLocationStatus}
     */
    getUserLocationStatus() {
        return this._userLocationStatus;
    }

    /**
     * Get the current geolocation permission status
     * @returns {Promise<'granted'|'denied'|'prompt'>}
     */
    async checkPermissionStatus() {
        try {
            // Check if the browser supports permissions API
            if (navigator.permissions && navigator.permissions.query) {
                const result = await navigator.permissions.query({ name: 'geolocation' });
                this._permissionStatus = result.state;
                
                // Listen for permission changes
                result.addEventListener('change', () => {
                    this._permissionStatus = result.state;
                });

                return result.state;
            } else {
                // Fallback for browsers that don't support permissions API
                return new Promise((resolve) => {
                    navigator.geolocation.getCurrentPosition(
                        () => {
                            this._permissionStatus = 'granted';
                            resolve('granted');
                        },
                        (error) => {
                            this._permissionStatus = error.code === 1 ? 'denied' : 'prompt';
                            resolve(this._permissionStatus);
                        }
                    );
                });
            }
        } catch (error) {
            console.error('Error checking permission:', error);
            this._permissionStatus = 'denied';
            return 'denied';
        }
    }

    /**
     * Get the current permission status without checking
     * @returns {'granted'|'denied'|'prompt'|null}
     */
    getPermissionStatus() {
        return this._permissionStatus;
    }

    /**
     * Explicitly request geolocation permission from the user
     * @returns {Promise<'granted'|'denied'|'prompt'>}
     */
    async requestPermission() {
        try {
            // First try the modern Permissions API
            if (navigator.permissions && navigator.permissions.query) {
                const result = await navigator.permissions.query({ name: 'geolocation' });
                
                // If permission state is prompt, we need to explicitly request it
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
            
            // Fallback for browsers without Permissions API
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

    async requestGeoLocation() {
        if (!navigator.geolocation) {
            throw new Error('Geolocation is not supported by your browser');
        }

        // Update status to requested
        this._userLocationStatus = UserLocationStatus.REQUESTED;

        // First explicitly request permission
        const permissionStatus = await this.requestPermission();
        if (permissionStatus === 'denied') {
            this._userLocationStatus = UserLocationStatus.DENIED;
            // If we have cached location, use it
            if (this._userLocationCached) {
                return this._userLocationCached;
            }
            throw new Error('Location permission denied');
        }

        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 0
                });
            });

            const location = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            // Update userLocation
            this._userLocation = location;
            
            // Cache the location
            this._userLocationCached = location;
            this._userLocationCachedTS = Date.now();
            this._persistState();

            // Update status to granted since we got a location
            this._userLocationStatus = UserLocationStatus.GRANTED;

            // Set up the watcher with status updates
            if (this._watchId !== null) {
                navigator.geolocation.clearWatch(this._watchId);
            }

            this._watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const newLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    };
                    
                    if (this._hasLocationChangedSignificantly(newLocation, this._userLocation)) {
                        this._userLocation = newLocation;
                        this._userLocationCached = newLocation;
                        this._userLocationCachedTS = Date.now();
                        this._persistState();
                        
                        this._triggerUserLocationCallbacks(newLocation);
                    }
                    // Update status on successful watch updates
                    this._userLocationStatus = UserLocationStatus.GRANTED;
                },
                (error) => {
                    console.warn('Watch position error:', error.message);
                    // Update status based on error type
                    if (error.code === error.PERMISSION_DENIED) {
                        this._userLocationStatus = UserLocationStatus.DENIED;
                    } else if (error.code === error.TIMEOUT) {
                        this._userLocationStatus = UserLocationStatus.TIMED_OUT;
                    }
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );

            return location;
        } catch (error) {
            // Update status based on error type
            if (error.code === error.PERMISSION_DENIED) {
                this._userLocationStatus = UserLocationStatus.DENIED;
                this._permissionStatus = 'denied';
            } else if (error.code === error.TIMEOUT) {
                this._userLocationStatus = UserLocationStatus.TIMED_OUT;
            }

            // If we have a cached location and the error is timeout or permission denied,
            // return the cached location
            if (this._userLocationCached && 
                (error.code === error.TIMEOUT || 
                 error.code === error.PERMISSION_DENIED)) {
                return this._userLocationCached;
            }
            
            const errorMessage = {
                [GeolocationPositionError.PERMISSION_DENIED]: 'Location permission denied',
                [GeolocationPositionError.POSITION_UNAVAILABLE]: 'Location information unavailable',
                [GeolocationPositionError.TIMEOUT]: 'Location request timed out'
            }[error.code] || 'Failed to get location';

            throw new Error(errorMessage);
        }
    }

    // Map Location
    getMapLocation() {
        return this._isManualMap ? this._mapLocation : this.getUserLocationCached();
    }

    resetMapLocation() {
        this._isManualMap = false;
        this._mapLocation = this.getMapLocation();
    }

    setDebugUserLocation(location) {
        if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
            throw new Error('Invalid location format. Expected {lat: number, lng: number}');
        }
        this._debugUserLocation = location;
        this._persistState();
    }

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
}

export default new LocationService();