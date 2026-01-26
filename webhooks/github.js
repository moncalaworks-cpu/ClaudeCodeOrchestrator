  /**                                                                                                                                       
   * GitHub Webhook Handler                                                                                                                 
   * Receives push events and initiates deployment process                                                                                  
   */                                                                                                                                       
                                                                                                                                            
  const crypto = require('crypto');                                                                                                         
  const express = require('express');                                                                                                       
  const router = express.Router();                                                                                                          
                                                                                                                                            
  // Verify GitHub webhook signature                                                                                                        
  function verifyGitHubSignature(req, secret) {                                                                                             
    const signature = req.headers['x-hub-signature-256'];                                                                                   
    if (!signature) {                                                                                                                       
      return false;                                                                                                                         
    }                                                                                                                                       
                                                                                                                                            
    const payload = JSON.stringify(req.body);                                                                                               
    const hash = crypto                                                                                                                     
      .createHmac('sha256', secret)                                                                                                         
      .update(payload)                                                                                                                      
      .digest('hex');                                                                                                                       
                                                                                                                                            
    const expectedSignature = `sha256=${hash}`;                                                                                             
    return crypto.timingSafeEqual(                                                                                                          
      Buffer.from(signature),                                                                                                               
      Buffer.from(expectedSignature)                                                                                                        
    );                                                                                                                                      
  }                                                                                                                                         
                                                                                                                                            
  router.post('/github', async (req, res) => {                                                                                              
    try {                                                                                                                                   
      // Verify webhook signature                                                                                                           
      if (!verifyGitHubSignature(req, process.env.GITHUB_WEBHOOK_SECRET)) {                                                                 
        console.error('[GitHub Webhook] Invalid signature');                                                                                
        return res.status(401).json({ error: 'Invalid signature' });                                                                        
      }                                                                                                                                     
                                                                                                                                            
      const event = req.headers['x-github-event'];                                                                                          
      const delivery_id = req.headers['x-github-delivery'];                                                                                 
      const { repository, ref, pusher, commits } = req.body;                                                                                
                                                                                                                                            
      console.log(`[GitHub] Event: ${event}, Repo: ${repository.full_name}, Ref: ${ref}`);                                                  
                                                                                                                                            
      // Only process push events                                                                                                           
      if (event !== 'push') {                                                                                                               
        console.log(`[GitHub] Ignoring event type: ${event}`);                                                                              
        return res.status(200).json({ status: 'ignored', reason: 'Not a push event' });                                                     
      }                                                                                                                                     
                                                                                                                                            
      // Extract branch name from ref (refs/heads/main -> main)                                                                             
      const branch = ref.replace('refs/heads/', '');                                                                                        
                                                                                                                                            
      // Only process feature/*, develop, and main branches                                                                                 
      const isDeploymentBranch =                                                                                                            
        branch.startsWith('feature/') ||                                                                                                    
        branch === 'develop' ||                                                                                                             
        branch === 'main';                                                                                                                  
                                                                                                                                            
      if (!isDeploymentBranch) {                                                                                                            
        console.log(`[GitHub] Ignoring branch: ${branch}`);                                                                                 
        return res.status(200).json({ status: 'ignored', reason: `Branch ${branch} not tracked` });                                         
      }                                                                                                                                     
                                                                                                                                            
      console.log(`[GitHub] ✅ Processing deployment for branch: ${branch}`);                                                               
                                                                                                                                            
      // Extract commit information                                                                                                         
      const latest_commit = commits[commits.length - 1];                                                                                    
      const commit_sha = latest_commit.id;                                                                                                  
      const commit_message = latest_commit.message;                                                                                         
      const commit_author = latest_commit.author.name;                                                                                      
                                                                                                                                            
      // Prepare deployment data                                                                                                            
      const deployment_data = {                                                                                                             
        repository: repository.full_name,                                                                                                   
        branch: branch,                                                                                                                     
        commit_sha: commit_sha.substring(0, 7), // Short SHA                                                                                
        commit_message: commit_message.split('\n')[0], // First line only                                                                   
        commit_author: commit_author,                                                                                                       
        pusher: pusher.name,                                                                                                                
        deployment_id: `deploy-${branch}-${Date.now()}`,                                                                                    
        triggered_at: new Date().toISOString(),                                                                                             
        delivery_id: delivery_id                                                                                                            
      };                                                                                                                                    
                                                                                                                                            
      console.log(`[GitHub] Deployment data:`, deployment_data);                                                                            
                                                                                                                                            
      // TODO: In Phase 8, pass this to orchestrator to create Notion record                                                                
      // For now, just log it                                                                                                               
      console.log(`[GitHub] Would trigger orchestrator with:`, deployment_data);                                                            
                                                                                                                                            
      res.status(200).json({                                                                                                                
        status: 'received',                                                                                                                 
        deployment_id: deployment_data.deployment_id,                                                                                       
        branch: branch                                                                                                                      
      });                                                                                                                                   
                                                                                                                                            
    } catch (error) {                                                                                                                       
      console.error(`[GitHub] Error processing webhook: ${error.message}`);                                                                 
      res.status(500).json({ error: error.message });                                                                                       
    }                                                                                                                                       
  });                                                                                                                                       
                                                                                                                                            
  module.exports = router;                                                                                                                  

