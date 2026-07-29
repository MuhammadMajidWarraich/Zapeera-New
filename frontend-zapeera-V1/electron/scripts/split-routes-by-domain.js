/**
 * Split routes/index.js into domain-specific route files
 * Each domain gets its own file (product.routes.js, category.routes.js, etc.)
 */

const fs = require('fs');
const path = require('path');

const ROUTES_FILE = path.join(__dirname, '..', 'routes', 'index.js');
const ROUTES_DIR = path.join(__dirname, '..', 'routes');

console.log('🚀 Splitting routes/index.js into domain-specific files...\n');

// Read routes file
const content = fs.readFileSync(ROUTES_FILE, 'utf8');
const lines = content.split('\n');

// Extract route definitions
function extractRoutes() {
  const routes = [];
  let currentRoute = null;
  let braceCount = 0;
  let inRoute = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match route definitions
    const routeMatch = line.match(/app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/);
    
    if (routeMatch) {
      // Save previous route if exists
      if (currentRoute) {
        routes.push(currentRoute);
      }
      
      // Start new route
      const path = routeMatch[2];
      const domain = path.split('/')[2] || 'other'; // /api/domain/...
      
      currentRoute = {
        method: routeMatch[1],
        path: path,
        domain: domain,
        startLine: i + 1,
        code: [line],
        hasAuth: line.includes('authMiddleware')
      };
      inRoute = true;
      braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    } else if (inRoute && currentRoute) {
      currentRoute.code.push(line);
      braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      
      if (braceCount === 0) {
        currentRoute.endLine = i + 1;
        routes.push(currentRoute);
        currentRoute = null;
        inRoute = false;
      }
    }
  }
  
  // Save last route if exists
  if (currentRoute) {
    routes.push(currentRoute);
  }
  
  return routes;
}

console.log('📖 Reading routes/index.js...');
const allRoutes = extractRoutes();
console.log(`✅ Found ${allRoutes.length} routes\n`);

// Group routes by domain
const routesByDomain = {};
allRoutes.forEach(route => {
  const domain = route.domain;
  if (!routesByDomain[domain]) {
    routesByDomain[domain] = [];
  }
  routesByDomain[domain].push(route);
});

console.log('📊 Routes by domain:');
Object.keys(routesByDomain).sort().forEach(domain => {
  console.log(`   ${domain}: ${routesByDomain[domain].length} routes`);
});

// Get deps section from original file
const depsMatch = content.match(/const \{([^}]+)\} = deps;/);
const depsSection = depsMatch ? depsMatch[1].trim() : '';

// Get variable declarations
const varsMatch = content.match(/\/\/ Variables from sync service[\s\S]+?let offlineQueue = \[\];/);
const varsSection = varsMatch ? varsMatch[0] : '';

// Create route file for each domain
console.log('\n📝 Creating domain-specific route files...\n');

Object.keys(routesByDomain).sort().forEach(domain => {
  const domainRoutes = routesByDomain[domain];
  const domainName = domain.replace(/-/g, ''); // Remove hyphens for filename
  
  // Create route file content
  const routeFileContent = `/**
 * ${domain.charAt(0).toUpperCase() + domain.slice(1)} Routes
 * Extracted from routes/index.js
 */

function register${domainName.charAt(0).toUpperCase() + domainName.slice(1)}Routes(app, authMiddleware, deps) {
  const { ${depsSection} } = deps;

${varsSection}

${domainRoutes.map(route => {
  const code = route.code.join('\n');
  // Indent code properly
  const indentedCode = code.split('\n').map(l => '  ' + l).join('\n');
  return `  // ${route.method.toUpperCase()} ${route.path} (line ${route.startLine})
${indentedCode}`;
}).join('\n\n')}

}

module.exports = {
  register${domainName.charAt(0).toUpperCase() + domainName.slice(1)}Routes
};
`;

  const fileName = `${domain}.routes.js`;
  const filePath = path.join(ROUTES_DIR, fileName);
  
  fs.writeFileSync(filePath, routeFileContent);
  console.log(`  ✅ Created ${fileName} (${domainRoutes.length} routes)`);
});

// Now create new routes/index.js that imports all domain routes
console.log('\n📝 Creating new routes/index.js...');

const domains = Object.keys(routesByDomain).sort();
const imports = domains.map(domain => {
  const domainName = domain.replace(/-/g, '');
  return `const { register${domainName.charAt(0).toUpperCase() + domainName.slice(1)}Routes } = require('./${domain}.routes');`;
}).join('\n');

const registrations = domains.map(domain => {
  const domainName = domain.replace(/-/g, '');
  return `  register${domainName.charAt(0).toUpperCase() + domainName.slice(1)}Routes(app, authMiddleware, deps);`;
}).join('\n');

const newIndexContent = `/**
 * Routes Index
 * Register all API routes from domain-specific files
 */

${imports}

function registerAllRoutes(app, authMiddleware, deps) {
  console.log('[Routes] Registering routes from domain-specific files...');

${registrations}

  console.log('[Routes] ✅ All routes registered');
}

module.exports = {
  registerAllRoutes
};
`;

fs.writeFileSync(path.join(ROUTES_DIR, 'index.js'), newIndexContent);
console.log('✅ Created new routes/index.js\n');

console.log('📋 Summary:');
console.log(`  ✅ Created ${domains.length} domain route files`);
console.log(`  ✅ Total routes: ${allRoutes.length}`);
console.log(`  ✅ New routes/index.js: ${newIndexContent.split('\n').length} lines (was ${lines.length} lines)`);

