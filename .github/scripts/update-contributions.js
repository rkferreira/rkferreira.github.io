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

const EXCLUDED_ORGS = ['grupoboticario'];

function isExcludedRepo(repoName) {
    if (!repoName || typeof repoName !== 'string') return true;
    const repoOwner = repoName.split('/')[0].toLowerCase();
    return repoOwner === GITHUB_USERNAME.toLowerCase() || EXCLUDED_ORGS.includes(repoOwner);
}

async function updateContributions() {
    try {
        console.log(`Starting contributions update for user: ${GITHUB_USERNAME}`);
        
        // Step 0: Load existing contributions to ensure we never remove anyone (except excluded orgs)
        const reposMap = new Map();
        if (fs.existsSync(OUTPUT_FILE)) {
            try {
                const existingContent = fs.readFileSync(OUTPUT_FILE, 'utf8');
                const existingList = JSON.parse(existingContent);
                if (Array.isArray(existingList)) {
                    for (const repo of existingList) {
                        if (repo && repo.full_name && !isExcludedRepo(repo.full_name)) {
                            reposMap.set(repo.full_name.toLowerCase(), repo);
                        }
                    }
                    console.log(`Loaded ${reposMap.size} existing contributions from ${OUTPUT_FILE}.`);
                }
            } catch (err) {
                console.warn('Could not parse existing contributions.json:', err.message);
            }
        }

        const externalRepos = new Set(Array.from(reposMap.values()).map(r => r.full_name));

        // Step 1: Fetch recent public events
        console.log('Fetching recent public events...');
        try {
            const eventsResponse = await fetchWithRetry(`${GITHUB_API}/users/${GITHUB_USERNAME}/events/public?per_page=100`, { headers });
            const events = await eventsResponse.json();
            
            if (Array.isArray(events)) {
                events.forEach(event => {
                    if (event.repo && event.repo.name) {
                        const repoName = event.repo.name;
                        if (!isExcludedRepo(repoName)) {
                            externalRepos.add(repoName);
                        }
                    }
                });
            }
            console.log(`Found external repositories from recent events. Total candidates: ${externalRepos.size}`);
        } catch (err) {
            console.warn('Failed to fetch public events:', err.message);
        }

        // Step 2: Search for all Pull Requests
        console.log('Searching for pull requests...');
        try {
            const searchQuery = `author:${GITHUB_USERNAME} type:pr`;
            const searchResponse = await fetchWithRetry(
                `${GITHUB_API}/search/issues?q=${encodeURIComponent(searchQuery)}&sort=updated&per_page=100`,
                { headers }
            );
            const searchData = await searchResponse.json();
            
            if (searchData.items && Array.isArray(searchData.items)) {
                searchData.items.forEach(pr => {
                    const repoName = pr.repository_url.replace('https://api.github.com/repos/', '');
                    if (!isExcludedRepo(repoName)) {
                        externalRepos.add(repoName);
                    }
                });
            }
            console.log(`Total unique external repositories identified: ${externalRepos.size}`);
        } catch (err) {
            console.warn('Failed to search pull requests:', err.message);
        }

        if (externalRepos.size === 0) {
            console.log('No external contributions found. Writing empty array to contributions.json.');
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify([], null, 2));
            return;
        }

        // Step 3: Fetch details for each external repository
        console.log(`Fetching detailed information for ${externalRepos.size} repositories...`);
        
        for (const repoName of externalRepos) {
            const key = repoName.toLowerCase();
            const existingEntry = reposMap.get(key);
            try {
                console.log(`Fetching: ${repoName}`);
                const response = await fetchWithRetry(`${GITHUB_API}/repos/${repoName}`, { headers });
                const repoInfo = await response.json();
                
                // Exclude if redirected/renamed to an excluded org
                if (repoInfo.full_name && isExcludedRepo(repoInfo.full_name)) {
                    reposMap.delete(key);
                    continue;
                }

                // Only store necessary fields to keep JSON file small
                reposMap.set(key, {
                    full_name: repoInfo.full_name || repoName,
                    html_url: repoInfo.html_url || `https://github.com/${repoName}`,
                    description: repoInfo.description !== undefined ? repoInfo.description : (existingEntry?.description || null),
                    language: repoInfo.language || existingEntry?.language || null,
                    stargazers_count: typeof repoInfo.stargazers_count === 'number' ? repoInfo.stargazers_count : (existingEntry?.stargazers_count || 0),
                    forks_count: typeof repoInfo.forks_count === 'number' ? repoInfo.forks_count : (existingEntry?.forks_count || 0),
                    updated_at: repoInfo.updated_at || existingEntry?.updated_at || new Date().toISOString()
                });
            } catch (error) {
                console.error(`Failed to fetch details for ${repoName}:`, error.message);
                if (existingEntry) {
                    console.log(`Retaining existing data for ${repoName}`);
                    reposMap.set(key, existingEntry);
                }
            }
        }

        const reposData = Array.from(reposMap.values());

        // Sort by stargazers count descending
        reposData.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));

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

