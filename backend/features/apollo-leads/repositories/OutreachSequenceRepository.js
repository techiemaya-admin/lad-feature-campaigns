/**
 * Outreach Sequence Repository
 * SQL queries only - no business logic
 * LAD Architecture Compliant
 */

const { pool } = require('../../../shared/database/connection');
const { getSchema } = require('../../../core/utils/schemaHelper');

class OutreachSequenceRepository {
  /**
   * Get slot details with profile information
   * LAD Architecture: Tenant-scoped query with dynamic schema
   */
  async getSlotWithProfile(slotId, tenantId, schema) {
    const query = `
      SELECT 
        oss.*,
        ec.employee_name as profile_name,
        ec.employee_linkedin_url as profile_url,
        ec.company_name
      FROM ${schema}.outreach_sending_slots oss
      LEFT JOIN ${schema}.employees_cache ec 
        ON oss.profile_id = ec.apollo_person_id 
        AND oss.tenant_id = ec.tenant_id
      WHERE oss.id = $1 AND oss.tenant_id = $2
    `;
    
    const result = await pool.query(query, [slotId, tenantId]);
    return result.rows[0] || null;
  }

  /**
   * Get sequence by ID
   * LAD Architecture: Tenant-scoped query
   */
  async getSequenceById(sequenceId, tenantId, schema) {
    const query = `
      SELECT * 
      FROM ${schema}.outreach_sequences 
      WHERE id = $1 AND tenant_id = $2
    `;
    
    const result = await pool.query(query, [sequenceId, tenantId]);
    return result.rows[0] || null;
  }

  /**
   * Get slots by sequence ID
   * LAD Architecture: Tenant-scoped query
   */
  async getSlotsBySequenceId(sequenceId, tenantId, schema) {
    const query = `
      SELECT 
        oss.*,
        ec.employee_name as profile_name,
        ec.employee_linkedin_url as profile_url
      FROM ${schema}.outreach_sending_slots oss
      LEFT JOIN ${schema}.employees_cache ec 
        ON oss.profile_id = ec.apollo_person_id 
        AND oss.tenant_id = ec.tenant_id
      WHERE oss.sequence_id = $1 AND oss.tenant_id = $2
      ORDER BY oss.scheduled_time ASC
    `;
    
    const result = await pool.query(query, [sequenceId, tenantId]);
    return result.rows;
  }

  /**
   * Create new sequence
   * LAD Architecture: Tenant-scoped insert
   */
  async createSequence(sequenceData, tenantId, schema) {
    const query = `
      INSERT INTO ${schema}.outreach_sequences 
        (tenant_id, campaign_id, account_id, total_profiles, daily_limit, 
         estimated_days, estimated_weeks, start_date, message, metadata, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id
    `;
    
    const values = [
      tenantId,
      sequenceData.campaignId,
      sequenceData.accountId,
      sequenceData.totalProfiles,
      sequenceData.dailyLimit,
      sequenceData.estimatedDays,
      sequenceData.estimatedWeeks,
      sequenceData.startDate,
      sequenceData.message,
      JSON.stringify(sequenceData.metadata || {})
    ];
    
    const result = await pool.query(query, values);
    return result.rows[0].id;
  }

  /**
   * Create sending slots (batch insert)
   * LAD Architecture: Tenant-scoped batch insert
   */
  async createSendingSlots(sequenceId, tenantId, slots, schema) {
    if (!slots || slots.length === 0) {
      return;
    }

    const values = slots.flatMap(slot => [
      tenantId,
      sequenceId,
      slot.profileId,
      slot.scheduledTime,
      slot.status || 'pending',
      JSON.stringify({ day: slot.day, hour: slot.hour, minute: slot.minute })
    ]);

    const placeholders = slots.map((_, i) => {
      const base = i * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    }).join(', ');

    const query = `
      INSERT INTO ${schema}.outreach_sending_slots 
        (tenant_id, sequence_id, profile_id, scheduled_time, status, metadata)
      VALUES ${placeholders}
    `;

    await pool.query(query, values);
  }

  /**
   * Update slot status
   * LAD Architecture: Tenant-scoped update
   */
  async updateSlotStatus(slotId, tenantId, status, metadata, schema) {
    const query = `
      UPDATE ${schema}.outreach_sending_slots 
      SET status = $1, 
          metadata = $2,
          updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4
    `;
    
    await pool.query(query, [
      status,
      JSON.stringify(metadata),
      slotId,
      tenantId
    ]);
  }
}

module.exports = OutreachSequenceRepository;
