import locationService from '/src/services/locationService.js';
import MapService from '/src/services/mapService.js';
import CDNize from '../utils/cdnize.js';

const barzoApiUrl = 'https://api.public.barzo.com';
class ProfileComponent {
    constructor() {
        this.userData = null;
        this.socialStats = null;
        // Create custom event for data loading
        this.dataLoadedEvent = new CustomEvent('profileDataLoaded', {
            detail: { component: this }
        });
        
        // Initialize map service with minimal config for geocoding
        this.mapService = new MapService(locationService, {
            mapContainer: 'map',
            accessToken: 'pk.eyJ1Ijoic3JlZWJhcnpvIiwiYSI6ImNtNXdwOHl1aDAwaGgyam9vbHdjYnIyazQifQ.StZ77F8-5g43kq29k2OLaw'
        });
        
        this.initialize();
    }

    async initialize() {
        try {
            // Get and parse auth token from localStorage
            const authTokenStr = localStorage.getItem('authToken');
            if (!authTokenStr) {
                console.error('No auth token found');
                return;
            }

            const authToken = JSON.parse(authTokenStr);
            const userId = authToken.token.identity.userId;
            const accessToken = authToken.token.accessToken;

            // Fetch both profile data and social stats in parallel
            const [profileResponse, statsResponse] = await Promise.all([
                fetch(`${barzoApiUrl}/v1/users/${userId}`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }),
                fetch(`${barzoApiUrl}/v1/users/${userId}/stats/social`, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                })
            ]);

            if (!profileResponse.ok || !statsResponse.ok) {
                throw new Error(`HTTP error! status: ${profileResponse.status || statsResponse.status}`);
            }

            this.userData = await profileResponse.json();
            this.socialStats = await statsResponse.json();
            
            // Dispatch event when data is loaded
            document.dispatchEvent(this.dataLoadedEvent);
            
