  require('dotenv').config();                                                                                                               
  const express = require('express');                                                                                                       
  const githubHandler = require('./webhooks/github');                                                                                       
                                                                                                                                            
  const app = express();                                                                                                                    
                                                                                                                                            
  app.use(express.json());                                                                                                                  
                                                                                                                                            
  // Register GitHub webhook endpoint                                                                                                       
  app.use('/webhooks', githubHandler);                                                                                                      
                                                                                                                                            
  // Health check                                                                                                                           
  app.get('/health', (req, res) => {                                                                                                        
    res.status(200).json({ status: 'ok' });                                                                                                 
  });                                                                                                                                       
                                                                                                                                            
  // Start server                                                                                                                           
  const PORT = process.env.ORCHESTRATOR_PORT || 3001;                                                                                       
  app.listen(PORT, () => {                                                                                                                  
    console.log(`Orchestrator webhook server listening on port ${PORT}`);                                                                   
  });
