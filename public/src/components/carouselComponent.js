export default class CarouselComponent {
    constructor(container, config = {}) {
        this._container = container;
        this._config = {
            initialMaxHeight: 0,
            expandedMaxHeight: 800,
            transitionDuration: '1.5s',
            scrollClassName: 'places-scroll',
            cardClassName: 'place-card',
            ...config
        };
        
        this._isUpdating = false;
        this._lastScrollTime = 0;
        this._isProgrammaticScroll = false;
        this._isTransitioning = false;
        this._currentIntersectionObserver = null;

        this.setupContainer();

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

    setupContainer() {
        this._container.style.overflow = 'hidden';
        this._container.style.maxHeight = `${this._config.initialMaxHeight}px`;
        this._container.style.transition = `max-height ${this._config.transitionDuration} ease-out`;
    }

    expand() {
        this._container.style.maxHeight = `${this._config.expandedMaxHeight}px`;
    }

    getOrCreateScrollContainer() {
        let scrollContainer = this._container.querySelector(`.${this._config.scrollClassName}`);
        if (!scrollContainer) {
            console.log('📍 Creating new scroll container');
            scrollContainer = document.createElement('div');
            scrollContainer.className = `${this._config.scrollClassName} pb-2`;
            scrollContainer.innerHTML = '<div class="w-1" style="flex-shrink: 0;"></div>';
            this._container.appendChild(scrollContainer);
        }
        return scrollContainer;
    }

    scrollCardIntoView(cardId) {
        const card = this._container.querySelector(`.${this._config.cardClassName}[data-place-id="${cardId}"]`);
        const scrollContainer = this._container.querySelector(`.${this._config.scrollClassName}`);
        if (!card || !scrollContainer) return;

        console.log('🔄 Starting programmatic scroll');
        
        this._isProgrammaticScroll = true;
        this._isTransitioning = true;
        this._lastScrollTime = Date.now();
        
        scrollContainer.scrollTo({
            behavior: 'smooth',
            left: card.getBoundingClientRect().left - 16 + scrollContainer.scrollLeft,
        });
        
        this._checkScrollEnd(scrollContainer);
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

    setupIntersectionObserver(onCardVisible, options = {}) {
        // Cleanup any existing observer
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }

        // Only use intersection observer on mobile
        const isMobile = this.isMobile();
        
        if (isMobile) {
            const scrollContainer = this.getOrCreateScrollContainer();
            
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
                        onCardVisible(mostVisibleCard);
                    }
                },
                {
                    root: scrollContainer,
                    threshold: [0, 0.25, 0.5, 0.75, 1],
                    rootMargin: '-10% 0px -10% 0px',
                    ...options
                }
            );

            // Observe all cards
            scrollContainer.querySelectorAll(`.${this._config.cardClassName}`).forEach(card => {
                observer.observe(card);
            });

            this._currentIntersectionObserver = observer;
            return observer;
        }
        
        return null;
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

    selectCard(cardId) {
        this._container.querySelectorAll(`.${this._config.cardClassName}`).forEach(card => {
            card.dataset.selected = (card.dataset.placeId === cardId).toString();
        });
    }

    clearSelection() {
        this._container.querySelectorAll(`.${this._config.cardClassName}`).forEach(card => {
            card.dataset.selected = "false";
        });
    }

    destroy() {
        if (this._currentIntersectionObserver) {
            this._currentIntersectionObserver.disconnect();
        }
        // Remove any event listeners or other cleanup
    }
} 