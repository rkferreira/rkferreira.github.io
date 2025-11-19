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
    
    try {
        contributionsInfo.textContent = 'Fetching your contributions from GitHub...';
        
        const externalRepos = new Set();
        
        // Step 1: Fetch recent events
        const eventsResponse = await fetch(`${GITHUB_API}/users/${GITHUB_USERNAME}/events/public?per_page=100`);
        
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
        const searchQuery = `author:${GITHUB_USERNAME}+type:pr`;
        const searchResponse = await fetch(
            `${GITHUB_API}/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=100`
        );
        
        if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            
            searchData.items.forEach(pr => {
                const repoName = pr.repository_url.replace('https://api.github.com/repos/', '');
                const repoOwner = repoName.split('/')[0];
                
                if (repoOwner.toLowerCase() !== GITHUB_USERNAME.toLowerCase()) {
                    externalRepos.add(repoName);
                }
            });
        }
        
        if (externalRepos.size === 0) {
            contributionsInfo.innerHTML = `
                <i class="fas fa-info-circle"></i> 
                No external contributions found. This section shows repositories you've contributed to that are owned by others.
            `;
            contributionsList.innerHTML = '';
            return;
        }
        
        // Step 3: Fetch details for each external repository
        contributionsInfo.textContent = `Fetching details for ${externalRepos.size} repositories...`;
        
        const repoPromises = Array.from(externalRepos).map(async (repoName) => {
            try {
                const response = await fetch(`${GITHUB_API}/repos/${repoName}`);
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
        
        contributionsInfo.innerHTML = `
            <i class="fas fa-check-circle"></i> 
            Found <strong>${validRepos.length}</strong> external ${validRepos.length === 1 ? 'repository' : 'repositories'} you've contributed to!
        `;
        
        // Display repositories
        contributionsList.innerHTML = validRepos.map(repo => createContributionCard(repo)).join('');
        
    } catch (error) {
        console.error('Error fetching contributions:', error);
        contributionsInfo.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-triangle"></i> 
                Error loading contributions: ${error.message}
                <br><small>Please check your internet connection or try again later.</small>
            </div>
        `;
    }
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
