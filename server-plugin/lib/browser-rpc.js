const crypto=require('crypto');
class BrowserRpc{
  constructor(wss,log=()=>{},defaultTimeoutMs=5000){this.log=log;this.pending=new Map();this.onlineUntil=new Map();this.defaultTimeoutMs=defaultTimeoutMs;this.channel=wss.channel('ignis-local-rest-api');this.onResponse=this.onResponse.bind(this);this.onHeartbeat=this.onHeartbeat.bind(this);this.channel.on('rpc-response',this.onResponse);this.channel.on('bridge-online',this.onHeartbeat);this.channel.on('bridge-heartbeat',this.onHeartbeat);this.channel.on('bridge-offline',(msg)=>{if(msg.vaultId)this.onlineUntil.delete(msg.vaultId);});}
  onHeartbeat(msg){if(msg.vaultId)this.onlineUntil.set(msg.vaultId,Date.now()+30000);}
  isOnline(vaultId){return (this.onlineUntil.get(vaultId)||0)>Date.now();}
  onResponse(msg){const p=this.pending.get(msg.id);if(!p)return;if(p.vaultId&&msg.vaultId&&p.vaultId!==msg.vaultId)return;clearTimeout(p.timer);this.pending.delete(msg.id);if(msg.ok)p.resolve(msg.result);else{const e=new Error(msg.error||'Browser RPC failed');e.statusCode=msg.statusCode||502;p.reject(e);}}
  call(vaultId,method,params={},timeoutMs=this.defaultTimeoutMs){const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);const e=new Error(`No active Ignis browser tab answered '${method}' for vault '${vaultId}'`);e.statusCode=503;reject(e);},timeoutMs);this.pending.set(id,{vaultId,resolve,reject,timer});this.channel.broadcastToVault(vaultId,{type:'rpc-request',id,method,params});});}
  async tryCall(vaultId,method,params={},timeoutMs=1500){if(!this.isOnline(vaultId))return null;try{return await this.call(vaultId,method,params,timeoutMs);}catch(e){if(e.statusCode===503)return null;throw e;}}
  close(){this.channel.off('rpc-response');this.channel.off('bridge-online');this.channel.off('bridge-heartbeat');this.channel.off('bridge-offline');for(const[,p]of this.pending){clearTimeout(p.timer);p.reject(new Error('Browser RPC shutting down'));}this.pending.clear();this.onlineUntil.clear();}
}
module.exports={BrowserRpc};
