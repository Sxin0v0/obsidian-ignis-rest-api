const crypto=require('crypto');
function compilePath(pattern){
  const keys=[];let rx='^';const parts=String(pattern||'/').split('/');for(let i=0;i<parts.length;i++){if(i>0)rx+='/';const p=parts[i];if(!p)continue;if(p==='*'){keys.push('0');rx+='(.*)';continue;}if(p.startsWith(':')){let name=p.slice(1),optional=false;if(name.endsWith('?')){name=name.slice(0,-1);optional=true;}keys.push(name);rx+=optional?'([^/]*)':'([^/]+)';continue;}rx+=p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}rx+='/?$';return{regex:new RegExp(rx),keys};
}
function match(entry,path){const m=entry.compiled.regex.exec(path);if(!m)return null;const params={};entry.compiled.keys.forEach((k,i)=>params[k]=decodeURIComponent(m[i+1]||''));return params;}
class ExtensionBridge{
  constructor(wss,rpc,log=()=>{}){this.rpc=rpc;this.log=log;this.routes=new Map();this.tools=new Map();this.channel=wss.channel('ignis-local-rest-api');this.handlers={
    'extension-route-register':(msg)=>this.registerRoute(msg),'extension-route-unregister':(msg)=>this.unregisterRoute(msg),'extension-mcp-register':(msg)=>this.registerTool(msg),'extension-mcp-unregister':(msg)=>this.unregisterTool(msg),'extension-unregister':(msg)=>this.unregisterExtension(msg),
  };for(const[k,v]of Object.entries(this.handlers))this.channel.on(k,v);}
  registerRoute(msg){if(!msg.vaultId||!msg.routeId||!msg.path)return;this.routes.set(msg.routeId,{...msg,method:String(msg.method||'all').toLowerCase(),compiled:compilePath(msg.path),lastSeen:Date.now()});this.log(`Extension route: ${msg.extensionId||'?'} ${msg.method||'ALL'} ${msg.path}`);}
  unregisterRoute(msg){if(msg.routeId)this.routes.delete(msg.routeId);}
  registerTool(msg){if(!msg.vaultId||!msg.toolId||!msg.name)return;this.tools.set(msg.toolId,{...msg,lastSeen:Date.now()});this.log(`Extension MCP tool: ${msg.name}`);}
  unregisterTool(msg){if(msg.toolId)this.tools.delete(msg.toolId);}
  unregisterExtension(msg){for(const[id,r]of this.routes)if(r.vaultId===msg.vaultId&&r.extensionId===msg.extensionId)this.routes.delete(id);for(const[id,t]of this.tools)if(t.vaultId===msg.vaultId&&t.extensionId===msg.extensionId)this.tools.delete(id);}
  findRoute(vaultId,method,path,authenticated){for(const r of this.routes.values()){if(r.vaultId!==vaultId||!!r.authenticated!==!!authenticated)continue;if(r.method!=='all'&&r.method!==String(method).toLowerCase())continue;const params=match(r,path);if(params)return{entry:r,params};}return null;}
  async handleRoute(vaultId,method,path,authenticated,request){const found=this.findRoute(vaultId,method,path,authenticated);if(!found)return null;const result=await this.rpc.call(vaultId,'extension.route',{routeId:found.entry.routeId,request:{...request,params:found.params}});return result;}
  listTools(vaultId){return [...this.tools.values()].filter((t)=>t.vaultId===vaultId).map((t)=>({name:t.name,description:t.description||'',inputSchema:t.inputSchema||{type:'object',properties:{}},annotations:t.annotations||{},_toolId:t.toolId}));}
  async callTool(vaultId,name,args){const t=[...this.tools.values()].find((x)=>x.vaultId===vaultId&&x.name===name);if(!t)return null;return this.rpc.call(vaultId,'extension.mcp',{toolId:t.toolId,args});}
  summary(){const byExt=new Map();for(const r of this.routes.values()){const k=`${r.vaultId}:${r.extensionId}`;if(!byExt.has(k))byExt.set(k,{vaultId:r.vaultId,id:r.extensionId,name:r.extensionName||r.extensionId,routes:[],mcpTools:[]});byExt.get(k).routes.push({path:r.path,authenticated:!!r.authenticated,method:r.method});}for(const t of this.tools.values()){const k=`${t.vaultId}:${t.extensionId}`;if(!byExt.has(k))byExt.set(k,{vaultId:t.vaultId,id:t.extensionId,name:t.extensionName||t.extensionId,routes:[],mcpTools:[]});byExt.get(k).mcpTools.push(t.name);}return[...byExt.values()];}
  close(){for(const k of Object.keys(this.handlers))this.channel.off(k);this.routes.clear();this.tools.clear();}
}
module.exports={ExtensionBridge,compilePath};
