// Script to update all imports in campaigns feature
const fs = require('fs');
const path = require('path');

const replacements = [
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/core\/utils\/logger['"]\)/g,
    to: "require('../utils/logger')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/core\/utils\/logger['"]\)/g,
    to: "require('../../utils/logger')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/core\/utils\/schemaHelper['"]\)/g,
    to: "require('../utils/schema')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/core\/utils\/schemaHelper['"]\)/g,
    to: "require('../../utils/schema')"
  },
  {
    from: /require\(['"]\.\.\/\.\.\/\.\.\/core\/middleware\/auth['"]\)/g,
    to: "require('../middleware/auth')"
  }
];

function updateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  replacements.forEach(({ from, to }) => {
    if (from.test(content)) {
      content = content.replace(from, to);
      modified = true;
    }
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      scanDirectory(fullPath);
    } else if (file.endsWith('.js')) {
      updateFile(fullPath);
    }
  });
}

// Update campaigns feature
const featureDir = path.join(__dirname, 'backend', 'features', 'campaigns');
scanDirectory(featureDir);

console.log('Import updates complete!');
