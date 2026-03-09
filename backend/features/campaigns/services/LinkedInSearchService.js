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

/**
 * Maps common AI-generated industry names → exact LinkedIn/Unipile parameter API names.
 * LinkedIn uses specific industry taxonomy — many variations exist in common usage.
 * Add more as you discover mismatches in logs (look for "bestMatch: null").
 */
const INDUSTRY_ALIAS_MAP = {
    // Travel & Hospitality
    'leisure, travel & tourism': 'Travel Arrangements',
    'leisure travel tourism': 'Travel Arrangements',
    'travel & tourism': 'Travel Arrangements',
    'travel and tourism': 'Travel Arrangements',
    'travel': 'Travel Arrangements',
    'tourism': 'Travel Arrangements',
    'hospitality': 'Hospitality',
    'hotels': 'Hospitality',
    'hotel and hospitality': 'Hospitality',
    'food and beverage': 'Food and Beverage Services',
    'restaurants': 'Food and Beverage Services',

    // Finance & Tech
    'fintech': 'Financial Services',
    'financial technology': 'Financial Services',
    'finance': 'Financial Services',
    'banking': 'Banking',
    'investment': 'Investment Management',
    'insurance': 'Insurance',

    // Energy
    'oil and energy': 'Oil and Gas',
    'oil & energy': 'Oil and Gas',
    'oil and gas': 'Oil and Gas',
    'energy': 'Utilities',
    'renewable energy': 'Renewable Energy Semiconductor Manufacturing',

    // Technology
    'technology': 'Software Development',
    'software': 'Software Development',
    'it': 'IT Services and IT Consulting',
    'information technology': 'IT Services and IT Consulting',
    'saas': 'Software Development',
    'ecommerce': 'Online Commerce',
    'e-commerce': 'Online Commerce',

    // Healthcare & Education
    'healthcare': 'Hospitals and Health Care',
    'health': 'Hospitals and Health Care',
    'pharma': 'Pharmaceutical Manufacturing',
    'pharmaceuticals': 'Pharmaceutical Manufacturing',
    'education': 'Education Administration Programs',

    // Professional Services
    'consulting': 'Business Consulting and Services',
    'management consulting': 'Business Consulting and Services',
    'marketing': 'Advertising Services',
    'advertising': 'Advertising Services',
    'hr': 'Human Resources Services',
    'human resources': 'Human Resources Services',
    'recruitment': 'Staffing and Recruiting',
    'real estate': 'Real Estate',
    'construction': 'Construction',
    'retail': 'Retail',
    'logistics': 'Transportation, Logistics, Supply Chain and Storage',
    'supply chain': 'Transportation, Logistics, Supply Chain and Storage',
    'legal': 'Law Practice',
};

/**
 * Normalize an AI-generated industry name to the closest LinkedIn API name.
 * Returns the normalized name, or the original if no mapping found.
 */
function normalizeIndustryName(industry) {
    if (!industry) return industry;
    const key = industry.toLowerCase().trim();
    return INDUSTRY_ALIAS_MAP[key] || industry;
}

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

        const prompt = `You are a LinkedIn search expert. Parse the following natural language query into structured LinkedIn search filters for Sales Navigator.

User query: "${naturalLanguageQuery}"

Return ONLY a valid JSON object (no markdown, no code fences) with these fields:
{
  "keywords": "main search keywords (keep short, 2-4 words max)",
  "job_titles": ["array of job titles mentioned or implied"],
  "industries": ["array of industries mentioned - use LinkedIn industry names like: Software Development, Financial Services, Healthcare, etc."],
  "locations": ["array of location names mentioned (cities, states, countries)"],
  "functions": ["array of job functions if mentioned - e.g. Sales, Marketing, Engineering, Information Technology"],
  "seniority": ["array of seniority levels if mentioned: Owner, Partner, CXO, VP, Director, Manager, Senior, Entry, Training"],
  "company_headcount": ["array of company size ranges if mentioned: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10001+"],
  "company_names": ["array of specific company names if mentioned"],
  "profile_language": ["ISO 639-1 language codes if nationality/language is mentioned, e.g. 'en', 'hi', 'fr'"]
}

Rules:
- Always extract at least keywords
- If a parameter category is not mentioned, return empty array
- If nationality is mentioned (e.g. "Indian"), add the country to locations AND set profile_language
- Keep keywords concise
- Return ONLY the JSON object, nothing else`;

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
                else if (primaryWord.length >= 5 && nameLow.includes(primaryWord)) score = 1;
                // Intentionally NO generic word-level score — avoids false positives like
                // "Accommodation and Food Services" matching "Financial Services" via "services"

                return {
                    id: String(item.id || item.urn || item.value || ''),
                    name,
                    score,
                };
            });

            // Sort: score descending, then name length ascending (country 'India' before 'Ahmedabad, Gujarat, India')
            mapped.sort((a, b) => b.score - a.score || a.name.length - b.name.length);

            // bestMatch = first item with score > 0
            const bestMatch = mapped.find(m => m.score > 0) || null;

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
                        const titleStr = Array.isArray(searchParams.title) ? searchParams.title[0] : searchParams.title;
                        body.role = { include: [titleStr] };
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
                    if (searchParams.title?.length) {
                        body.advanced_keywords = body.advanced_keywords || {};
                        body.advanced_keywords.title = searchParams.title;
                    }
                    if (searchParams.company?.length) {
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
            title: intent.job_titles.length > 0 ? intent.job_titles[0] : undefined,
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

        // Resolve industry names → LinkedIn IDs
        // Apply alias normalization first (FinTech→Financial Services, Hospitality→Hospitality, etc.)
        const industryIds = [];
        const unmappedInds = [];

        for (const rawInd of normIntent.industries) {
            const ind = normalizeIndustryName(rawInd);
            if (ind !== rawInd) {
                logger.info('[LinkedInSearchService] Industry normalized', { from: rawInd, to: ind });
            }
            const resolved = await this.resolveParameterIds(industryType, ind, accountId);
            // Only use the result if it has a real match (score > 0)
            const best = resolved.find(r => r.score > 0);
            if (best) industryIds.push(best.id);
            else unmappedInds.push(ind); // use normalized name in keyword fallback
        }

        // Build final keywords string:
        // PRIORITY: job_titles[0] > explicit keywords > first 3 words of queryHint
        // Rationale: job title is the most targeted keyword for LinkedIn search.
        // "startup", "fintech" style keywords extracted by Gemini are noisy and cause 0 results.
        let finalKeywords = '';
        if (normIntent.job_titles.length > 0) {
            // Always prefer job title as primary keyword — most relevant for LinkedIn search
            finalKeywords = normIntent.job_titles[0];
        } else if (normIntent.keywords) {
            finalKeywords = String(normIntent.keywords);
        } else {
            // Last resort: first 3 words of queryHint
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
            title: normIntent.job_titles.length > 0 ? normIntent.job_titles[0] : undefined,
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
