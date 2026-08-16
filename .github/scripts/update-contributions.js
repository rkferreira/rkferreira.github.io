const fs = require('fs');
const path = require('path');

const GITHUB_USERNAME = 'rkferreira';
const GITHUB_API = 'https://api.github.com';
const OUTPUT_FILE = path.join(__dirname, '../../contributions.json');
const OUTPUT_CERTS_FILE = path.join(__dirname, '../../certifications.json');

// Setup headers for authentication and GitHub API requirements
const headers = {
    'User-Agent': 'rkferreira-portfolio-updater',
    'Accept': 'application/vnd.github.v3+json'
};

if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
    console.log('Using GITHUB_TOKEN for authentication.');
} else {
    console.warn('Warning: No GITHUB_TOKEN provided. Requests will be unauthenticated and subject to rate limits.');
}

async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            if (response.status === 403 || response.status === 429) {
                const rateLimitReset = response.headers.get('x-ratelimit-reset');
                if (rateLimitReset) {
                    const waitTime = (parseInt(rateLimitReset) * 1000) - Date.now();
                    if (waitTime > 0 && waitTime < 10000) { // only wait if it's less than 10 seconds
                        console.log(`Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s before retry...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime + 500));
                        continue;
                    }
                }
            }
            throw new Error(`HTTP error! Status: ${response.status}`);
        } catch (error) {
            if (i === retries - 1) throw error;
            console.warn(`Attempt ${i + 1} failed: ${error.message}. Retrying in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            backoff *= 2;
        }
    }
}

async function updateContributions() {
    try {
        console.log(`Starting contributions update for user: ${GITHUB_USERNAME}`);
        const externalRepos = new Set();

        // Step 1: Fetch recent public events
        console.log('Fetching recent public events...');
        const eventsResponse = await fetchWithRetry(`${GITHUB_API}/users/${GITHUB_USERNAME}/events/public?per_page=100`, { headers });
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
        console.log(`Found ${externalRepos.size} external repositories from recent events.`);

        // Step 2: Search for all Pull Requests
        console.log('Searching for pull requests...');
        const searchQuery = `author:${GITHUB_USERNAME} type:pr`;
        const searchResponse = await fetchWithRetry(
            `${GITHUB_API}/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=100`,
            { headers }
        );
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
        console.log(`Total unique external repositories identified: ${externalRepos.size}`);

        if (externalRepos.size === 0) {
            console.log('No external contributions found. Writing empty array to contributions.json.');
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify([], null, 2));
            return;
        }

        // Step 3: Fetch details for each external repository
        console.log(`Fetching detailed information for ${externalRepos.size} repositories...`);
        const reposData = [];
        
        for (const repoName of externalRepos) {
            try {
                console.log(`Fetching: ${repoName}`);
                const response = await fetchWithRetry(`${GITHUB_API}/repos/${repoName}`, { headers });
                const repoInfo = await response.json();
                
                // Only store necessary fields to keep JSON file small
                reposData.push({
                    full_name: repoInfo.full_name,
                    html_url: repoInfo.html_url,
                    description: repoInfo.description,
                    language: repoInfo.language,
                    stargazers_count: repoInfo.stargazers_count,
                    forks_count: repoInfo.forks_count,
                    updated_at: repoInfo.updated_at
                });
            } catch (error) {
                console.error(`Failed to fetch details for ${repoName}:`, error.message);
            }
        }

        // Sort by stargazers count descending
        reposData.sort((a, b) => b.stargazers_count - a.stargazers_count);

        // Write to output file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(reposData, null, 2));
        console.log(`Successfully updated ${OUTPUT_FILE} with ${reposData.length} repositories.`);

    } catch (error) {
        console.error('Error updating contributions:', error);
        process.exit(1);
    }
}

async function updateCertifications() {
    try {
        console.log('Fetching certifications from Credly API...');
        const response = await fetch('https://www.credly.com/users/rodkf/badges.json', {
            headers: {
                'User-Agent': 'rkferreira-portfolio-updater',
                'Accept': 'application/json'
            }
        });

        if (response.ok) {
            const rawData = await response.json();
            const badges = rawData.data || [];
            const outputList = badges.map(b => {
                const tmpl = b.badge_template || {};
                let issuerName = tmpl.issuer?.summary || (tmpl.issuer?.entities?.[0]?.entity?.name) || 'Credly';
                if (issuerName.startsWith('issued by ')) {
                    issuerName = issuerName.substring(10);
                }
                return {
                    id: b.id,
                    name: tmpl.name,
                    issuer: issuerName,
                    issued_at_date: b.issued_at_date,
                    expires_at_date: b.expires_at_date,
                    image_url: tmpl.image_url,
                    badge_url: `https://www.credly.com/badges/${b.id}`
                };
            });

            fs.writeFileSync(OUTPUT_CERTS_FILE, JSON.stringify(outputList, null, 2));
            console.log(`Successfully updated ${OUTPUT_CERTS_FILE} with ${outputList.length} certifications.`);
        } else {
            console.warn(`Credly API returned status ${response.status}. Keeping existing certifications.json.`);
        }
    } catch (error) {
        console.error('Error updating certifications:', error.message);
        // Do not crash main process if Credly API fails
    }
}

async function main() {
    await updateContributions();
    await updateCertifications();
}

main();

