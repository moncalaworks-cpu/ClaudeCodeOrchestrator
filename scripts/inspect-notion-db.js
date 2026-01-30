/**
 * Notion Database Inspector
 * Prints out the database schema and sample records
 */

require('dotenv').config();
const https = require('https');

const notionToken = process.env.NOTION_API_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

if (!notionToken || !databaseId) {
  console.error('Error: NOTION_API_TOKEN or NOTION_DATABASE_ID not set');
  console.error('Set them with: heroku config:set NOTION_API_TOKEN=... NOTION_DATABASE_ID=...');
  process.exit(1);
}

function makeRequest(path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      path: path,
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function inspectDatabase() {
  try {
    console.log('📊 Inspecting Notion Database...\n');
    console.log(`Database ID: ${databaseId}\n`);

    // Get database schema
    console.log('🔍 Database Fields:\n');
    const dbResponse = await makeRequest(`/v1/databases/${databaseId}`);

    if (dbResponse.properties) {
      Object.entries(dbResponse.properties).forEach(([key, prop]) => {
        console.log(`  Field: "${prop.name}"`);
        console.log(`    Type: ${prop.type}`);
        if (prop[prop.type]) {
          console.log(`    Config:`, JSON.stringify(prop[prop.type], null, 2));
        }
        console.log();
      });
    }

    // Get sample records
    console.log('\n📋 Sample Records (first 5):\n');
    const queryResponse = await makeRequest(`/v1/databases/${databaseId}/query`, JSON.stringify({
      page_size: 5
    }));

    if (queryResponse.results && queryResponse.results.length > 0) {
      queryResponse.results.forEach((page, index) => {
        console.log(`Record ${index + 1}:`);
        console.log(`  ID: ${page.id}`);
        console.log(`  Properties:`);

        Object.entries(page.properties).forEach(([key, prop]) => {
          let value = 'N/A';

          if (prop.title) value = prop.title.map(t => t.plain_text).join('');
          else if (prop.rich_text) value = prop.rich_text.map(t => t.plain_text).join('');
          else if (prop.status) value = prop.status.name;
          else if (prop.date) value = prop.date.start;
          else if (prop.select) value = prop.select.name;
          else if (prop.checkbox) value = prop.checkbox;

          console.log(`    ${key}: ${value}`);
        });
        console.log();
      });
    } else {
      console.log('No records found in database.');
    }

    console.log('✅ Database inspection complete!');
    console.log('\nUpdate handlers/notion.js with the correct field names.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

inspectDatabase();
