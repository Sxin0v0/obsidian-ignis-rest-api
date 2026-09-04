const path=require('path');
const {loadOrCreateConfig}=require('./lib/config');
const {BrowserRpc}=require('./lib/browser-rpc');
const {ExtensionBridge}=require('./lib/extensions');
const {VaultService}=require('./lib/service');
const {mountRoutes}=require('./lib/routes');
module.exports={
 id:'local-rest-api',name:'Obsidian Ignis REST API with MCP',description:'Community Ignis Server Plugin adaptation of coddingtonbear/obsidian-local-rest-api 5.1, including REST, MCP, markdown patching, multi-vault routing, and an Obsidian browser companion.',version:'1.0.0',obsidianPlugin:path.join(__dirname,'obsidian'),ctx:null,config:null,rpc:null,extensions:null,service:null,mcp:null,
 async register(ctx){this.ctx=ctx;this.config=await loadOrCreateConfig(ctx.dataDir,ctx.log);this.rpc=new BrowserRpc(ctx.wss,ctx.log,this.config.bridgeTimeoutMs);this.extensions=new ExtensionBridge(ctx.wss,this.rpc,ctx.log);this.service=new VaultService(ctx,this.rpc,this.config);mountRoutes(ctx.router,this);ctx.log('Obsidian Ignis REST API v1 mounted at /api/ext/local-rest-api');},
 async shutdown(){this.mcp=null;this.extensions?.close();this.rpc?.close();this.extensions=null;this.rpc=null;this.service=null;this.ctx=null;},
 async onVaultEnabled(vaultId){this.ctx?.log(`Obsidian Ignis REST API enabled for vault: ${vaultId}`);},
 async onVaultDisabled(vaultId){this.ctx?.log(`Obsidian Ignis REST API disabled for vault: ${vaultId}`);},
};
