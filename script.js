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

// Fetch all repositories and filter for contributions since 2020
async function fetchContributions() {
    const contributionsList = document.getElementById('contributions-list');
    const contributionsInfo = document.querySelector('.contributions-info p');
    
    try {
        contributionsInfo.textContent = 'Fetching your contributions from GitHub (since 2020)...';
        
        const externalRepos = new Set();
        const repoContributionData = new Map(); // Store contribution counts per repo
        
        // Step 1: Fetch recent events
        contributionsInfo.textContent = 'Scanning recent activity...';
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
        
        // Step 2: Search for Pull Requests (since 2020) - paginate through multiple pages
        contributionsInfo.textContent = 'Searching for pull requests since 2020...';
        const startYear = 2020;
        const currentYear = new Date().getFullYear();
        
        for (let year = startYear; year <= currentYear; year++) {
            const dateRange = year === currentYear 
                ? `${year}-01-01..${new Date().toISOString().split('T')[0]}`
                : `${year}-01-01..${year}-12-31`;
            
            // Fetch multiple pages for each year
            for (let page = 1; page <= 3; page++) {
                try {
                    const searchQuery = `author:${GITHUB_USERNAME}+type:pr+created:${dateRange}`;
                    const searchResponse = await fetch(
                        `${GITHUB_API}/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=100&page=${page}`
                    );
                    
                    if (searchResponse.ok) {
                        const searchData = await searchResponse.json();
                        
                        if (searchData.items.length === 0) break; // No more results for this year
                        
                        searchData.items.forEach(pr => {
                            const repoName = pr.repository_url.replace('https://api.github.com/repos/', '');
                            const repoOwner = repoName.split('/')[0];
                            
                            if (repoOwner.toLowerCase() !== GITHUB_USERNAME.toLowerCase()) {
                                externalRepos.add(repoName);
                                // Count contributions per repo
                                const count = repoContributionData.get(repoName) || 0;
                                repoContributionData.set(repoName, count + 1);
                            }
                        });
                        
                        // Wait a bit to respect rate limits
                        await sleep(500);
                    }
                } catch (error) {
                    console.error(`Error fetching PRs for year ${year}, page ${page}:`, error);
                }
            }
            
            contributionsInfo.textContent = `Searching for pull requests... (${year}/${currentYear})`;
        }
        
        // Step 3: Search for Issues (since 2020)
        contributionsInfo.textContent = 'Searching for issues and comments since 2020...';
        
        for (let year = startYear; year <= currentYear; year++) {
            const dateRange = year === currentYear 
                ? `${year}-01-01..${new Date().toISOString().split('T')[0]}`
                : `${year}-01-01..${year}-12-31`;
            
            try {
                const searchQuery = `author:${GITHUB_USERNAME}+type:issue+created:${dateRange}`;
                const searchResponse = await fetch(
                    `${GITHUB_API}/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=100`
                );
                
                if (searchResponse.ok) {
                    const searchData = await searchResponse.json();
                    
                    searchData.items.forEach(issue => {
                        const repoName = issue.repository_url.replace('https://api.github.com/repos/', '');
                        const repoOwner = repoName.split('/')[0];
                        
                        if (repoOwner.toLowerCase() !== GITHUB_USERNAME.toLowerCase()) {
                            externalRepos.add(repoName);
                            const count = repoContributionData.get(repoName) || 0;
                            repoContributionData.set(repoName, count + 1);
                        }
                    });
                    
                    await sleep(500);
                }
            } catch (error) {
                console.error(`Error fetching issues for year ${year}:`, error);
            }
        }
        
        if (externalRepos.size === 0) {
            contributionsInfo.innerHTML = `
                <i class="fas fa-info-circle"></i> 
                No external contributions found since 2020. This section shows repositories you've contributed to that are owned by others.
                <br><br>
                <small>External contributions include pull requests and issues created in repositories owned by other users or organizations.</small>
            `;
            contributionsList.innerHTML = '';
            return;
        }
        
        // Step 4: Fetch details for each external repository
        contributionsInfo.textContent = `Fetching details for ${externalRepos.size} repositories...`;
        
        const repoPromises = Array.from(externalRepos).map(async (repoName) => {
            try {
                const response = await fetch(`${GITHUB_API}/repos/${repoName}`);
                if (response.ok) {
                    const repoData = await response.json();
                    // Add contribution count to repo data
                    repoData.contributionCount = repoContributionData.get(repoName) || 0;
                    return repoData;
                }
            } catch (error) {
                console.error(`Error fetching ${repoName}:`, error);
            }
            return null;
        });
        
        const reposData = await Promise.all(repoPromises);
        const validRepos = reposData.filter(repo => repo !== null);
        
        // Sort by contribution count first, then by stars
        validRepos.sort((a, b) => {
            if (b.contributionCount !== a.contributionCount) {
                return b.contributionCount - a.contributionCount;
            }
            return b.stargazers_count - a.stargazers_count;
        });
        
        contributionsInfo.innerHTML = `
            <i class="fas fa-check-circle"></i> 
            Found <strong>${validRepos.length}</strong> external ${validRepos.length === 1 ? 'repository' : 'repositories'} you've contributed to since 2020!
            <br><small>Showing contributions from ${startYear} to ${currentYear}</small>
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

// Helper function to sleep/delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Create HTML for a contribution card
function createContributionCard(repo) {
    const description = repo.description || 'No description available';
    const language = repo.language || 'Unknown';
    const stars = repo.stargazers_count || 0;
    const forks = repo.forks_count || 0;
    const contributionCount = repo.contributionCount || 0;
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
                ${contributionCount > 0 ? `
                <span class="stat" title="Your contributions (PRs/Issues)">
                    <i class="fas fa-hands-helping"></i>
                    ${contributionCount} ${contributionCount === 1 ? 'contribution' : 'contributions'}
                </span>
                ` : ''}
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
