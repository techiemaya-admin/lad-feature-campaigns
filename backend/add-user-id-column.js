/**
 * Migration: Add user_id column to campaign_analytics table
 * 
 * This column stores the user_id from social_linkedin_accounts table,
 * linking campaign actions to specific users within a tenant.
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false
});

async function addUserIdColumn() {
  try {
    console.log('\n📋 Starting migration: Add user_id column to campaign_analytics...\n');

    // Check if column already exists
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'lad_dev' 
        AND table_name = 'campaign_analytics' 
        AND column_name = 'user_id'
    `);

    if (checkResult.rows.length > 0) {
      console.log('⚠️  Column user_id already exists in campaign_analytics table.\n');
      return;
    }

    // Add user_id column
    console.log('➕ Adding user_id column...');
    await pool.query(`
      ALTER TABLE lad_dev.campaign_analytics
      ADD COLUMN user_id UUID;
    `);
    console.log('✅ Column added successfully!');

    // Add comment
    console.log('📝 Adding column comment...');
    await pool.query(`
      COMMENT ON COLUMN lad_dev.campaign_analytics.user_id IS 
      'User ID from social_linkedin_accounts table. Links campaign actions to specific users within a tenant.';
    `);
    console.log('✅ Comment added!');

    // Check column was created
    const verifyResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'lad_dev' 
        AND table_name = 'campaign_analytics' 
        AND column_name = 'user_id'
    `);

    if (verifyResult.rows.length > 0) {
      console.log('\n✅ Verification passed!');
      console.log('Column details:', verifyResult.rows[0]);
    }

    // Get count of existing records
    const countResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM lad_dev.campaign_analytics
    `);
    console.log(`\n📊 Existing records: ${countResult.rows[0].count} (user_id will be NULL for these)`);

    console.log('\n✅ Migration completed successfully!\n');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addUserIdColumn();