            // Only update header pic here, let the event handler update the profile UI
            this.updateHeaderProfilePic();

        } catch (error) {
            console.error('Error fetching profile:', error);
        }
    }

    async updateProfileUI() {
        const profileContent = document.querySelector('#profile-content');
        if (!profileContent || !this.userData) return;

        const memberSince = new Date(this.userData.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        
        const locationString = await this.mapService.getReverseGeocodedLocation();

        const content = `
            <div class="receipt-images">
                <div class="receipt-banner">
                    ${this.userData.bannerImage ? 
                        `<img src="${CDNize.banner(this.userData.bannerImage)}" alt="Profile Banner">` :
                        '<div style="width: 100%; height: 100%; background: #f0f0f0;"></div>'
                    }
                    <div class="receipt-profile-pic">
                        ${this.userData.profileImage ? 
                            `<img src="${CDNize.profile(this.userData.profileImage)}" alt="${this.userData.fullName}">` :
                            `<div class="w-full h-full bg-gray-300 flex items-center justify-center text-gray-600 text-xl font-medium">
                                ${this.userData.fullName ? this.userData.fullName.split(' ').map(n => n[0]).join('') : '?'}
                            </div>`
                        }
                    </div>
                </div>
            </div>
            <div class="receipt-container">

                <div class="receipt-header">
                    <div class="receipt-logo">BARZO_BAR_TAB/${this.userData.nickname || 'profile'}</div>
                    <div class="receipt-address">
                        Currently in ${locationString}
                    </div >
                    <div class="receipt-address">${this.userData.fullName} • REG#${this.userData.id.slice(0,4)} ID#${this.userData.id.slice(-4)}</div>
                </div>

                <div class="receipt-content">
                    <div class="receipt-row">
                        <span class="receipt-label">Member Since:</span>
                        <span class="receipt-value">${memberSince}</span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Status:</span>
                        <span class="receipt-value">${this.userData.activityStatus?.toUpperCase() || 'ACTIVE'}</span>
                    </div>

                    ${this.userData.nickname ? `
                        <div class="receipt-row">
                            <span class="receipt-label">Nickname:</span>
                            <span class="receipt-value">@${this.userData.nickname}</span>
                        </div>
                    ` : ''}

                    <div class="receipt-divider"></div>
                    <div style="margin: 10px 0; text-align: center;">*** BOOZE BANK ***</div>


                    <div class="receipt-row">
                        <span class="receipt-label"><span class="text-red-500">FREE</span> Drinks on Barzo available</span>
                        <span class="receipt-value"><a href="#" class="never-link">REDEEM</a><span class="circle-number"> 6</span></span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Drinks Bought for You</span>
                        <span class="receipt-value"><a href="#" class="never-link">VIEW</a><span class="circle-number"> 3</span></span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Drinks You Bought</span>
                        <span class="receipt-value"><a href="#" class="never-link">MANAGE</a><span class="circle-number"> 8</span></span>
                    </div>

                    <div class="receipt-divider"></div>
                    <div style="margin: 10px 0; text-align: center;">*** ACTIVITY SUMMARY ***</div>

                    <div class="receipt-row">
                        <span class="receipt-label">Following:</span>
                        <span class="receipt-value">${this.socialStats?.following || 0}</span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Followers:</span>
                        <span class="receipt-value">${this.socialStats?.followers || 0}</span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Friends:</span>
                        <span class="receipt-value">${this.socialStats?.friends || 0}</span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Posts:</span>
                        <span class="receipt-value">${this.socialStats?.posts || 0}</span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Comments:</span>
                        <span class="receipt-value">${this.socialStats?.comments || 0}</span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Likes:</span>
                        <span class="receipt-value">${this.socialStats?.likes || 0}</span>
                    </div>

                    <div class="receipt-divider"></div>

                    <div class="receipt-row">
                        <span class="receipt-label">Account Type:</span>
                        <span class="receipt-value">${this.userData.pro ? 'PRO' : 'BASIC'}</span>
                    </div>

                    <div class="receipt-row">
                        <span class="receipt-label">Last Check-in:</span>
                        <span class="receipt-value">
                            ${this.userData.lastCheckIn ? 
                                new Date(this.userData.lastCheckIn).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit'
                                }) : 
                                '<a href="#" class="never-link">NEVER</a>'
                            }
                        </span>
                    </div>

                    ${this.userData.pro ? `
                        <div class="receipt-row">
                            <span class="receipt-label">Last Clock-in:</span>
                            <span class="receipt-value">
                                ${this.userData.lastClockIn ? 
                                    new Date(this.userData.lastClockIn).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        hour: 'numeric',
                                        minute: '2-digit'
                                    }) : 
                                    '<a href="#" class="never-link">NEVER</a>'
                                }
                            </span>
                        </div>
                    ` : ''}

                    <div class="receipt-row">
                        <span class="receipt-label">Verified:</span>
                        <span class="receipt-value">${this.userData.verified ? '✓' : '—'}</span>
                    </div>

                    <div class="codes-section">
                        <div class="qr-container">
                            <div id="qrcode"></div>
                        </div>
                        <div class="referral-text">
                            REFER A FRIEND • GET $8<br>
                            Each Time. Just have them scan the QR code
                        </div>
                        <div class="barcode-container">
                            <div class="receipt-barcode">
                                ${this.userData.id}
                            </div>
                            <div class="guid-text">${this.userData.id}</div>
                        </div>
                    </div>

                    <div class="receipt-footer">
                        ********************************
                        <br>
                        Thank you for being a valued member!
                        <br>
                        Visit barzo.com for more features
                        <br>
                        ********************************
                    </div>
                </div>
            </div>
        `;

        profileContent.innerHTML = content;

        // Generate QR code after content is added to DOM
        const qrcode = new QRCode(document.getElementById("qrcode"), {
            text: `https://barzo.com/refer/${this.userData.id}`,
            width: 200,
            height: 200,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }

    updateHeaderProfilePic() {
        const headerContainer = document.querySelector('header .flex.items-left');
        if (!headerContainer) return;

        let profilePic = headerContainer.querySelector('.profile-pic');
        if (!profilePic) {
            profilePic = document.createElement('div');
            profilePic.className = 'profile-pic w-16 h-16 rounded-full overflow-hidden cursor-pointer ml-auto -mt-6 border-2 border-white opacity-0';
            const spacer = headerContainer.querySelector('.w-6');
            headerContainer.insertBefore(profilePic, spacer);
        }

        const showProfilePic = () => {
            profilePic.classList.remove('opacity-0');
        };

        if (this.userData?.profileImage) {
            // Create image element and set up load handling
            const img = new Image();
            
            // Create promises for image load and timeout
            const imageLoadPromise = new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Image load timeout')), 5000);
            });

            // Race between image load and timeout
            Promise.race([imageLoadPromise, timeoutPromise])
                .then(() => {
                    profilePic.innerHTML = `<img src="${CDNize.profile(this.userData.profileImage)}" 
                        alt="${this.userData.fullName}" 
                        class="w-full h-full object-cover">`;
                    showProfilePic();
                })
                .catch(() => {
                    // Fallback to initials on error
                    this.showInitials(profilePic);
                    showProfilePic();
                });

            // Start loading the image
            img.src = CDNize.profile(this.userData.profileImage);
        } else {
            // No profile image, show initials immediately
            this.showInitials(profilePic);
            showProfilePic();
        }

        // Add click handler to navigate to profile
        profilePic.addEventListener('click', () => {
            window.location.hash = 'profile##';
        });
    }

    showInitials(profilePic) {
        const initials = this.userData?.fullName
            ? this.userData.fullName.split(' ').map(n => n[0]).join('')
            : '?';
        profilePic.innerHTML = `
            <div class="w-full h-full bg-gray-300 flex items-center justify-center text-gray-600 text-xl font-medium">
                ${initials}
            </div>
        `;
    }
}

export default ProfileComponent; 