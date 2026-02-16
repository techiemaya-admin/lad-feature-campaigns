/**
 * Register Webhook with Unipile
 * Run this script once to register the webhook URL with Unipile
 */

require('dotenv').config();
const linkedInWebhookService = require('./features/campaigns/services/LinkedInWebhookService');

async function registerWebhook() {
  console.log('🔗 Registering LinkedIn Account Status Webhook with Unipile\n');
  console.log('═'.repeat(60));

  try {
    // Get webhook URL from environment or use default
    const webhookUrl = process.env.WEBHOOK_URL || 'https://lad-backend-develop-741719885039.us-central1.run.app/api/webhooks/linkedin/webhooks/account-status';
    
    console.log(`\n📡 Webhook URL: ${webhookUrl}`);
    console.log('\nRegistering webhook...');

    // Register the webhook
    const result = await linkedInWebhookService.registerAccountStatusWebhook(webhookUrl);

    console.log('\n✅ Webhook registered successfully!');
    console.log('\nWebhook Details:');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n📋 Registered Events:');
    console.log('  - account_status_change: When account status changes');
    console.log('  - checkpoint_resolved: When checkpoint is completed by user');

    console.log('\n✅ Setup Complete!');
    console.log('\nNow when users:');
    console.log('  1. Click "YES" on their mobile device → Webhook fires → Socket.IO event → Frontend auto-updates');
    console.log('  2. Enter OTP code → Webhook fires → Socket.IO event → Frontend shows success');
    console.log('  3. Account credentials expire → Webhook fires → Socket.IO event → Frontend shows warning');

    console.log('\n🔐 Webhook Secret: Set WEBHOOK_SECRET in .env to secure the endpoint');
    console.log('   Current: ' + (process.env.WEBHOOK_SECRET ? '✅ Configured' : '⚠️  Not configured (open endpoint!)'));

  } catch (error) {
    console.error('\n❌ Error registering webhook:', error.message);
    
    if (error.response) {
      console.error('\nResponse:', JSON.stringify(error.response.data, null, 2));
    }
    
    if (error.message.includes('Unipile is not configured')) {
      console.error('\n💡 Tip: Make sure UNIPILE_DSN and UNIPILE_TOKEN are set in .env');
    }
  }
}

// List existing webhooks
async function listWebhooks() {
  console.log('\n\n📜 Listing Existing Webhooks\n');
  console.log('═'.repeat(60));

  try {
    const webhooks = await linkedInWebhookService.listWebhooks();
    
    if (webhooks.length === 0) {
      console.log('\nNo webhooks registered yet.');
    } else {
      console.log(`\nFound ${webhooks.length} webhook(s):\n`);
      webhooks.forEach((webhook, index) => {
        console.log(`${index + 1}. ${webhook.request_url || webhook.url}`);
        console.log(`   Events: ${(webhook.events || []).join(', ')}`);
        console.log(`   Source: ${webhook.source || 'N/A'}`);
        console.log(`   ID: ${webhook.id || 'N/A'}\n`);
      });
    }
  } catch (error) {
    console.error('Error listing webhooks:', error.message);
  }
}

// Run both
async function main() {
  await registerWebhook();
  await listWebhooks();
  console.log('\n✨ Done!\n');
  process.exit(0);
}

main();
