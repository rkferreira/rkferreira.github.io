// GitHub API Configuration
const GITHUB_USERNAME = 'rkferreira';
const GITHUB_API = 'https://api.github.com';

// Update last updated date
document.addEventListener('DOMContentLoaded', () => {
    const lastUpdated = document.getElementById('last-updated');
    if (lastUpdated) {
        lastUpdated.textContent = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
    
    // Load contributions
    fetchContributions();
});

// Fetch all repositories and filter for contributions
async function fetchContributions() {
    const contributionsList = document.getElementById('contributions-list');
    const contributionsInfo = document.querySelector('.contributions-info p');
    
    // Attempt to load from build-time static JSON cache first
    try {
        contributionsInfo.textContent = 'Loading contributions...';
        const response = await fetch('./contributions.json');
        if (response.ok) {
            const validRepos = await response.json();
            if (Array.isArray(validRepos)) {
                console.log('Loaded contributions from static contributions.json');
                renderContributions(validRepos, contributionsInfo, contributionsList, 'static');
                return;
            }
        }
    } catch (error) {
        console.warn('Failed to load static contributions.json, falling back to live API/LocalStorage:', error);
    }

    // Fallback: LocalStorage + Live API Caching
    const CACHE_KEY = 'github_contributions';
    const TIMESTAMP_KEY = 'github_contributions_timestamp';
    const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

    const cachedData = localStorage.getItem(CACHE_KEY);
    const cachedTimestamp = localStorage.getItem(TIMESTAMP_KEY);

    if (cachedData && cachedTimestamp) {
        const cacheAge = Date.now() - parseInt(cachedTimestamp, 10);
        if (cacheAge < CACHE_TTL) {
            try {
                const validRepos = JSON.parse(cachedData);
                console.log('Loaded contributions from valid LocalStorage cache');
                renderContributions(validRepos, contributionsInfo, contributionsList, 'cache');
                return;
            } catch (e) {
                console.error('Failed to parse cached contributions:', e);
            }
        }
    }

    // No valid cache found, fetch live from GitHub API
    try {
        contributionsInfo.textContent = 'Fetching your contributions from GitHub...';
        
        const externalRepos = new Set();
        
        // Step 1: Fetch recent events
        const eventsResponse = await fetch(`${GITHUB_API}/users/${GITHUB_USERNAME}/events/public?per_page=100`);
        if (eventsResponse.status === 403 || eventsResponse.status === 429) {
            throw new Error('GitHub API rate limit exceeded');
        }
        
        if (eventsResponse.ok) {
            const events = await eventsResponse.json();
            events.forEach(event => {
                if (event.repo && event.repo.name) {
                    const repoName = event.repo.name;
                    const repoOwner = repoName.split('/')[0];
                    
                    if (repoOwner.toLowerCase() !== GITHUB_USERNAME.toLowerCase()) {
                        externalRepos.add(repoName);
                    }
                }
            });
        }
        
        // Step 2: Search for all Pull Requests
        contributionsInfo.textContent = 'Searching for pull requests...';
        const searchQuery = `author:${GITHUB_USERNAME} type:pr`;
        const searchResponse = await fetch(
            `${GITHUB_API}/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=100`
        );
        if (searchResponse.status === 403 || searchResponse.status === 429) {
            throw new Error('GitHub API rate limit exceeded');
        }
        
        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            
            if (searchData.items) {
                searchData.items.forEach(pr => {
                    const repoName = pr.repository_url.replace('https://api.github.com/repos/', '');
                    const repoOwner = repoName.split('/')[0];
                    
                    if (repoOwner.toLowerCase() !== GITHUB_USERNAME.toLowerCase()) {
                        externalRepos.add(repoName);
                    }
                });
            }
        }
        
        if (externalRepos.size === 0) {
            contributionsInfo.innerHTML = `
                <i class="fas fa-info-circle"></i> 
                No external contributions found. This section shows repositories you've contributed to that are owned by others.
            `;
            contributionsList.innerHTML = '';
            // Store empty result in cache
            localStorage.setItem(CACHE_KEY, JSON.stringify([]));
            localStorage.setItem(TIMESTAMP_KEY, Date.now().toString());
            return;
        }
        
        // Step 3: Fetch details for each external repository
        contributionsInfo.textContent = `Fetching details for ${externalRepos.size} repositories...`;
        
        const repoPromises = Array.from(externalRepos).map(async (repoName) => {
            try {
                const response = await fetch(`${GITHUB_API}/repos/${repoName}`);
                if (response.status === 403 || response.status === 429) {
                    throw new Error('Rate limit exceeded');
                }
                if (response.ok) {
                    return await response.json();
                }
            } catch (error) {
                console.error(`Error fetching ${repoName}:`, error);
            }
            return null;
        });
        
        const reposData = await Promise.all(repoPromises);
        const validRepos = reposData.filter(repo => repo !== null);
        
        // Sort by stars
        validRepos.sort((a, b) => b.stargazers_count - a.stargazers_count);
        
        // Save to LocalStorage cache
        localStorage.setItem(CACHE_KEY, JSON.stringify(validRepos));
        localStorage.setItem(TIMESTAMP_KEY, Date.now().toString());

        renderContributions(validRepos, contributionsInfo, contributionsList, 'live');
        
    } catch (error) {
        console.error('Error fetching contributions live:', error);
        
        // If live fetching failed but we have ANY cached data (even expired), use it!
        if (cachedData) {
            try {
                const validRepos = JSON.parse(cachedData);
                console.log('Loaded contributions from expired LocalStorage cache due to live API failure');
                renderContributions(validRepos, contributionsInfo, contributionsList, 'expired');
                return;
            } catch (e) {
                console.error('Failed to parse expired cache:', e);
            }
        }

        contributionsInfo.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i> 
                Error loading contributions: ${error.message}
                <br><small>GitHub API might be rate-limited. Please try again later.</small>
            </div>
        `;
    }
}

// Helper to render contributions
function renderContributions(validRepos, contributionsInfo, contributionsList, source) {
    if (validRepos.length === 0) {
        contributionsInfo.innerHTML = `
            <i class="fas fa-info-circle"></i> 
            No external contributions found. This section shows repositories you've contributed to that are owned by others.
        `;
        contributionsList.innerHTML = '';
        return;
    }

    let sourceLabel = '';
    if (source === 'expired') {
        sourceLabel = ' <span class="cache-badge" style="font-size: 0.8em; color: #e0a800; background: rgba(224, 168, 0, 0.1); padding: 2px 6px; border-radius: 4px; margin-left: 8px;"><i class="fas fa-history"></i> cached (API offline)</span>';
    } else if (source === 'cache') {
        sourceLabel = ' <span class="cache-badge" style="font-size: 0.8em; color: #28a745; background: rgba(40, 167, 69, 0.1); padding: 2px 6px; border-radius: 4px; margin-left: 8px;"><i class="fas fa-hdd"></i> cached</span>';
    }

    contributionsInfo.innerHTML = `
        <i class="fas fa-check-circle"></i> 
        Found <strong>${validRepos.length}</strong> external ${validRepos.length === 1 ? 'repository' : 'repositories'} you've contributed to!${sourceLabel}
    `;
    
    // Display repositories
    contributionsList.innerHTML = validRepos.map(repo => createContributionCard(repo)).join('');
}

// Create HTML for a contribution card
function createContributionCard(repo) {
    const description = repo.description || 'No description available';
    const language = repo.language || 'Unknown';
    const stars = repo.stargazers_count || 0;
    const forks = repo.forks_count || 0;
    const updatedAt = new Date(repo.updated_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
    
    return `
        <div class="contribution-card">
            <h3>
                <i class="fab fa-github"></i>
                <a href="${repo.html_url}" target="_blank" rel="noopener noreferrer">
                    ${repo.full_name}
                </a>
            </h3>
            <p>${escapeHtml(description)}</p>
            <div class="repo-stats">
                <span class="stat">
                    <i class="fas fa-star"></i>
                    ${stars.toLocaleString()}
                </span>
                <span class="stat">
                    <i class="fas fa-code-branch"></i>
                    ${forks.toLocaleString()}
                </span>
                ${language ? `
                <span class="stat">
                    <i class="fas fa-circle"></i>
                    ${language}
                </span>
                ` : ''}
                <span class="stat">
                    <i class="far fa-clock"></i>
                    ${updatedAt}
                </span>
            </div>
        </div>
    `;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Error handling for images
document.addEventListener('DOMContentLoaded', () => {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        img.addEventListener('error', function() {
            console.error(`Failed to load image: ${this.src}`);
            // Could add fallback image here if needed
        });
    });
});
