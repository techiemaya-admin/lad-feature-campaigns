const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../../../core/utils/logger');
const geminiClientService = require('./gemini-client.service');
const UnipileBaseService = require('../../campaigns/services/UnipileBaseService');

class CompanyAnalyzerService extends UnipileBaseService {
    constructor() {
        super();
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
     * Extract profile identifier from LinkedIn URL
     */
    extractProfileIdentifier(url) {
        const cleanUrl = url.trim().replace(/\/$/, '');
        const companyMatch = cleanUrl.match(/linkedin\.com\/company\/([^/?]+)/i);
        if (companyMatch) return { identifier: companyMatch[1], isCompany: true };
        const match = cleanUrl.match(/linkedin\.com\/in\/([^/?]+)/i);
        if (match) return { identifier: match[1], isCompany: false };
        return { identifier: cleanUrl.split('/').pop(), isCompany: false };
    }

    /**
     * Fetch top 10 recent posts for a company via Unipile
     */
    async fetchCompanyPosts(companyId, accountId) {
        try {
            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();

            const requestBody = {
                api: 'classic',
                category: 'posts',
                posted_by: {
                    company: [companyId]
                }
            };

            const response = await axios.post(
                `${baseUrl}/linkedin/search`,
                requestBody,
                { headers, params: { account_id: accountId } }
            );

            const posts = response.data?.items || response.data?.data?.items || [];
            return posts.slice(0, 10).map(p => p.text || p.content || p.description || p.message || '').filter(t => t.length > 20);
        } catch (error) {
            logger.warn('[CompanyAnalyzerService] Could not fetch company posts', { error: error.message });
            return [];
        }
    }

    /**
     * Fetch company profile via Unipile
     */
    async fetchCompanyInfo(identifier, accountId) {
        try {
            const baseUrl = this.getBaseUrl();
            const headers = this.getAuthHeaders();
            const url = `${baseUrl}/linkedin/company/${encodeURIComponent(identifier)}?account_id=${encodeURIComponent(accountId)}`;

            const response = await axios.get(url, { headers });
            const data = response.data;
            return {
                id: data.id || data.company_id || identifier,
                name: data.name || data.company_name,
                description: data.description || data.about || data.tagline || '',
                industry: Array.isArray(data.industry) ? data.industry.join(', ') : (data.industry || '')
            };
        } catch (error) {
            logger.error('[CompanyAnalyzerService] Error fetching company info', { error: error.message });
            return null;
        }
    }

    /**
     * Scrape the text from a website URL
     */
    async scrapeWebsite(url) {
        try {
            // Add protocol if missing
            const targetUrl = url.startsWith('http') ? url : `https://${url}`;
            const response = await axios.get(targetUrl, {
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            });
            const html = response.data;
            const $ = cheerio.load(html);

            // Remove script, style, nav, footer, etc.
            $('script, style, nav, footer, header, noscript, iframe').remove();

            let text = $('body').text();
            text = text.replace(/\s+/g, ' ').trim();

            // Return max 5000 chars for prompt context size
            return text.substring(0, 5000);
        } catch (error) {
            logger.warn('[CompanyAnalyzerService] Could not scrape website', { url, error: error.message });
            return '';
        }
    }

    /**
     * Main method to analyze company and suggest ICP
     */
    async analyzeCompanyProfiles(linkedinUrl, websiteUrl, tenantId, context, history = [], message = '') {
        let companyPosts = [];
        let companyInfo = null;
        let websiteText = '';

        // 1. Fetch LinkedIn Data if provided
        if (linkedinUrl && this.isConfigured()) {
            try {
                const accountId = await this.getAccountIdForTenant(tenantId, context);
                const { identifier } = this.extractProfileIdentifier(linkedinUrl);

                companyInfo = await this.fetchCompanyInfo(identifier, accountId);
                if (companyInfo && companyInfo.id) {
                    companyPosts = await this.fetchCompanyPosts(companyInfo.id, accountId);
                }
            } catch (err) {
                logger.error('[CompanyAnalyzerService] LinkedIn extraction failed', { error: err.message });
            }
        }

        // 2. Fetch Website Data if provided
        if (websiteUrl) {
            websiteText = await this.scrapeWebsite(websiteUrl);
        }

        // 3. Prepare Prompt for Gemini
        let ctxContent = '';
        if (companyInfo) {
            ctxContent += `Company Name: ${companyInfo.name}\nIndustry: ${companyInfo.industry}\nDescription from LinkedIn: ${companyInfo.description}\n\n`;
        }
        if (companyPosts.length > 0) {
            ctxContent += `Recent LinkedIn Posts by Company:\n- ${companyPosts.join('\n- ')}\n\n`;
        }
        if (websiteText) {
            ctxContent += `Website Homepage Content:\n${websiteText}\n\n`;
        }

        const historyCtx = history.slice(-4).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.text?.substring(0, 300)}`).join('\n');

        if (!ctxContent.trim()) {
            return `I couldn't extract enough data from those URLs to run an analysis. Could you check if the links are correct and accessible publicly?`;
        }

        const prompt = `You are an expert B2B Lead Generation Strategist and helpful conversational AI assistant.
I am giving you data about a company extracted from their LinkedIn profile and Website. 
Your goal is to figure out EXACTLY who their Ideal Customer Profile (ICP) is, and what kind of leads they should target on LinkedIn Sales Navigator, WHILE directly answering the user's specific question.

CRITICAL RULE: LinkedIn Sales Navigator is purely for B2B (Business-to-Business) searching. NEVER suggest targeting "High-Net-Worth Individuals", "Consumers", or industries simply because the people in them "earn high salaries". 
If the company is B2C (like residential real estate), you MUST pivot to suggest B2B referral partners (e.g. Wealth Managers, Family Offices, Corporate Relocation Managers, Real Estate Investors, HR Directors) rather than end-consumers.

--- PREVIOUS CONVERSATION CONTEXT ---
${historyCtx || '(None)'}

--- CURRENT USER MESSAGE (LATEST QUESTION) ---
User said: "${message}"

--- COMPANY DATA START ---
${ctxContent}
--- COMPANY DATA END ---

Based on the company data AND what the user explicitly said or asked for in their latest message:
1. Identify the BEST target **industries** for them to sell to or partner with (B2B ONLY).
2. Identify the BEST **job titles** (decision-makers or referral partners) they should target (B2B ONLY).

Respond directly addressing the user in a helpful, conversational, professional tone (like ChatGPT would).
First, acknowledge and respond to whatever specific question or context the user gave in their "CURRENT USER MESSAGE". 
If the user explicitly asked to "find leads" in a specific sector or in general, address that!
Then, explain *why* these B2B leads make sense based on the website/LinkedIn data.
Conclude by asking: "Would you like me to go ahead and run a search for these [Job Titles] in [Industries]?" (Format this as a friendly question).

Keep it concise (3-4 paragraphs max). Use bullet points for titles and industries to make it readable.`;

        try {
            return await geminiClientService.generateContent(prompt);
        } catch (e) {
            logger.error('[CompanyAnalyzerService] Gemini analysis failed', { error: e.message });
            return `I encountered an issue analyzing the company data right now, but from the links provided, I suggest targeting top decision-makers in the industries you serve. Could you manually describe the roles you'd like me to find?`;
        }
    }
}

module.exports = new CompanyAnalyzerService();
