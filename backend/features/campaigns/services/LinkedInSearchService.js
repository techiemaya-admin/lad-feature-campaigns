/**
 * LinkedIn Search Service
 * LAD Architecture: Service Layer (Business Logic — NO SQL)
 *
 * Handles LinkedIn people search via Unipile API.
 * Uses Gemini AI to parse natural language into structured search filters.
 * Resolves location names to LinkedIn location IDs via Unipile parameters endpoint.
 */
const axios = require('axios');
const logger = require('../../../core/utils/logger');
const UnipileBaseService = require('./UnipileBaseService');
const geminiClient = require('../../ai-icp-assistant/services/gemini-client.service');

// AI handles semantic taxonomy analysis now

class LinkedInSearchService extends UnipileBaseService {
    constructor() {
        super();
    }


    /**
     * Extract search intent from natural language using Gemini AI
     * e.g. "oil and energy office managers in hyderabad" →
     *   { keywords: "office manager", industries: ["Oil & Energy"], locations: ["Hyderabad"], job_titles: ["Office Manager"] }
     */
    async extractSearchIntent(naturalLanguageQuery) {
        logger.info('[LinkedInSearchService] Extracting search intent', { query: naturalLanguageQuery });

        const prompt = `You are an AI B2B Lead Generation Strategist.

Your job is to analyze the user's input and extract a precise Ideal Customer Profile (ICP) for LinkedIn lead search.

Your goal is to identify the most relevant decision makers, industries, and locations that match the user's intent.

IMPORTANT RULES:

1. Extract structured targeting filters from the user's request.
2. Always prioritize real LinkedIn job titles used by professionals.
3. Avoid vague keywords like "marketing people" or "business leaders".
4. Only include industries that exist on LinkedIn.
5. If the user mentions a city, extract the correct location.
6. If the user mentions a startup or company size, infer company headcount.
7. If the user input is a company URL (like linkedin.com/company/xxx), extract the company name from the URL slug.
8. Focus on decision makers who control budgets or purchasing decisions.
9. Prefer senior roles such as Director, Head, VP, C-level when appropriate.
COMPANY-SPECIFIC SEARCH RULES:
- If the query starts with "Search for people working at company:", the user wants to find employees at that specific company.
- ALWAYS extract the company name into "company_names" array.
- CRITICAL: Pay close attention to what the user is asking for:
  * If user says "find people" or "all people" or "everyone" or just a company name → set job_titles to EMPTY [] and seniority to EMPTY []. This returns ALL employees without any role filter.
  * If user says "decision makers" → set job_titles to ["CEO", "CTO", "CFO", "COO", "VP", "Director", "Founder", "Managing Director"] and seniority to ["CXO", "VP", "Director", "Owner"].
  * If user says a SPECIFIC role like "founders" or "engineers" or "CEO" → set job_titles to ONLY that specific role (e.g. ["Founder"] or ["Software Engineer"] or ["CEO"]).
- If the user provides a LinkedIn company URL, extract the company name from the URL path (e.g. "https://linkedin.com/company/openai" → company_names: ["OpenAI"]).

PERSON-SPECIFIC SEARCH RULES:
- If the query starts with "Find specific person:", the user wants to find one specific individual.
- Extract the person's name into "keywords" field.
- If a company is mentioned, extract it into "company_names".
- If a job title is mentioned, extract it into "job_titles".
- If a location is mentioned, extract it into "locations".

Return results ONLY as JSON.

JSON STRUCTURE:

{
  "keywords": "",
  "job_titles": [],
  "industries": [],
  "locations": [],
  "functions": [],
  "seniority": [],
  "company_headcount": [],
  "company_names": [],
  "profile_language": []
}

FIELD RULES:

job_titles:
Use real professional titles such as:
- Marketing Director
- Head of Sales
- Procurement Manager
- Travel Manager
- CEO
- Founder
- Investment Director

industries:
Use common LinkedIn industries such as:
- Financial Services
- Information Technology
- Real Estate
- Management Consulting
- Marketing & Advertising
- E-commerce
- Hospitality
- Investment Management

locations:
Return full location names such as:
- London, United Kingdom
- Dubai, United Arab Emirates
- New York, United States

seniority:
Use:
- Manager
- Director
- VP
- CXO
- Owner

company_headcount:
Use ranges:
- 1-10
- 11-50
- 51-200
- 201-500
- 501-1000
- 1001-5000
- 5000+

Example 1 Input:
"Marketing directors at fintech startups in London"

Example 1 Output:

{
  "keywords": "marketing directors fintech startups london",
  "job_titles": ["Marketing Director", "Head of Marketing", "CMO"],
  "industries": ["Financial Services", "Information Technology"],
  "locations": ["London, United Kingdom"],
  "functions": ["Marketing"],
  "seniority": ["Director", "CXO"],
  "company_headcount": ["11-50", "51-200"],
  "company_names": [],
  "profile_language": []
}

Example 2 Input:
"Search for people working at company: find all people in techiemaya"

Example 2 Output:

{
  "keywords": "techiemaya",
  "job_titles": [],
  "industries": [],
  "locations": [],
  "functions": [],
  "seniority": [],
  "company_headcount": [],
  "company_names": ["techiemaya"],
  "profile_language": []
}

Example 3 Input:
"Find specific person: naveen reddy yeluru, founder at techiemaya"

Example 3 Output:

{
  "keywords": "naveen reddy yeluru",
  "job_titles": ["Founder"],
  "industries": [],
  "locations": [],
  "functions": [],
  "seniority": ["Owner"],
  "company_headcount": [],
  "company_names": ["techiemaya"],
  "profile_language": []
}

Example 4 Input:
"Search for people working at company: find decision makers at Tesla USA"

Example 4 Output:

{
  "keywords": "Tesla",
  "job_titles": ["CEO", "CTO", "CFO", "COO", "VP", "Director", "Founder", "Managing Director"],
  "industries": [],
  "locations": ["United States"],
  "functions": [],
  "seniority": ["CXO", "VP", "Director", "Owner"],
  "company_headcount": [],
  "company_names": ["Tesla"],
  "profile_language": []
}

Example 5 Input:
"Search for people working at company: founders in techiemaya"

Example 5 Output:

{
  "keywords": "techiemaya",
  "job_titles": ["Founder", "Co-Founder"],
  "industries": [],
  "locations": [],
  "functions": [],
  "seniority": ["Owner"],
  "company_headcount": [],
  "company_names": ["techiemaya"],
  "profile_language": []
}

Example 6 Input:
"Search for people working at company: techiemaya"

Example 6 Output:

{
  "keywords": "techiemaya",
  "job_titles": [],
  "industries": [],
  "locations": [],
  "functions": [],
  "seniority": [],
  "company_headcount": [],
  "company_names": ["techiemaya"],
  "profile_language": []
}

Always return clean JSON with no explanation.

User query: "${naturalLanguageQuery}"`;

        try {
            const responseText = await geminiClient.generateContent(prompt);
            // Clean and parse JSON response
            let cleaned = responseText.trim();
            // Remove code fences if present
            cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/gi, '');
            const parsed = JSON.parse(cleaned);

            logger.info('[LinkedInSearchService] Extracted search intent', {
                keywords: parsed.keywords,
                jobTitles: parsed.job_titles?.length,
                industries: parsed.industries?.length,
                locations: parsed.locations?.length
            });

            return {
                success: true,
                intent: {
                    keywords: parsed.keywords || naturalLanguageQuery,
                    job_titles: parsed.job_titles || [],
                    industries: parsed.industries || [],
                    locations: parsed.locations || [],
                    functions: parsed.functions || [],
                    seniority: parsed.seniority || parsed.seniority_levels || [],
                    company_headcount: parsed.company_headcount || parsed.company_sizes || [],
                    company_names: parsed.company_names || [],
                    profile_language: parsed.profile_language || []
                }
            };
        } catch (error) {
            logger.error('[LinkedInSearchService] Error extracting search intent', { error: error.message });
            // Fallback: use the raw query as keywords
            return {
                success: true,
                intent: {
                    keywords: naturalLanguageQuery,
                    job_titles: [],
                    industries: [],
                    locations: [],
                    functions: [],
                    seniority: [],
                    company_headcount: [],
                    company_names: [],
                    profile_language: []
                }
            };
        }
    }

    /**
     * Generic Unipile Parameter Resolution (LOCATION, INDUSTRY, FUNCTION, SENIORITY, COMPANY_SIZE)
     */
    async resolveParameterIds(type, queryName, accountId) {
        if (!this.isConfigured() || !accountId || !queryName) return [];
        logger.info('[LinkedInSearchService] Resolving parameter ID', { type, queryName });

        try {
            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();

            // Use just the first meaningful word for the API query to get better results
            // e.g. "London, England, United Kingdom" → query with "London"
            // e.g. "Financial Services" → query with "Financial Services"
            const firstWord = queryName.split(',')[0].trim();

            const response = await axios.get(
                `${baseUrl}/linkedin/search/parameters`,
                {
                    headers,
                    params: { type, q: firstWord, account_id: accountId },
                    timeout: 15000
                }
            );

            const items = response.data?.items || response.data?.data?.items || response.data || [];
            const results = Array.isArray(items) ? items : [];

            const queryLower = queryName.toLowerCase().trim();
            const firstWordLow = firstWord.toLowerCase();

            // SCORING — most specific match wins
            // primaryWord = first word from firstWord that is ≥5 chars (avoids generic words like "and", "the", "services")
            const primaryWord = firstWord.split(' ').find(w => w.length >= 5)?.toLowerCase() || firstWordLow;

            const mapped = results.map(item => {
                const name = item.title || item.name || item.text || item.displayValue || '';
                const nameLow = name.toLowerCase();

                // Level 5: exact full match
                // Level 4: result starts with full query
                // Level 3: result contains full query
                // Level 2: result contains firstWord (e.g. "London" in "Greater London Area")
                // Level 1: result contains primaryWord (first significant word ≥5 chars)
                // Level 0: no match → ignored
                let score = 0;
                if (nameLow === queryLower) score = 5;
                else if (nameLow.startsWith(queryLower)) score = 4;
                else if (nameLow.includes(queryLower)) score = 3;
                else if (nameLow.includes(firstWordLow)) score = 2;
                else if (primaryWord && primaryWord.length >= 4 && nameLow.includes(primaryWord)) score = 1;

                return {
                    id: String(item.id || item.urn || item.value || ''),
                    name,
                    score,
                };
            });

            // Sort: score descending, then name length ascending (country 'India' before 'Ahmedabad, Gujarat, India')
            mapped.sort((a, b) => b.score - a.score || a.name.length - b.name.length);

            let bestMatch = mapped.find(m => m.score > 0) || null;
            const highestScore = mapped.length > 0 ? mapped[0].score : 0;

            // INTELLIGENT MATCHING: If we don't have a perfect exact string match (score 4 or 5), 
            // use Gemini AI to semantically figure out the closest match from the list!
            if (highestScore < 4 && mapped.length > 0) {
                try {
                    const prompt = `You are a LinkedIn taxonomy expert mapping a user's intent to the standard LinkedIn API list.
The user wants to filter by ${type.toLowerCase()} using the term: "${queryName}".

Here is the JSON list of available options returned by the LinkedIn search API:
${JSON.stringify(mapped.map(m => ({ id: m.id, name: m.name })))}

Select the ID of the ONE item from this list that is the best semantic match for the user's intent. 
For example, if the user wants "Information Technology", the best match might be "Technology, Information and Internet" or "IT Services and IT Consulting". 
If the user wants "Fintech", the best match is "Financial Services".

Return ONLY valid JSON like:
{"best_match_id": "123", "reasoning": "Explain why"}
If NO item in the list is a reasonably good logical match, return:
{"best_match_id": null, "reasoning": "No relevant match found."}`;

                    const rawResponse = await geminiClient.generateContent(prompt);
                    const cleaned = rawResponse.replace(/```json\s*|\s*```/g, '').trim();
                    const parsed = JSON.parse(cleaned);

                    if (parsed.best_match_id) {
                        const aiMatch = mapped.find(m => m.id === parsed.best_match_id);
                        if (aiMatch) {
                            bestMatch = { ...aiMatch, score: 99 }; // override to designate AI precision
                            logger.info('[LinkedInSearchService] Gemini AI dynamically picked parameter match!', { queryName, aiMatchName: aiMatch.name, reasoning: parsed.reasoning });

                            // Re-insert at top of mapped array so the caller uses it
                            mapped.unshift(bestMatch);
                        }
                    }
                } catch (aiErr) {
                    logger.warn('[LinkedInSearchService] Gemini AI parameter matching failed, falling back to basic scoring', { error: aiErr.message });
                }
            }

            logger.info('[LinkedInSearchService] Parameter resolved', {
                type,
                queryName,
                firstWord,
                resultsCount: mapped.length,
                bestMatch: bestMatch ? { id: bestMatch.id, name: bestMatch.name, score: bestMatch.score } : null
            });

            return mapped;
        } catch (error) {
            logger.error('[LinkedInSearchService] Error resolving parameter', { type, queryName, error: error.message });
            return [];
        }
    }

    /**
     * Get account ID for a tenant.
     * Resolves the first connected LinkedIn account's unipile_account_id.
     */
    async getAccountIdForTenant(tenantId, context) {
        const { pool } = require('../../../shared/database/connection');
        const { getSchema } = require('../../../core/utils/schemaHelper');
        const schema = getSchema(context);

        const result = await pool.query(
            `SELECT provider_account_id FROM ${schema}.social_linkedin_accounts 
       WHERE tenant_id = $1 AND status = 'active' AND is_deleted = false
       AND provider_account_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
            [tenantId]
        );

        if (result.rows.length === 0) {
            throw new Error('No active LinkedIn account found. Please connect a LinkedIn account first.');
        }

        return result.rows[0].provider_account_id;
    }

    /**
     * Execute LinkedIn People Search via Unipile API
     * Builds the search body from structured filters and calls the search endpoint
     */
    async searchPeople(searchParams, accountId) {
        if (!this.isConfigured()) {
            throw new Error('Unipile is not configured');
        }
        if (!accountId) {
            throw new Error('Account ID is required for LinkedIn search');
        }

        logger.info('[LinkedInSearchService] Executing LinkedIn people search', {
            keywords: searchParams.keywords,
            hasLocationIds: !!(searchParams.location_ids?.length),
            hasIndustryIds: !!(searchParams.industry_ids?.length),
            accountId
        });

        try {
            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();

            const buildSearchBody = (isNav) => {
                let body;
                if (isNav) {
                    body = {
                        api: 'sales_navigator',
                        category: 'people'
                    };
                    if (searchParams.keywords) {
                        body.keywords = searchParams.keywords;
                    }
                    if (searchParams.location_ids?.length) {
                        body.location = { include: searchParams.location_ids };
                    }
                    if (searchParams.industry_ids?.length) {
                        body.industry = { include: searchParams.industry_ids };
                    }
                    if (searchParams.function_ids?.length) {
                        body.function = { include: searchParams.function_ids };
                    }
                    if (searchParams.seniority_ids?.length) {
                        const validSeniorities = [];
                        for (const s of searchParams.seniority_ids) {
                            const ls = s.toLowerCase();
                            if (ls.includes('owner') || ls.includes('partner')) validSeniorities.push('owner/partner');
                            else if (ls.includes('cxo') || ls.includes('chief')) validSeniorities.push('cxo');
                            else if (ls.includes('vp') || ls.includes('vice')) validSeniorities.push('vice_president');
                            else if (ls.includes('director')) validSeniorities.push('director');
                            else if (ls.includes('manager')) validSeniorities.push('experienced_manager');
                            else if (ls.includes('senior')) validSeniorities.push('senior');
                            else if (ls.includes('entry')) validSeniorities.push('entry_level');
                            else if (ls.includes('training')) validSeniorities.push('in_training');
                        }
                        if (validSeniorities.length > 0) body.seniority = { include: validSeniorities };
                    }
                    if (searchParams.company_headcount_ids?.length) {
                        const validSizes = [];
                        for (const ch of searchParams.company_headcount_ids) {
                            if (ch.includes('1-10')) validSizes.push({ min: 1, max: 10 });
                            else if (ch.includes('11-50')) validSizes.push({ min: 11, max: 50 });
                            else if (ch.includes('51-200')) validSizes.push({ min: 51, max: 200 });
                            else if (ch.includes('201-500')) validSizes.push({ min: 201, max: 500 });
                            else if (ch.includes('501-1000')) validSizes.push({ min: 501, max: 1000 });
                            else if (ch.includes('1001-5000')) validSizes.push({ min: 1001, max: 5000 });
                            else if (ch.includes('5001-10000')) validSizes.push({ min: 5001, max: 10000 });
                            else if (ch.includes('10001')) validSizes.push({ min: 10001 });
                        }
                        if (validSizes.length > 0) body.company_headcount = validSizes;
                    }
                    if (searchParams.profile_language?.length) {
                        body.profile_language = searchParams.profile_language;
                    }
                    if (searchParams.title) {
                        body.role = { include: Array.isArray(searchParams.title) ? searchParams.title : [searchParams.title] };
                    }
                    if (searchParams.company) {
                        const compStr = Array.isArray(searchParams.company) ? searchParams.company[0] : searchParams.company;
                        body.company = { include: [compStr] };
                    }
                } else {
                    body = {
                        api: 'classic',
                        category: 'people'
                    };
                    if (searchParams.keywords) body.keywords = searchParams.keywords;
                    if (searchParams.location_ids?.length) body.location = searchParams.location_ids;
                    if (searchParams.profile_language?.length) body.profile_language = searchParams.profile_language;
                    
                    // Classic API has strict payload size limits
                    // When searching a company with many titles, prioritize company filter
                    const hasCompany = searchParams.company?.length > 0;
                    
                    if (searchParams.title?.length) {
                        const titles = Array.isArray(searchParams.title) ? searchParams.title : [searchParams.title];
                        // Limit to 3 titles max for classic API to avoid 400 "Content too large"
                        const limitedTitles = titles.slice(0, 3);
                        // If we have a company filter AND too many titles, skip titles entirely
                        // (company filter + keywords is enough for classic API)
                        if (!(hasCompany && titles.length > 4)) {
                            body.advanced_keywords = body.advanced_keywords || {};
                            body.advanced_keywords.title = limitedTitles.join(' OR ');
                        }
                    }
                    if (hasCompany) {
                        body.advanced_keywords = body.advanced_keywords || {};
                        body.advanced_keywords.company = Array.isArray(searchParams.company) ? searchParams.company[0] : searchParams.company;
                    }
                }
                return body;
            };

            const requestConfig = {
                headers,
                params: { account_id: accountId },
                timeout: 30000
            };

            // Add cursor for pagination if provided
            if (searchParams.cursor) {
                requestConfig.params.cursor = searchParams.cursor;
            }

            let response;
            let currentSearchBody = buildSearchBody(searchParams.isSalesNav);

            try {
                logger.info('[LinkedInSearchService] Search body attempt', { currentSearchBody, accountId });
                response = await axios.post(`${baseUrl}/linkedin/search`, currentSearchBody, requestConfig);
            } catch (err) {
                if (searchParams.isSalesNav && err.response?.status === 403) {
                    logger.warn('[LinkedInSearchService] Unipile Sales Navigator search threw 403 (Feature Not Subscribed). Falling back to classic API...');
                    currentSearchBody = buildSearchBody(false);
                    response = await axios.post(`${baseUrl}/linkedin/search`, currentSearchBody, requestConfig);
                } else {
                    throw err; // Re-throw if it wasn't a 403 or it was already on classic
                }
            }

            // Smart retry: if classic API returned 0 results AND we used a company filter,
            // retry with company name as keywords instead (LinkedIn doesn't recognize small companies as structured filters)
            const firstItems = response.data?.items || response.data?.data?.items || [];
            if (firstItems.length === 0 && currentSearchBody.api === 'classic' && currentSearchBody.advanced_keywords?.company) {
                const companyName = currentSearchBody.advanced_keywords.company;
                logger.info('[LinkedInSearchService] 0 results with company filter, retrying with company as keyword', { companyName });
                const retryBody = { ...currentSearchBody };
                retryBody.keywords = ((retryBody.keywords || '') + ' ' + companyName).trim();
                delete retryBody.advanced_keywords.company;
                if (Object.keys(retryBody.advanced_keywords).length === 0) delete retryBody.advanced_keywords;
                try {
                    response = await axios.post(`${baseUrl}/linkedin/search`, retryBody, requestConfig);
                    const retryItems = response.data?.items || response.data?.data?.items || [];
                    logger.info('[LinkedInSearchService] Retry search completed', { 
                        retryBody, 
                        resultsCount: retryItems.length 
                    });
                    
                    // Fuzzy secondary retry: if STILL 0 results, the user might have misspelled a last name or added a middle name.
                    // Classic API is a strict AND search. Retrying with just the FIRST word of the name + company.
                    if (retryItems.length === 0 && currentSearchBody.keywords) {
                        const firstWord = currentSearchBody.keywords.split(' ')[0];
                        if (firstWord && firstWord !== currentSearchBody.keywords) {
                            const fuzzyBody = { ...retryBody, keywords: firstWord + ' ' + companyName };
                            logger.info('[LinkedInSearchService] Still 0 results, trying fuzzy match with first word + company', { fuzzyBody });
                            const fuzzyResponse = await axios.post(`${baseUrl}/linkedin/search`, fuzzyBody, requestConfig);
                            const fuzzyItems = fuzzyResponse.data?.items || fuzzyResponse.data?.data?.items || [];
                            if (fuzzyItems.length > 0) {
                                response = fuzzyResponse;
                                logger.info('[LinkedInSearchService] Fuzzy retry succeeded!', { resultsCount: fuzzyItems.length });
                            }
                        }
                    }
                } catch (retryErr) {
                    logger.warn('[LinkedInSearchService] Retry search also failed', { error: retryErr.message });
                }
            }

            const responseData = response.data;
            const items = responseData?.items || responseData?.data?.items || [];
            const total = responseData?.total || responseData?.data?.total || items.length;
            const paging = responseData?.paging || responseData?.data?.paging || {};
            const cursor = responseData?.cursor || responseData?.data?.cursor || null;

            // Log raw first item for debugging (see what Unipile actually returns)
            if (items.length > 0) {
                logger.info('[LinkedInSearchService] Raw first item keys', {
                    keys: Object.keys(items[0]),
                    sample: JSON.stringify(items[0]).substring(0, 500)
                });
            }

            logger.info('[LinkedInSearchService] Search completed', {
                resultsCount: items.length,
                total,
                hasCursor: !!cursor
            });

            return {
                success: true,
                results: items.map(item => {
                    // Construct LinkedIn URL from public_identifier if no direct URL
                    const directUrl = item.public_profile_url || item.profile_url || item.linkedin_url || '';
                    const constructedUrl = !directUrl && item.public_identifier
                        ? `https://www.linkedin.com/in/${item.public_identifier}`
                        : '';
                    const profileUrl = directUrl || constructedUrl;

                    return {
                        // Core identity fields
                        id: item.id || item.provider_id || '',
                        provider_id: item.provider_id || item.id || '',
                        member_urn: item.member_urn || '',
                        public_identifier: item.public_identifier || '',
                        name: item.name || `${item.first_name || ''} ${item.last_name || ''}`.trim(),
                        first_name: item.first_name || '',
                        last_name: item.last_name || '',
                        // Professional info
                        headline: item.headline || item.title || '',
                        location: item.location || '',
                        current_company: item.current_company || item.company || '',
                        // URLs and media — use public_identifier to construct URL if needed
                        profile_url: profileUrl,
                        profile_picture: item.profile_picture_url || item.profile_picture || item.avatar || item.photo_url || '',
                        profile_picture_large: item.profile_picture_url_large || '',
                        // Contact info (if available)
                        email: item.email || null,
                        phone: item.phone || null,
                        // Additional fields Unipile returns
                        industry: item.industry || null,
                        network_distance: item.network_distance || null,
                        premium: item.premium || false,
                        summary: item.summary || null,
                        // Store the COMPLETE raw item for raw_data/lead_data JSONB columns
                        _raw: item
                    };
                }),
                total,
                paging,
                cursor
            };
        } catch (error) {
            logger.error('[LinkedInSearchService] Search failed', {
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw new Error(`LinkedIn search failed: ${error.message}`);
        }
    }

    /**
     * Full search pipeline:
     * 1. Extract intent from natural language using Gemini
     * 2. Resolve location names → LinkedIn location IDs
     * 3. Resolve industry names → LinkedIn industry IDs
     * 4. Execute LinkedIn people search
     */
    async fullSearch(naturalLanguageQuery, accountId, additionalFilters = {}) {
        logger.info('[LinkedInSearchService] Starting full search pipeline', { naturalLanguageQuery });

        // Step 1: Extract intent
        const intentResult = await this.extractSearchIntent(naturalLanguageQuery);
        const intent = intentResult.intent;

        // Merge additional filters (e.g., from follow-up questions)
        if (additionalFilters.locations && additionalFilters.locations.length > 0) {
            intent.locations = [...new Set([...intent.locations, ...additionalFilters.locations])];
        }
        if (additionalFilters.profile_language && additionalFilters.profile_language.length > 0) {
            intent.profile_language = [...new Set([...intent.profile_language, ...additionalFilters.profile_language])];
        }

        // Step 2: Resolve parameter IDs via Unipile generically
        // Even if isSalesNav is true, we use LOCATION and INDUSTRY types for compatibility
        // since Unipile may throw 401s on REGION/SALES_INDUSTRY if not natively subscribed.
        const locationType = 'LOCATION';
        const industryType = 'INDUSTRY';

        const locationIds = [];
        const unmappedLocations = [];
        for (const loc of intent.locations) {
            const resolved = await this.resolveParameterIds(locationType, loc, accountId);
            if (resolved.length > 0) locationIds.push(resolved[0].id);
            else unmappedLocations.push(loc);
        }

        const industryIds = [];
        const unmappedIndustries = [];
        for (const ind of intent.industries) {
            const resolved = await this.resolveParameterIds(industryType, ind, accountId);
            if (resolved.length > 0) industryIds.push(resolved[0].id);
            else unmappedIndustries.push(ind);
        }

        const functionIds = [];
        if (additionalFilters.isSalesNav) {
            for (const fn of (intent.functions || [])) {
                const resolved = await this.resolveParameterIds('DEPARTMENT', fn, accountId);
                if (resolved.length > 0) functionIds.push(resolved[0].id);
            }
        }

        // We do NOT attempt to resolve SENIORITY and COMPANY_SIZE via the parameter API!
        // These are hardcoded ENUM arrays per Unipile's schema. We map them during build.
        const seniorityIds = intent.seniority || [];
        const companyHeadcountIds = intent.company_headcount || [];

        // Step 4: Build and execute search
        let finalKeywords = intent.keywords;
        if (unmappedLocations.length > 0) {
            finalKeywords += ` ${unmappedLocations.join(' ')}`;
        }
        if (unmappedIndustries.length > 0) {
            finalKeywords += ` ${unmappedIndustries.join(' ')}`;
        }

        const searchParams = {
            isSalesNav: additionalFilters.isSalesNav || false,
            keywords: finalKeywords.trim(),
            location_ids: locationIds,
            industry_ids: industryIds,
            function_ids: functionIds,
            seniority_ids: seniorityIds,
            company_headcount_ids: companyHeadcountIds,
            profile_language: intent.profile_language,
            title: intent.job_titles.length > 0 ? intent.job_titles : undefined,
            company: intent.company_names.length > 0 ? intent.company_names : undefined,
            cursor: additionalFilters.cursor || undefined
        };

        const searchResult = await this.searchPeople(searchParams, accountId);

        return {
            success: true,
            intent,
            resolvedFilters: {
                locationIds,
                industryIds,
                functionIds,
                seniorityIds,
                companyHeadcountIds,
                profileLanguage: intent.profile_language
            },
            ...searchResult
        };
    }

    /**
     * Full search pipeline with a PRE-EXTRACTED intent (skips Gemini intent parse).
     * Used when the AI chat has already extracted job_titles / industries / locations
     * from the conversation context — avoids re-interpreting the query with Gemini.
     *
     * @param {string} queryHint   - Fallback keyword string (used if intent has no keywords)
     * @param {string} accountId   - Unipile Sales Navigator account ID
     * @param {Object} intent      - Pre-built intent { job_titles, industries, locations, keywords, profile_language }
     * @param {Object} additionalFilters - Extra options (isSalesNav, start, count, cursor)
     */
    async fullSearchWithIntent(queryHint, accountId, intent, additionalFilters = {}) {
        logger.info('[LinkedInSearchService] fullSearchWithIntent — using pre-extracted intent', {
            job_titles: intent.job_titles,
            industries: intent.industries,
            locations: intent.locations,
            queryHint,
        });

        // Build keywords:
        // - Prefer explicit intent.keywords if present
        // - Otherwise use job_titles[0] as the primary keyword (NOT the full queryHint which is too verbose)
        // - queryHint is only used as last resort when nothing else is available
        const rawKw = Array.isArray(intent.keywords)
            ? intent.keywords.join(' ')
            : String(intent.keywords || '');

        const normIntent = {
            // Use explicit keywords if set; else empty — will derive from job_titles below
            keywords: rawKw.trim(),
            job_titles: intent.job_titles || [],
            industries: intent.industries || [],
            locations: intent.locations || [],
            functions: intent.functions || [],
            seniority: intent.seniority || [],
            company_headcount: intent.company_headcount || [],
            company_names: intent.company_names || [],
            profile_language: intent.profile_language || [],
        };

        // Resolve location names → LinkedIn IDs
        const locationType = 'LOCATION';
        const industryType = 'INDUSTRY';
        const locationIds = [];
        const unmappedLocs = [];

        for (const loc of normIntent.locations) {
            const resolved = await this.resolveParameterIds(locationType, loc, accountId);
            // Only use the result if it has a real match (score > 0)
            const best = resolved.find(r => r.score > 0);
            if (best) locationIds.push(best.id);
            else unmappedLocs.push(loc);
        }

        const industryIds = [];
        const unmappedInds = [];

        for (const rawInd of normIntent.industries) {
            const ind = rawInd; // We now use AI to resolve aliases inline in resolveParameterIds instead of hardcoding
            const resolved = await this.resolveParameterIds(industryType, ind, accountId);
            // Only use the result if it has a real match (score > 0)
            const best = resolved.find(r => r.score > 0);
            if (best) industryIds.push(best.id);
            else unmappedInds.push(ind); // use normalized name in keyword fallback
        }

        // Build final keywords string:
        // By default, do not pollute keywords with job titles since we use the 'role' filter natively now.
        // Only use keywords if the user explicitly provided them, or as a last resort fallback.
        let finalKeywords = '';
        if (normIntent.keywords && typeof normIntent.keywords === 'string') {
            finalKeywords = normIntent.keywords;
        } else if (normIntent.job_titles.length === 0) {
            finalKeywords = String(queryHint || '').split(' ').slice(0, 3).join(' ');
        }

        // Append unresolved locations/industries as keyword fallback
        if (unmappedLocs.length > 0) finalKeywords += ` ${unmappedLocs.join(' ')}`;
        if (unmappedInds.length > 0) finalKeywords += ` ${unmappedInds.join(' ')}`;

        const searchParams = {
            isSalesNav: additionalFilters.isSalesNav || false,
            keywords: finalKeywords.trim(),
            location_ids: locationIds,
            industry_ids: industryIds,
            function_ids: [],
            seniority_ids: normIntent.seniority,
            company_headcount_ids: normIntent.company_headcount,
            profile_language: normIntent.profile_language,
            title: normIntent.job_titles.length > 0 ? normIntent.job_titles : undefined,
            company: normIntent.company_names.length > 0 ? normIntent.company_names : undefined,
            cursor: additionalFilters.cursor || undefined,
        };

        logger.info('[LinkedInSearchService] fullSearchWithIntent search params', {
            keywords: searchParams.keywords,
            location_ids: searchParams.location_ids,
            industry_ids: searchParams.industry_ids,
            title: searchParams.title,
        });

        const searchResult = await this.searchPeople(searchParams, accountId);

        return {
            success: true,
            intent: normIntent,
            resolvedFilters: {
                locationIds,
                industryIds,
                functionIds: [],
                seniorityIds: normIntent.seniority,
                companyHeadcountIds: normIntent.company_headcount,
                profileLanguage: normIntent.profile_language,
            },
            ...searchResult,
        };
    }

    /**
     * Generate a summary of search intent for the AI chat
     * e.g. "I'll search for Office Managers in Oil & Energy in Hyderabad"
     */
    generateIntentSummary(intent) {
        const parts = [];

        if (intent.job_titles && intent.job_titles.length > 0) {
            parts.push(`**${intent.job_titles.join(', ')}**`);
        }

        if (intent.industries && intent.industries.length > 0) {
            parts.push(`in **${intent.industries.join(', ')}**`);
        }

        if (intent.locations && intent.locations.length > 0) {
            parts.push(`located in **${intent.locations.join(', ')}**`);
        }

        if (intent.profile_language && intent.profile_language.length > 0) {
            const langMap = { en: 'English', hi: 'Hindi', fr: 'French', de: 'German', es: 'Spanish', ja: 'Japanese', zh: 'Chinese', ar: 'Arabic', pt: 'Portuguese', ko: 'Korean', it: 'Italian', nl: 'Dutch', ru: 'Russian', tr: 'Turkish' };
            const langs = intent.profile_language.map(l => langMap[l] || l);
            parts.push(`(${langs.join('/')} profiles)`);
        }

        if (parts.length === 0) {
            return `Searching for: **${intent.keywords}**`;
        }

        return `Targeting: ${parts.join(' ')}`;
    }
}
module.exports = LinkedInSearchService;
