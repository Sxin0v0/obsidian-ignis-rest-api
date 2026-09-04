const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function configPath(dataDir){return path.join(dataDir,'config.json');}
function envBool(name,fallback=false){const v=process.env[name];if(v==null)return fallback;return /^(1|true|yes|on)$/i.test(v);}
async function loadOrCreateConfig(dataDir,log=()=>{}){
  await fs.promises.mkdir(dataDir,{recursive:true});const file=configPath(dataDir);let stored={};try{stored=JSON.parse(await fs.promises.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')log(`Could not read config: ${e.message}`);}
  const envKey=process.env.IGNIS_LOCAL_REST_API_KEY?.trim();const generated=!envKey&&!stored.apiKey;const cfg={
    apiKey:envKey||stored.apiKey||crypto.randomBytes(32).toString('hex'),
    authorizationHeaderName:process.env.IGNIS_LOCAL_REST_API_AUTH_HEADER||stored.authorizationHeaderName||'Authorization',
    defaultVault:process.env.IGNIS_LOCAL_REST_API_DEFAULT_VAULT||stored.defaultVault||null,
    corsOrigin:process.env.IGNIS_LOCAL_REST_API_CORS_ORIGIN||stored.corsOrigin||'*',
    verbose:envBool('IGNIS_LOCAL_REST_API_VERBOSE',!!stored.verbose),
    bridgeTimeoutMs:Number(process.env.IGNIS_LOCAL_REST_API_BRIDGE_TIMEOUT_MS||stored.bridgeTimeoutMs||5000),
    generatedAt:stored.generatedAt||new Date().toISOString(),
  };
  const persisted={...cfg,apiKey:envKey?null:cfg.apiKey};await fs.promises.writeFile(file,JSON.stringify(persisted,null,2)+'\n',{mode:0o600});await fs.promises.chmod(file,0o600);
  if(generated){log('Generated a REST/MCP API key and stored it in the plugin config file. The secret is not written to logs.');log(`Config: ${file}`);}else if(envKey)log('Using API key from IGNIS_LOCAL_REST_API_KEY.');return cfg;
}
module.exports={loadOrCreateConfig,configPath};
