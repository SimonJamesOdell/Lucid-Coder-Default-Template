const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const stylesDir = path.join(projectRoot, 'llm_src', 'styles');
const outputCssPath = path.join(projectRoot, 'src', 'style.css');

const { buildBundle } = require('../../build_llm_bundle.cjs');

const tempStylePaths = new Set();

const createTempStylePath = (suffix) => {
  const token = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  return path.join(stylesDir, `style_zz_test_${suffix}_${token}.json`);
};

const withTempStyleJson = (suffix, jsonValue, runAssertions) => {
  const filePath = createTempStylePath(suffix);
  const payload = `${JSON.stringify(jsonValue, null, 2)}\n`;

  fs.writeFileSync(filePath, payload, 'utf8');
  tempStylePaths.add(filePath);

  try {
    buildBundle();
    const compiledCss = fs.readFileSync(outputCssPath, 'utf8');
    runAssertions(compiledCss);
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    tempStylePaths.delete(filePath);
    buildBundle();
  }
};

test.after(() => {
  for (const filePath of tempStylePaths) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  tempStylePaths.clear();
  buildBundle();
});

test('build_llm_bundle compiles selector + rules schema', () => {
  withTempStyleJson('selector_rules', {
    selector: 'body',
    rules: {
      backgroundColor: 'rgb(10, 20, 30)'
    }
  }, (compiledCss) => {
    assert.match(compiledCss, /body\s*\{[\s\S]*background-color:\s*rgb\(10, 20, 30\);/i);
  });
});

test('build_llm_bundle compiles selector + styles schema', () => {
  withTempStyleJson('selector_styles', {
    selector: 'body',
    styles: {
      background: 'linear-gradient(to right, #111111, #222222)'
    }
  }, (compiledCss) => {
    assert.match(compiledCss, /linear-gradient\(to right, #111111, #222222\)/i);
  });
});

test('build_llm_bundle compiles selector + properties schema', () => {
  withTempStyleJson('selector_properties', {
    selector: 'body',
    properties: {
      backgroundColor: '#334455'
    }
  }, (compiledCss) => {
    assert.match(compiledCss, /background-color:\s*#334455;/i);
  });
});

test('build_llm_bundle compiles top-level keyframes at-rule blocks', () => {
  withTempStyleJson('at_rule_top_level', {
    body: {
      animation: 'wave 8s ease infinite'
    },
    '@keyframes wave': {
      '0%': { backgroundPosition: '0% 50%' },
      '100%': { backgroundPosition: '100% 50%' }
    }
  }, (compiledCss) => {
    assert.match(compiledCss, /@keyframes\s+wave\s*\{/i);
    assert.match(compiledCss, /0%\s*\{[\s\S]*background-position:\s*0% 50%;/i);
    assert.match(compiledCss, /100%\s*\{[\s\S]*background-position:\s*100% 50%;/i);
  });
});

test('build_llm_bundle compiles styles array entries including at-rules', () => {
  withTempStyleJson('styles_array', {
    id: 'style_global',
    type: 'style',
    styles: [
      {
        selector: 'body',
        rules: {
          background: 'linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet)',
          animation: 'rainbowWave 6s linear infinite'
        }
      },
      {
        selector: '@keyframes rainbowWave',
        rules: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '100% 50%' }
        }
      }
    ]
  }, (compiledCss) => {
    assert.match(compiledCss, /linear-gradient\(to right, red, orange, yellow, green, blue, indigo, violet\)/i);
    assert.match(compiledCss, /@keyframes\s+rainbowWave\s*\{/i);
    assert.doesNotMatch(compiledCss, /\bstyles\s*\{/i);
  });
});
