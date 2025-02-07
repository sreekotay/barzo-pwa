class SheetComponent {
    constructor() {
        this.activeSheet = null;
        this._setupStyles();
    }

    _setupStyles() {
        // Ensure our styles are in the document
        if (!document.getElementById('sheet-styles')) {
            const style = document.createElement('style');
            style.id = 'sheet-styles';
            style.textContent = `
                .sheet-backdrop {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.5);
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: none;
                    z-index: 1001;
                }

                .sheet-backdrop.active {
                    opacity: 1;
                    pointer-events: auto;
                }

                .sheet-container {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: white;
                    box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
                    transform: translateY(100%);
                    transition: transform 0.3s ease-out;
                    z-index: 1002;
                    max-height: 90vh;
                    overflow-y: auto;
                }

                .sheet-container.active {
                    transform: translateY(0);
                }

                .sheet-close-button {
                    position: absolute;
                    right: 1rem;
                    top: 1rem;
                    width: 2rem;
                    height: 2rem;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 9999px;
                    background: white;
                    border: none;
                    cursor: pointer;
                    color: #666;
                    transition: background-color 0.2s;
                }

                .sheet-close-button:hover {
                    background-color: #f3f4f6;
                }

                .sheet-content {
                    background-color: #ddd;
                }

                .sheet-container.profile-mode {
                    height: 100vh;
                    max-height: 100vh;
                }

                .sheet-container.profile-mode .sheet-content {
                    height: 100%;
                    overflow-y: auto;
                }

                .sheet-close-button.profile-mode {
                    position: fixed;
                    z-index: 1003;
                }
            `;
            document.head.appendChild(style);
        }
    }

    show(content, options = {}) {
        const {
            onClose,
            maxHeight = '95vh',
            closeOnBackdrop = true,
            closeOnSwipe = true,
            showCloseButton = true,
            className = '',
            isProfile = false,
            animateImmediately = true
        } = options;

        this.hide();

        const backdrop = document.createElement('div');
        backdrop.className = 'sheet-backdrop';

        const sheet = document.createElement('div');
        sheet.className = `sheet-container ${className}`;
        if (isProfile) {
            sheet.classList.add('profile-mode');
        }
        if (!isProfile) sheet.style.maxHeight = maxHeight;

        if (showCloseButton) {
            const closeButton = document.createElement('button');
            closeButton.className = `sheet-close-button ${isProfile ? 'profile-mode' : ''}`;
            closeButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
            closeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
            });
            sheet.appendChild(closeButton);
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'sheet-content';
        if (typeof content === 'string') {
            contentDiv.innerHTML = content;
        } else if (content instanceof Element) {
            contentDiv.appendChild(content);
        }
        sheet.appendChild(contentDiv);

        if (closeOnSwipe) {
            this._setupSwipeHandling(sheet, backdrop, isProfile);
        }

        if (closeOnBackdrop) {
            backdrop.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
            });
        }

        this.activeSheet = { backdrop, sheet, onClose };

        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);

        // Force reflow
        void sheet.offsetHeight;

        if (animateImmediately) {
            this._animateIn(backdrop, sheet);
        }

        return {
            sheet,
            backdrop,
            hide: () => this.hide(),
            animateIn: () => this._animateIn(backdrop, sheet)
        };
    }

    _animateIn(backdrop, sheet) {
        requestAnimationFrame(() => {
            backdrop.classList.add('active');
            sheet.classList.add('active');
        });
    }

    _setupSwipeHandling(sheet, backdrop, isProfile = false) {
        let touchStart = null;
        let currentTranslate = 0;
        let startY = 0;
        let lastY = 0;
        let isScrolling = false;

        const handleTouchStart = (e) => {
            touchStart = e.touches[0].clientY;
            startY = e.touches[0].clientY;
            lastY = startY;
            sheet.style.transition = 'none';
            isScrolling = false;
        };

        const handleTouchMove = (e) => {
            if (touchStart === null) return;
            
            const currentTouch = e.touches[0].clientY;
            const diff = currentTouch - touchStart;
            const deltaY = currentTouch - lastY;
            lastY = currentTouch;

            // Detect if we're scrolling content or swiping sheet
            if (!isScrolling) {
                const contentElement = sheet.querySelector('.sheet-content');
                const canScrollUp = contentElement.scrollTop > 0;
                const canScrollDown = contentElement.scrollTop < contentElement.scrollHeight - contentElement.clientHeight;

                // If we're at the top and swiping down, or at the bottom and swiping up
                if ((!canScrollUp && deltaY > 0) || (!canScrollDown && deltaY < 0)) {
                    isScrolling = false;
                    e.preventDefault(); // Prevent default only when we're handling the swipe
                } else if (canScrollUp || canScrollDown) {
                    isScrolling = true;
                    return; // Let the scroll happen naturally
                }
            }

            if (isScrolling) return;

            // For profile mode, allow both up and down swipes
            if (isProfile || (!isProfile && diff > 0)) {
                currentTranslate = diff;
                sheet.style.transform = `translateY(${diff}px)`;
                backdrop.style.opacity = Math.max(0, 1 - (Math.abs(diff) / sheet.offsetHeight));
            }
        };

        const handleTouchEnd = (e) => {
            if (touchStart === null) return;
            
            sheet.style.transition = 'transform 0.3s ease-out';
            backdrop.style.transition = 'opacity 0.3s ease-out';
            
            const threshold = sheet.offsetHeight * 0.3;
            
            if (isProfile) {
                // For profile, close on significant swipe in either direction
                if (Math.abs(currentTranslate) > threshold) {
                    this.hide();
                    e.stopPropagation();
                } else {
                    sheet.style.transform = '';
                    backdrop.style.opacity = '';
                }
            } else {
                // For regular sheets, only close on downward swipe
                if (currentTranslate > threshold) {
                    this.hide();
                    e.stopPropagation();
                } else {
                    sheet.style.transform = '';
                    backdrop.style.opacity = '';
                }
            }
            
            touchStart = null;
            currentTranslate = 0;
            isScrolling = false;
        };

        sheet.addEventListener('touchstart', handleTouchStart, { passive: true });
        sheet.addEventListener('touchmove', handleTouchMove, { passive: false }); // non-passive to allow preventDefault
        sheet.addEventListener('touchend', handleTouchEnd);

        // Store cleanup function
        sheet._removeSwipeHandlers = () => {
            sheet.removeEventListener('touchstart', handleTouchStart);
            sheet.removeEventListener('touchmove', handleTouchMove);
            sheet.removeEventListener('touchend', handleTouchEnd);
        };
    }

    hide() {
        if (!this.activeSheet) return;

        const { backdrop, sheet, onClose } = this.activeSheet;

        backdrop.classList.remove('active');
        sheet.classList.remove('active');

        // Clean up swipe handlers if they exist
        if (sheet._removeSwipeHandlers) {
            sheet._removeSwipeHandlers();
        }

        setTimeout(() => {
            backdrop.remove();
            sheet.remove();
            if (onClose) onClose();
        }, 300);

        this.activeSheet = null;
    }
}

export default new SheetComponent(); // Export as singleton 