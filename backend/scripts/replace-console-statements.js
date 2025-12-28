/**
 * Batch Script to Replace console.* with logger.*
 * 
 * This script helps replace all console statements with logger calls
 * Run: node backend/scripts/replace-console-statements.js
 * 
 * Note: Review changes before committing
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Files to process
const serviceFiles = [
  'backend/features/campaigns/services/UnipileProfileService.js',
  'backend/features/campaigns/services/UnipileMessageService.js',
  'backend/features/campaigns/services/UnipileConnectionService.js',
  'backend/features/campaigns/services/LinkedInWebhookService.js',
  'backend/features/campaigns/services/LinkedInTokenService.js',
  'backend/features/campaigns/services/LinkedInStepExecutor.js',
  'backend/features/campaigns/services/LinkedInProfileSummaryService.js',
  'backend/features/campaigns/services/LinkedInProfileHelper.js',
  'backend/features/campaigns/services/LinkedInOAuthService.js',
  'backend/features/campaigns/services/LinkedInCheckpointService.js',
  'backend/features/campaigns/services/LinkedInAccountStorageService.js',
  'backend/features/campaigns/services/LinkedInAccountService.js',
  'backend/features/campaigns/services/LinkedInAccountQueryService.js',
  'backend/features/campaigns/services/LinkedInAccountHelper.js',
  'backend/features/campaigns/services/LeadSearchService.js',
  'backend/features/campaigns/services/LeadSaveService.js',
  'backend/features/campaigns/services/LeadGenerationService.js',
  'backend/features/campaigns/services/LeadGenerationHelpers.js',
  'backend/features/campaigns/services/CampaignProcessor.js',
  'backend/features/campaigns/services/CampaignActivityService.js',
  'backend/features/campaigns/services/StepExecutors.js',
  'backend/features/campaigns/utils/dbConnection.js'
];

function addLoggerImport(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Check if logger is already imported
  if (content.includes('require') && content.includes('logger')) {
    return content;
  }
  
  // Find the last require statement
  const requireRegex = /(const|let|var)\s+\w+\s*=\s*require\([^)]+\);/g;
  const requires = content.match(requireRegex) || [];
  
  if (requires.length > 0) {
    const lastRequire = requires[requires.length - 1];
    const lastRequireIndex = content.lastIndexOf(lastRequire);
    const insertIndex = lastRequireIndex + lastRequire.length;
    
    // Add logger import after last require
    const loggerImport = "\nconst logger = require('../../../core/utils/logger');";
    return content.slice(0, insertIndex) + loggerImport + content.slice(insertIndex);
  } else {
    // Add at the top after comments
    const commentEnd = content.indexOf('*/') + 2;
    const loggerImport = "\nconst logger = require('../../../core/utils/logger');\n";
    return content.slice(0, commentEnd) + loggerImport + content.slice(commentEnd);
  }
}

function replaceConsoleStatements(content) {
  // Replace console.log with logger.info
  content = content.replace(/console\.log\(([^)]+)\)/g, (match, args) => {
    // Try to extract message and data
    const cleaned = args.trim();
    if (cleaned.startsWith('`') && cleaned.includes('${')) {
      // Template literal - convert to logger.info with object
      return `logger.info(${cleaned})`;
    } else if (cleaned.startsWith('"') || cleaned.startsWith("'")) {
      // Simple string message
      return `logger.info(${cleaned})`;
    } else {
      // Complex expression - wrap in logger.info
      return `logger.info(${cleaned})`;
    }
  });
  
  // Replace console.error with logger.error
  content = content.replace(/console\.error\(([^)]+)\)/g, (match, args) => {
    const cleaned = args.trim();
    if (cleaned.includes(',')) {
      // Multiple arguments - convert to object
      const parts = cleaned.split(',').map(p => p.trim());
      const message = parts[0];
      const rest = parts.slice(1).join(', ');
      return `logger.error(${message}, { error: ${rest} })`;
    } else {
      return `logger.error(${cleaned})`;
    }
  });
  
  // Replace console.warn with logger.warn
  content = content.replace(/console\.warn\(([^)]+)\)/g, 'logger.warn($1)');
  
  // Replace console.info with logger.info
  content = content.replace(/console\.info\(([^)]+)\)/g, 'logger.info($1)');
  
  // Replace console.debug with logger.debug
  content = content.replace(/console\.debug\(([^)]+)\)/g, 'logger.debug($1)');
  
  return content;
}

console.log('⚠️  This script will modify files. Review changes before committing!');
console.log('Processing files...\n');

serviceFiles.forEach(relativePath => {
  const filePath = path.join(__dirname, '..', relativePath);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }
  
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Add logger import if needed
    if (content.includes('console.')) {
      content = addLoggerImport(filePath);
      content = replaceConsoleStatements(content);
      
      if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Updated: ${relativePath}`);
      } else {
        console.log(`⏭️  No changes: ${relativePath}`);
      }
    } else {
      console.log(`⏭️  No console statements: ${relativePath}`);
    }
  } catch (error) {
    console.error(`❌ Error processing ${relativePath}:`, error.message);
  }
});

console.log('\n✅ Batch replacement complete!');
console.log('⚠️  Please review all changes before committing.');

