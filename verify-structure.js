/**
 * Verify Production-Ready Structure
 * Checks all imports are using correct paths
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 Verifying Production Structure...\n');

const results = {
  correct: [],
  incorrect: [],
  warnings: []
};

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath);
  
  // Check for incorrect import patterns
  const incorrectPatterns = [
    { pattern: /require\(['"]\.\.\/utils\/dbConnection/, message: 'Should use ../../../shared/database/connection' }
  ];

  incorrectPatterns.forEach(({ pattern, message }) => {
    if (pattern.test(content)) {
      results.incorrect.push({ file: relativePath, issue: message });
    }
  });

  // Check for correct patterns
  const correctPatterns = [
    /require\(['"]\.\.\/\.\.\/\.\.\/core\/utils\/logger/,
    /require\(['"]\.\.\/\.\.\/\.\.\/core\/utils\/schemaHelper/,
    /require\(['"]\.\.\/\.\.\/\.\.\/shared\/database\/connection/
  ];

  correctPatterns.forEach(pattern => {
    if (pattern.test(content)) {
      results.correct.push(relativePath);
    }
  });
}

// Scan all JS files in backend/features
function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      scanDirectory(fullPath);
    } else if (file.endsWith('.js')) {
      checkFile(fullPath);
    }
  });
}

try {
  scanDirectory('./backend/features');
  
  console.log('✅ CORRECT IMPORTS:', [...new Set(results.correct)].length, 'files');
  console.log('❌ INCORRECT IMPORTS:', results.incorrect.length, 'issues\n');
  
  if (results.incorrect.length > 0) {
    console.log('Issues found:');
    results.incorrect.forEach(({ file, issue }) => {
      console.log(`  ❌ ${file}`);
      console.log(`     ${issue}\n`);
    });
    process.exit(1);
  } else {
    console.log('✅ All imports are production-ready!\n');
    
    // Check core utilities exist
    const coreFiles = [
      './backend/core/utils/logger.js',
      './backend/core/utils/schemaHelper.js',
      './shared/database/connection.js'
    ];
    
    console.log('📦 Core Utilities:');
    coreFiles.forEach(file => {
      if (fs.existsSync(file)) {
        console.log(`  ✅ ${file}`);
      } else {
        console.log(`  ❌ ${file} (MISSING)`);
        process.exit(1);
      }
    });
    
    console.log('\n✅ Structure verified successfully!\n');
  }
} catch (error) {
  console.error('❌ Verification failed:', error.message);
  process.exit(1);
}
