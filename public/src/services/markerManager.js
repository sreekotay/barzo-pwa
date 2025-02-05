export default class MarkerManager {
    constructor(mapService, name = 'unnamed', options = {}) {
        this._mapService = mapService;
        this._markers = new Map(); // placeId -> marker
        this._selectedMarkerId = null;
        this._markerClickCallbacks = [];
        this._isPulsing = false;  // Initialize as false
        this._name = name;  // Store name for logging
        this._popup = null;  // Add popup property
        this._options = {
            showPopups: false,  // Default to no popups
            ...options
        };
        this._defaultColors = {
            open: '#00A572',  // Always use green for open places
            closed: '#9CA3AF',
            pulse: '#E31C5F'
        };
    }

    // Add or update markers
    updateMarkers(places, colors = {}) {
        this._currentColors = {
            ...this._defaultColors,
            ...colors
        };
        
        // Track existing markers to remove stale ones
        const updatedMarkerIds = new Set();
        
        // Sort places by latitude (north to south)
        const sortedPlaces = [...places].sort((a, b) => 
            b.geometry.location.lat - a.geometry.location.lat
        );
        
        sortedPlaces.forEach(place => {
            const placeId = place.place_id;
            updatedMarkerIds.add(placeId);

            if (place.geometry && place.geometry.location) {
                if (this._markers.has(placeId)) {
                    // Update existing marker
                    const marker = this._markers.get(placeId);
                    marker.setLngLat([
                        place.geometry.location.lng,
                        place.geometry.location.lat
                    ]);
                    this._updateMarkerStyle(marker, place);
                } else {
                    // Create new marker
                    const marker = this._createMarker(place);
                    this._markers.set(placeId, marker);
                }
            }
        });

        // Remove stale markers
        for (const [placeId, marker] of this._markers.entries()) {
            if (!updatedMarkerIds.has(placeId)) {
                marker.remove();
                this._markers.delete(placeId);
            }
        }
    }

    _createMarker(place) {
        const el = document.createElement('div');
        el.className = 'place-marker';
        // Don't add pulse class by default - only if pulsing is enabled
        if (this._isPulsing) {
            el.classList.add('pulse');
        }
        
        // Add CSS variable for pulse color
        el.style.setProperty('--pulse-color', this._currentColors.pulse);
        
        // Set initial color based on open/closed status
        const isOpen = place.opening_hours?.open_now;
        el.style.backgroundColor = isOpen ? this._currentColors.open : this._currentColors.closed;

        const marker = new mapboxgl.Marker({
            element: el
        })
        .setLngLat([
            place.geometry.location.lng,
            place.geometry.location.lat
        ])
        .addTo(this._mapService.getMap());

        // Store place data with marker
        marker.placeId = place.place_id;
        marker.placeData = place;

        // Add click handler
        el.addEventListener('click', (e) => {
            e.preventDefault();
            this.selectMarker(place.place_id);
            this._markerClickCallbacks.forEach(callback => callback(place));
        });

        // Add touch handler
        el.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.selectMarker(place.place_id);
            this._markerClickCallbacks.forEach(callback => callback(place));
        }, { passive: false });

        return marker;
    }

    _updateMarkerStyle(marker, place) {
        const el = marker.getElement();
        const isOpen = place.opening_hours?.open_now;
        
        // Always use closed color for closed venues, but keep pulse color consistent
        el.style.backgroundColor = isOpen ? this._currentColors.open : this._currentColors.closed;
        el.style.setProperty('--pulse-color', this._currentColors.pulse);
        
        marker.placeData = place; // Update stored place data
    }

    // Select/deselect marker
    selectMarker(placeId) {
        // Remove existing popup if any
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }

        this._selectedMarkerId = placeId;
        this._markers.forEach((marker) => {
            const el = marker.getElement();
            if (el) {
                el.classList.toggle('selected', marker.placeId === placeId);
                
                // When selected, maintain open/closed color state
                if (marker.placeId === placeId) {
                    const isOpen = marker.placeData.opening_hours?.open_now;
                    el.style.backgroundColor = isOpen ? 
                        this._currentColors.open : 
                        this._currentColors.closed;
                    el.style.setProperty('--pulse-color', this._currentColors.pulse);
                    el.style.borderColor = this._currentColors.pulse; // Add border color

                    // Only show popup if enabled
                    if (this._options.showPopups) {
                        this._popup = new mapboxgl.Popup({
                            closeButton: false,
                            closeOnClick: false,
                            offset: 25,
                            className: 'place-marker-popup'
                        })
                        .setLngLat(marker.getLngLat())
                        .setHTML(`<div class="text-sm font-medium">${marker.placeData.name}</div>`)
                        .addTo(this._mapService.getMap());
                    }
                } else {
                    // Reset border color for unselected markers
                    el.style.borderColor = 'white';
                }
            }
        });
    }

    // Add click handler
    onMarkerClick(callback) {
        this._markerClickCallbacks.push(callback);
    }

    // Clear all markers
    clear() {
        console.log(`[${this._name}] Clearing markers and pulsing state`);
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }
        this._markers.forEach(marker => {
            const el = marker.getElement();
            if (el) {
                el.classList.remove('pulse');
                el.classList.remove('selected');
            }
            marker.remove();
        });
        this._markers.clear();
        this._selectedMarkerId = null;
        this._isPulsing = false;
    }

    hideMarkers() {
        this._markers.forEach(marker => {
            marker.remove();
        });
    }

    showMarkers() {
        this._markers.forEach(marker => {
            marker.addTo(this._mapService.getMap());
        });
    }

    // Add new method to get bounds of current markers
    getMarkerBounds() {
        if (this._markers.size === 0) return null;

        const bounds = new mapboxgl.LngLatBounds();
        
        this._markers.forEach(marker => {
            const lngLat = marker.getLngLat();
            bounds.extend([lngLat.lng, lngLat.lat]);
        });

        return bounds;
    }

    setPulsing(enabled) {
        console.log(`[${this._name}] Setting pulsing:`, enabled);
        this._isPulsing = enabled;
        this._markers.forEach(marker => {
            const el = marker.getElement();
            if (el) {
                if (enabled) {
                    el.classList.add('pulse');
                } else {
                    // Force remove any lingering pulse class
                    el.classList.remove('pulse');
                    el.classList.remove('selected');
                }
            }
        });
    }

    // Add method to hide popup
    hidePopup() {
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }
    }
}
