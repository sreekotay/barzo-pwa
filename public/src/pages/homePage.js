import PlacesComponent from '../components/placesComponent.js';
import locationService from '../services/locationService.js';

export default class HomePage {
    constructor(mapService) {
        this.mapService = mapService;
        this._carousels = new Map(); // Track all carousels
        this._intersectionObserver = null;
    }

    async render() {
        return `<div class="pt-4">
                    ${this.carouselHelper('BARS & CLUBS', 'red', 'bar')}
                    ${this.carouselHelper('CIGAR & HOOKAH', 'purple', 'cigar')}
                    ${this.carouselHelper('KARAOKE & LIVE MUSIC', 'gold', 'music')}    
                    ${this.carouselHelper('RESTAURANTS', 'amber', 'restaurant')}
                </div>
                `;
    }

    carouselHelper(title, color, name) {
        return `<div class="flex px-4 mb-1 items-center" data-carousel-id="${name}">
                    <h3 class="text-sm font-bold text-black-800">${title}</h3>
                    <div class="w-2 h-2 rounded-full bg-${color}-600 mx-2 opacity-0 transition-opacity duration-300" data-dot="${name}"></div>
                </div>
                <div id="${name}-container"></div>`
    }

    async afterRender() {
        // Initialize components first
        const barsComponent = new PlacesComponent(
            this.mapService, 
            locationService, 
            '#bar-container',
            {
                placeTypes: ['bar', 'night_club'],
                maxResults: 30,
                endpoint: 'supabase',
                markerColors: {
                    open: '#DC2626',
                    closed: '#9CA3AF',
                    pulse: '#DC2626'
                },
                onExpand: () => this._handleCarouselExpand('bars')
            }
        );
        this._carousels.set('bar', barsComponent);

        // Initialize restaurants component
        const restaurantsComponent = new PlacesComponent(
            this.mapService, 
            locationService, 
            '#restaurant-container',
            {
                placeTypes: ['restaurant', 'cafe'],
                maxResults: 20,
                endpoint: 'supabase',
                markerColors: {
                    open: '#F59E0B',
                    closed: '#9CA3AF',
                    pulse: '#F59E0B'
                },
                onExpand: () => this._handleCarouselExpand('restaurants')
            }
        );
        this._carousels.set('restaurant', restaurantsComponent);

        // Initialize cigar and hookah component
        const cigarHookahComponent = new PlacesComponent(
            this.mapService,
            locationService,
            '#cigar-container',
            {
                placeTypes: ['bar'],
                maxResults: 15,
                endpoint: 'supabase',
                markerColors: {
                    open: '#9333EA',
                    closed: '#9CA3AF',
                    pulse: '#9333EA'
                },
                keywords: ['cigar', 'hookah'],
                onExpand: () => this._handleCarouselExpand('cigar')
            }
        );
        this._carousels.set('cigar', cigarHookahComponent);

        // Initialize karaoke and live music component
        const musicComponent = new PlacesComponent(
            this.mapService,
            locationService,
            '#music-container',
            {
                placeTypes: ['bar'],
                maxResults: 15,
                endpoint: 'supabase',
                markerColors: {
                    open: '#059669',
                    closed: '#9CA3AF',
                    pulse: '#059669'
                },
                keywords: ['karaoke', 'live music'],
                onExpand: () => this._handleCarouselExpand('music')
            }
        );
        this._carousels.set('music', musicComponent);

        // Store components in window for debugging
        window.barsComponent = barsComponent;
        window.restaurantsComponent = restaurantsComponent;
        window.cigarHookahComponent = cigarHookahComponent;
        window.musicComponent = musicComponent;

        // Set up intersection observer first
        this._setupCarouselObserver();

        // Then wait for map to be ready before expanding carousels
        if (this.mapService.isMapReady()) {
            this._expandAllCarousels();
        } else {
            this.mapService.onMapReady(() => {
                this._expandAllCarousels();
            });
        }
    }

    _handleCarouselExpand(activeId) {
        console.log('Handling carousel expand:', activeId);
        // Don't collapse other carousels anymore
        // Just ensure markers are shown only for the topmost visible one
        this._intersectionObserver.takeRecords().forEach(entry => entry.target);
    }

    _setupCarouselObserver() {
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
        }

        const scrollContainer = document.querySelector('div#main-app');
        if (!scrollContainer) return;

        // Log container details
        const containerStyle = getComputedStyle(scrollContainer);
        console.log('Scroll container details:', {
            id: scrollContainer.id,
            height: scrollContainer.offsetHeight,
            scrollHeight: scrollContainer.scrollHeight,
            overflow: containerStyle.overflow,
            overflowY: containerStyle.overflowY,
            position: containerStyle.position
        });

        this._intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const carouselId = entry.target.id.replace('-container', '');
                if (!carouselId) return;

                console.log('Carousel ID:', carouselId);
                const component = this._carousels.get(carouselId);
                if (!component) return;

                // Get container bounds
                const containerRect = scrollContainer.getBoundingClientRect();
                const rect = entry.boundingClientRect;
                
                // Calculate visibility relative to container instead of window
                const containerVisibleTop = containerRect.top;
                const containerVisibleBottom = containerRect.bottom;
                
                const isAboveContainer = rect.bottom < containerVisibleTop;
                const isBelowContainer = rect.top > containerVisibleBottom;
                
                // Calculate visible height relative to container
                const visibleHeight = Math.min(rect.bottom, containerVisibleBottom) - 
                                    Math.max(rect.top, containerVisibleTop);
                const percentVisible = (visibleHeight / rect.height) * 100;

                console.log(`Carousel ${carouselId} visibility:`, {
                    percentVisible: Math.round(percentVisible),
                    isAboveContainer,
                    isBelowContainer,
                    containerBounds: {
                        top: Math.round(containerVisibleTop),
                        bottom: Math.round(containerVisibleBottom),
                        height: Math.round(containerRect.height)
                    },
                    elementBounds: {
                        top: Math.round(rect.top),
                        bottom: Math.round(rect.bottom),
                        height: Math.round(rect.height)
                    }
                });

                // Show markers if carousel is significantly visible in container
                if (!isAboveContainer && !isBelowContainer && percentVisible > 50) {
                    component._markerManager.showMarkers();
                } else {
                    component._markerManager.hideMarkers();
                }
            });
        }, {
            root: scrollContainer,  // Use the scroll container as root
            threshold: [0, 0.5, 1],
            rootMargin: '0px'
        });

        // Observe all carousel containers
        const containers = document.querySelectorAll('[id$="-container"]');
        containers.forEach(container => {
            console.log('Observing container:', container.id);
            this._intersectionObserver.observe(container);
        });
    }

    _expandAllCarousels() {
        const location = locationService.getUserLocationCached();
        if (location) {
            this._carousels.forEach((component, id) => {
                console.log(`Expanding carousel: ${id}`);
                component._handleHeaderClick(true);
            });
        }
    }

    // Clean up when page changes
    destroy() {
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
            this._intersectionObserver = null;
        }
    }
} 