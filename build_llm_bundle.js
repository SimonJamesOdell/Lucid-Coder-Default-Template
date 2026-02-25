// LLM-driven build script: generates dynamic JS/CSS bundle from /llm_src
const fs = require('fs');
const path = require('path');

const stylesDir = path.join(__dirname, 'llm_src', 'styles');
const distDir = path.join(__dirname, 'dist');
const styleFiles = fs.readdirSync(stylesDir);
let cssBundle = '';

styleFiles.forEach(file => {
  const styleJson = JSON.parse(fs.readFileSync(path.join(stylesDir, file), 'utf8'));
  cssBundle += styleJson.css + '\n';
});

fs.writeFileSync(path.join(distDir, 'styles.css'), cssBundle);

// (Extend: parse components, logic, and generate main.js dynamically)
console.log('LLM bundle built: styles injected from LLM-optimized files.');
