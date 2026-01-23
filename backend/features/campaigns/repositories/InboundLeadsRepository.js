const { v4: uuidv4 } = require('uuid');
const { getSchema } = require('../../../core/utils/schemaHelper');

/**
 * Repository for inbound leads data access
 */
class InboundLeadsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  /**
   * Create a new inbound lead
   */
  async createLead(req, leadData) {
    const schema = getSchema(req);
    const {
      tenantId,
      source,
      sourceId,
      firstName,
      lastName,
      email,
      phone,
      companyName,
      title,
      linkedinUrl,
      customFields,
      rawData
    } = leadData;

    const leadId = uuidv4();
    
    const result = await this.pool.query(
      `INSERT INTO ${schema}.leads (
        id, 
        tenant_id, 
        source, 
        source_id,
        first_name, 
        last_name, 
        email, 
        phone, 
        company_name, 
        title, 
        linkedin_url,
        custom_fields,
        raw_data,
        created_at, 
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      ON CONFLICT (tenant_id, email) 
      DO UPDATE SET 
        first_name = COALESCE(EXCLUDED.first_name, leads.first_name),
        last_name = COALESCE(EXCLUDED.last_name, leads.last_name),
        phone = COALESCE(EXCLUDED.phone, leads.phone),
        company_name = COALESCE(EXCLUDED.company_name, leads.company_name),
        title = COALESCE(EXCLUDED.title, leads.title),
        linkedin_url = COALESCE(EXCLUDED.linkedin_url, leads.linkedin_url),
        custom_fields = COALESCE(EXCLUDED.custom_fields, leads.custom_fields),
        raw_data = COALESCE(EXCLUDED.raw_data, leads.raw_data),
        updated_at = NOW(),
        source = 'inbound_upload'
      RETURNING *`,
      [
        leadId,
        tenantId,
        source,
        sourceId,
        firstName,
        lastName,
        email,
        phone,
        companyName,
        title,
        linkedinUrl,
        customFields,
        rawData
      ]
    );

    return result.rows[0];
  }

  /**
   * Search inbound leads with pagination
   */
  async searchLeads(req, { tenantId, search, limit = 50, offset = 0 }) {
    const schema = getSchema(req);
    
    let query = `
      SELECT * FROM ${schema}.leads 
      WHERE tenant_id = $1 
      AND source = 'inbound'
      AND is_deleted = FALSE
    `;
    const params = [tenantId];

    if (search && search.trim()) {
      query += ` AND (
        first_name ILIKE $${params.length + 1} OR 
        last_name ILIKE $${params.length + 1} OR 
        email ILIKE $${params.length + 1} OR 
        company_name ILIKE $${params.length + 1}
      )`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await this.pool.query(query, params);
    return result.rows;
  }

  /**
   * Get total count of inbound leads
   */
  async getLeadsCount(req, { tenantId, search }) {
    const schema = getSchema(req);
    
    let query = `
      SELECT COUNT(*) as total FROM ${schema}.leads 
      WHERE tenant_id = $1 
      AND source = 'inbound'
      AND is_deleted = FALSE
    `;
    const params = [tenantId];

    if (search && search.trim()) {
      query += ` AND (
        first_name ILIKE $${params.length + 1} OR 
        last_name ILIKE $${params.length + 1} OR 
        email ILIKE $${params.length + 1} OR 
        company_name ILIKE $${params.length + 1}
      )`;
      params.push(`%${search}%`);
    }

    const result = await this.pool.query(query, params);
    return parseInt(result.rows[0].total);
  }
}

module.exports = InboundLeadsRepository;
