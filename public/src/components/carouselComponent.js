export default class CarouselComponent {
    constructor(container) {
        this._container = container;
        this._scrollContainer = null;
        this._isExpanded = false;
        this._isUpdating = false;
        this._lastScrollTime = 0;
        this._isProgrammaticScroll = false;
        this._isTransitioning = false;
        this._currentIntersectionObserver = null;
        this._onCollapseCallback = null;
        
        // Config for class names and measurements
        this._config = {
            scrollClassName: 'places-scroll',
            cardClassName: 'place-card',
            maxHeight: '400px'  // Define max height here
        };
        
        // Set initial styles on container
        this._container.style.overflow = 'hidden';
        this._container.style.maxHeight = '0';
        // Don't add transition initially
        
        // Create scroll container immediately
        this._scrollContainer = document.createElement('div');
        this._scrollContainer.className = 'places-scroll overflow-x-auto whitespace-nowrap pb-4';
        this._scrollContainer.style.maxHeight = '0';
        this._scrollContainer.style.opacity = '0';
        this._container.appendChild(this._scrollContainer);

        // Add debounced resize listener
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this._currentIntersectionObserver) {
                    const currentObserver = this._currentIntersectionObserver;
                    const callback = currentObserver._callback;
                    this.setupIntersectionObserver(callback);
                }
            }, 250);
        });
    }

    expand() {
        console.log('Expanding carousel');
        // Add transition before expanding
        this._container.style.transition = 'max-height 0.3s ease-in-out';
        this._scrollContainer.style.transition = 'all 0.3s ease-in-out';
        
        // Set timeout to ensure transition is applied
        setTimeout(() => {
            this._container.style.maxHeight = this._config.maxHeight;
            this._scrollContainer.style.maxHeight = this._config.maxHeight;
            this._scrollContainer.style.opacity = '1';
        }, 0);
        
        this._isExpanded = true;
    }

    collapse() {
        console.log('Collapsing carousel');
        // Keep transition for collapse
        this._container.style.transition = 'max-height 0.3s ease-in-out';
        this._scrollContainer.style.transition = 'all 0.3s ease-in-out';
        
        this._container.style.maxHeight = '0';
        this._scrollContainer.style.maxHeight = '0';
        this._scrollContainer.style.opacity = '0';
        
        // Remove transition after collapse
        setTimeout(() => {
            this._container.style.transition = 'none';
            this._scrollContainer.style.transition = 'none';
        }, 300);
        
        this._isExpanded = false;

        // Call collapse callback if it exists
        if (this._onCollapseCallback) {
            this._onCollapseCallback();
        }
    }

    getOrCreateScrollContainer() {
        return this._scrollContainer;
    }

    setupIntersectionObserver(onCardVisible, options = {}) {
        // Cleanup any existing observer
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }

        // Store the callback
        this._onCardVisible = onCardVisible;

        // Only use intersection observer on mobile
        const isMobile = this.isMobile();
        
        if (isMobile) {
            const observer = new IntersectionObserver(
                (entries) => {
                    if (this._isProgrammaticScroll || this._isTransitioning) return;
                    const now = Date.now();
                    if (now - this._lastScrollTime < 2000) return;

                    let maxRatio = 0;
                    let mostVisibleCard = null;

                    entries.forEach(entry => {
                        if (entry.intersectionRatio > maxRatio) {
                            maxRatio = entry.intersectionRatio;
                            mostVisibleCard = entry.target;
                        }
                    });

                    if (mostVisibleCard && maxRatio > 0.5) {
                        this._onCardVisible(mostVisibleCard);
                    }
                },
                {
                    root: this._scrollContainer,
                    threshold: [0, 0.25, 0.5, 0.75, 1],
                    rootMargin: '-10% 0px -10% 0px',
                    ...options
                }
            );

            // Observe all cards
            this._scrollContainer.querySelectorAll(`.${this._config.cardClassName}`).forEach(card => {
                observer.observe(card);
            });

            this._currentIntersectionObserver = observer;
            return observer;
        }
        
        return null;
    }

    scrollCardIntoView(cardId) {
        const card = this._scrollContainer.querySelector(`.${this._config.cardClassName}[data-place-id="${cardId}"]`);
        if (!card) return;

        console.log('🔄 Starting programmatic scroll');
        
        this._isProgrammaticScroll = true;
        this._isTransitioning = true;
        this._lastScrollTime = Date.now();
        
        this._scrollContainer.scrollTo({
            behavior: 'smooth',
            left: card.getBoundingClientRect().left - 16 + this._scrollContainer.scrollLeft,
        });
        
        this._checkScrollEnd(this._scrollContainer);
    }

    _checkScrollEnd(scrollContainer) {
        const currentScroll = scrollContainer.scrollLeft;
        
        setTimeout(() => {
            if (currentScroll === scrollContainer.scrollLeft) {
                console.log('🔄 Ending programmatic scroll');
                this._isProgrammaticScroll = false;
                
                setTimeout(() => {
                    this._isTransitioning = false;
                }, 500);
            } else {
                this._checkScrollEnd(scrollContainer);
            }
        }, 50);
    }

    showEmptyMessage(message) {
        this._container.innerHTML = `
            <div class="${this._config.scrollClassName} pb-2">
                <div class="no-places-message">
                    ${message}
                </div>
            </div>`;
    }

    isMobile() {
        return window.innerWidth < 1024;
    }

    selectCard(placeId) {
        this._container.querySelectorAll('.place-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.placeId === placeId);
        });
    }

    clearSelection(placeId = null) {
        if (placeId) {
            // Clear specific card
            const card = this._container.querySelector(`.place-card[data-place-id="${placeId}"]`);
            if (card) {
                card.classList.remove('selected');
            }
        } else {
            // Clear all cards
            this._container.querySelectorAll('.place-card').forEach(card => {
                card.classList.remove('selected');
            });
        }
    }

    destroy() {
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }
    }

    // Add method to set collapse callback
    onCollapse(callback) {
        this._onCollapseCallback = callback;
    }
} 