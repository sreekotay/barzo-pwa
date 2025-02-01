export default class MarkerManager {
    constructor(mapService) {
        this._mapService = mapService;
        this._markers = new Map(); // placeId -> marker
        this._selectedMarkerId = null;
        this._markerClickCallbacks = [];
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
        
        places.forEach(place => {
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
        this._markers.forEach(marker => marker.remove());
        this._markers.clear();
        this._selectedMarkerId = null;
    }
}

function createPulsingDot(map) {
    const size = 200;
    const pulsingDot = {
        width: size,
        height: size,
        data: new Uint8Array(size * size * 4),

        onAdd: function() {
            const canvas = document.createElement('canvas');
            canvas.width = this.width;
            canvas.height = this.height;
            this.context = canvas.getContext('2d');
        },

        render: function() {
            const duration = 1000;
            const t = (performance.now() % duration) / duration;

            const radius = (size / 2) * 0.3;
            const outerRadius = (size / 2) * 0.7 * t + radius;
            const context = this.context;

            // Draw the outer circle
            context.clearRect(0, 0, this.width, this.height);
            context.beginPath();
            context.arc(
                this.width / 2,
                this.height / 2,
                outerRadius,
                0,
                Math.PI * 2
            );
            context.fillStyle = `rgba(255, 200, 200, ${1 - t})`; // Change this color
            context.fill();

            // Draw the inner circle
            context.beginPath();
            context.arc(
                this.width / 2,
                this.height / 2,
                radius,
                0,
                Math.PI * 2
            );
            context.fillStyle = 'rgba(255, 100, 100, 1)'; // And this color
            context.strokeStyle = 'white';
            context.lineWidth = 2 + 4 * (1 - t);
            context.fill();
            context.stroke();

            // Update this.data with the current state
            this.data = context.getImageData(
                0,
                0,
                this.width,
                this.height
            ).data;

            map.triggerRepaint();
            return true;
        }
    };

    return pulsingDot;
} 