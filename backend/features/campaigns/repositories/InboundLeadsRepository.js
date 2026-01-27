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
   * Find duplicate leads based on phone, email, or LinkedIn URL
   */
  async findDuplicateLeads(req, { tenantId, phone, email, linkedinUrl }) {
    const schema = getSchema(req);
    
    const conditions = [];
    const params = [tenantId];
    let paramCount = 1;
    
    if (phone) {
      paramCount++;
      conditions.push(`l.phone = $${paramCount}`);
      params.push(phone);
    }
    if (email) {
      paramCount++;
      conditions.push(`l.email = $${paramCount}`);
      params.push(email);
    }
    if (linkedinUrl) {
      paramCount++;
      conditions.push(`l.linkedin_url = $${paramCount}`);
      params.push(linkedinUrl);
    }
    
    if (conditions.length === 0) {
      return [];
    }
    
    const query = `
      SELECT l.*, 
             array_agg(json_build_object(
               'id', lb.id,
               'scheduled_at', lb.scheduled_at,
               'status', lb.status,
               'booking_type', lb.booking_type,
               'notes', lb.notes
             )) FILTER (WHERE lb.id IS NOT NULL) as bookings
      FROM ${schema}.leads l
      LEFT JOIN ${schema}.lead_bookings lb ON l.id = lb.lead_id AND lb.status != 'cancelled'
      WHERE l.tenant_id = $1 
        AND l.is_deleted = FALSE
        AND (${conditions.join(' OR ')})
      GROUP BY l.id
    `;
    
    const result = await this.pool.query(query, params);
    return result.rows;
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
   * Cancel all active bookings for multiple leads
   */
  async cancelLeadBookings(req, { tenantId, leadIds }) {
    const schema = getSchema(req);
    
    if (!leadIds || leadIds.length === 0) {
      return { cancelledCount: 0 };
    }
    
    const query = `
      UPDATE ${schema}.lead_bookings
      SET status = 'cancelled',
          updated_at = NOW(),
          metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{cancellation_reason}',
            '"Re-nurturing as new lead"'
          )
      WHERE lead_id = ANY($1::uuid[])
        AND tenant_id = $2
        AND status NOT IN ('cancelled', 'completed')
      RETURNING id
    `;
    
    const result = await this.pool.query(query, [leadIds, tenantId]);
    return { cancelledCount: result.rowCount };
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
