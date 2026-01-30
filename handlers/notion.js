/**
 * Notion Handler
 * Updates deployment records in Notion database
 */

const https = require('https');
const { promisify } = require('util');

const notionToken = process.env.NOTION_API_TOKEN;
const databaseId = process.env.NOTION_DATABASE_ID;

/**
 * Make HTTP request to Notion API
 * @param {object} options - Request options
 * @param {string} body - Request body (JSON string)
 * @returns {Promise} API response
 */
function makeNotionRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || '{}'));
        } else {
          reject(new Error(`Notion API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Get default Notion request options
 * @returns {object} Request options with auth headers
 */
function getNotionOptions(path, method = 'GET') {
  return {
    hostname: 'api.notion.com',
    path: path,
    method: method,
    headers: {
      'Authorization': `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    }
  };
}

/**
 * Find deployment record by deployment ID
 * @param {string} deploymentId - Deployment ID to search for
 * @returns {Promise<string|null>} Page ID if found, null otherwise
 */
async function findDeploymentRecord(deploymentId) {
  try {
    const options = getNotionOptions(`/v1/databases/${databaseId}/query`, 'POST');

    const query = {
      filter: {
        property: 'Deployment ID',
        title: {
          equals: deploymentId
        }
      }
    };

    const response = await makeNotionRequest(options, JSON.stringify(query));

    if (response.results && response.results.length > 0) {
      return response.results[0].id;
    }
    return null;
  } catch (error) {
    console.error(`[Notion] Error finding deployment record: ${error.message}`);
    return null;
  }
}

/**
 * Update deployment record with approval status
 * @param {string} deploymentId - Deployment ID
 * @param {string} approver - User who approved
 * @returns {Promise<boolean>} Success status
 */
async function updateDeploymentApproval(deploymentId, approver) {
  try {
    if (!notionToken || !databaseId) {
      console.warn('[Notion] NOTION_API_TOKEN or NOTION_DATABASE_ID not configured');
      return false;
    }

    console.log(`[Notion] Updating deployment ${deploymentId} with approval from ${approver}`);

    const pageId = await findDeploymentRecord(deploymentId);
    if (!pageId) {
      console.warn(`[Notion] Deployment record not found for ${deploymentId}`);
      return false;
    }

    const options = getNotionOptions(`/v1/pages/${pageId}`, 'PATCH');

    const update = {
      properties: {
        'Status': {
          status: {
            name: 'Approved'
          }
        },
        'Approved By': {
          rich_text: [
            {
              type: 'text',
              text: {
                content: approver
              }
            }
          ]
        },
        'Approval Time': {
          date: {
            start: new Date().toISOString()
          }
        }
      }
    };

    await makeNotionRequest(options, JSON.stringify(update));

    console.log(`[Notion] ✅ Updated deployment ${deploymentId} as approved`);
    return true;
  } catch (error) {
    console.error(`[Notion] ❌ Error updating deployment approval: ${error.message}`);
    return false;
  }
}

/**
 * Update deployment record with rejection status
 * @param {string} deploymentId - Deployment ID
 * @param {string} rejector - User who rejected
 * @returns {Promise<boolean>} Success status
 */
async function updateDeploymentRejection(deploymentId, rejector) {
  try {
    if (!notionToken || !databaseId) {
      console.warn('[Notion] NOTION_API_TOKEN or NOTION_DATABASE_ID not configured');
      return false;
    }

    console.log(`[Notion] Updating deployment ${deploymentId} with rejection from ${rejector}`);

    const pageId = await findDeploymentRecord(deploymentId);
    if (!pageId) {
      console.warn(`[Notion] Deployment record not found for ${deploymentId}`);
      return false;
    }

    const options = getNotionOptions(`/v1/pages/${pageId}`, 'PATCH');

    const update = {
      properties: {
        'Status': {
          status: {
            name: 'Rejected'
          }
        },
        'Rejected By': {
          rich_text: [
            {
              type: 'text',
              text: {
                content: rejector
              }
            }
          ]
        },
        'Rejection Time': {
          date: {
            start: new Date().toISOString()
          }
        }
      }
    };

    await makeNotionRequest(options, JSON.stringify(update));

    console.log(`[Notion] ✅ Updated deployment ${deploymentId} as rejected`);
    return true;
  } catch (error) {
    console.error(`[Notion] ❌ Error updating deployment rejection: ${error.message}`);
    return false;
  }
}

/**
 * Update deployment record with deployed status
 * @param {string} deploymentId - Deployment ID
 * @returns {Promise<boolean>} Success status
 */
async function updateDeploymentDeployed(deploymentId) {
  try {
    if (!notionToken || !databaseId) {
      console.warn('[Notion] NOTION_API_TOKEN or NOTION_DATABASE_ID not configured');
      return false;
    }

    console.log(`[Notion] Marking deployment ${deploymentId} as deployed`);

    const pageId = await findDeploymentRecord(deploymentId);
    if (!pageId) {
      console.warn(`[Notion] Deployment record not found for ${deploymentId}`);
      return false;
    }

    const options = getNotionOptions(`/v1/pages/${pageId}`, 'PATCH');

    const update = {
      properties: {
        'Status': {
          status: {
            name: 'Deployed'
          }
        },
        'Deployment Time': {
          date: {
            start: new Date().toISOString()
          }
        }
      }
    };

    await makeNotionRequest(options, JSON.stringify(update));

    console.log(`[Notion] ✅ Updated deployment ${deploymentId} as deployed`);
    return true;
  } catch (error) {
    console.error(`[Notion] ❌ Error updating deployment deployed: ${error.message}`);
    return false;
  }
}

module.exports = {
  updateDeploymentApproval,
  updateDeploymentRejection,
  updateDeploymentDeployed,
  findDeploymentRecord
};
