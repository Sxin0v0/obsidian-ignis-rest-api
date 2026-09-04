const crypto=require('crypto');const {strictUtf8}=require('./service');const {projectMap}=require('./markdown');const {lookup}=require('./mime');
const SUPPORTED_PROTOCOLS=['2026-07-28','2025-11-25','2025-06-18','2025-03-26','2024-11-05','2024-10-07'];const MAX_BINARY=1024*1024;
const READ_ONLY={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
function schema(properties={},required=[]){return{type:'object',properties,required,additionalProperties:false};}
function tool(name,description,inputSchema,annotations=READ_ONLY){return{name,description,inputSchema,annotations};}
const vaultProp={vault:{type:'string',description:'Ignis vault ID. Optional when only one vault is enabled or a default is configured.'}};
const TOOLS=[
 tool('vault_list','List files and subdirectories inside a vault directory. Directory names end with /.',schema({...vaultProp,path:{type:'string',description:'Directory path relative to vault root',default:''}})),
 tool('vault_read','Read a UTF-8 vault file with metadata, or read one targeted heading/block/frontmatter section.',schema({...vaultProp,path:{type:'string'},targetType:{enum:['heading','block','frontmatter']},target:{oneOf:[{type:'array',items:{type:'string'}},{type:'string'}]},scope:{enum:['content','marker','markerAndContent']}},['path'])),
 tool('vault_write','Create or overwrite a UTF-8 vault file.',schema({...vaultProp,path:{type:'string'},content:{type:'string'}},['path','content']),{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}),
 tool('vault_read_binary','Read a small binary vault file as base64 (maximum 1 MiB).',schema({...vaultProp,path:{type:'string'}},['path'])),
 tool('vault_write_binary','Create or overwrite a small binary file from base64 (maximum 1 MiB).',schema({...vaultProp,path:{type:'string'},content:{type:'string',description:'Base64 payload'}},['path','content']),{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}),
 tool('vault_append','Append UTF-8 content to a vault file, creating it if needed.',schema({...vaultProp,path:{type:'string'},content:{type:'string'}},['path','content']),{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}),
 tool('vault_patch','Apply a markdown-patch 2 style structured instruction.',schema({...vaultProp,path:{type:'string'},targetType:{enum:['heading','block','frontmatter']},target:{},within:{type:'integer'},operation:{enum:['replace','prepend','append','delete']},scope:{enum:['content','marker','markerAndContent','parent']},content:{type:'string'},value:{},destination:{type:'object'},ifMatch:{type:'string'},createTargetIfMissing:{type:'boolean'},rejectIfContentPreexists:{type:'boolean'}},['path','targetType','target','operation']),{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}),
 tool('vault_delete','Delete a vault file. By default moves it to trash; permanent=true hard-deletes it.',schema({...vaultProp,path:{type:'string'},permanent:{type:'boolean'}},['path']),{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}),
 tool('vault_move','Move/rename a vault file.',schema({...vaultProp,path:{type:'string'},destination:{type:'string'},allowOverwrite:{type:'boolean'}},['path','destination']),{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}),
 tool('vault_copy','Copy a vault file.',schema({...vaultProp,path:{type:'string'},destination:{type:'string'},allowOverwrite:{type:'boolean'}},['path','destination']),{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}),
 tool('vault_get_document_map','Return the markdown-patch 2 document map: version, heading tree, block IDs, and frontmatter fields.',schema({...vaultProp,path:{type:'string'}},['path'])),
 tool('active_file_get_path','Return the vault-relative path of the file currently open in an Ignis Obsidian tab.',schema({...vaultProp})),
 tool('search_query','Search Markdown files using a JsonLogic query against note metadata.',schema({...vaultProp,query:{type:'object'}},['query'])),
 tool('search_simple','Search Markdown files using Obsidian simple search when a browser tab is online, with a server fallback.',schema({...vaultProp,query:{type:'string'},contextLength:{type:'number',minimum:0}},['query'])),
 tool('tag_list','Return all tags with usage counts.',schema({...vaultProp})),
 tool('command_list','Return registered Obsidian commands from an open Ignis browser tab.',schema({...vaultProp})),
 tool('command_execute','Execute an Obsidian command by ID.',schema({...vaultProp,commandId:{type:'string'}},['commandId']),{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}),
 tool('open_file','Open a file in the Ignis Obsidian UI.',schema({...vaultProp,path:{type:'string'},newLeaf:{type:'boolean'}},['path']),{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}),
];
function textResult(value){const text=typeof value==='string'?value:JSON.stringify(value,null,2);return{content:[{type:'text',text}],structuredContent:(value&&typeof value==='object')?value:undefined};}
function strictBase64(s){if(typeof s!=='string'||s.length%4===1||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw new Error('Invalid base64 payload.');const b=Buffer.from(s,'base64');if(b.toString('base64').replace(/=+$/,'')!==s.replace(/=+$/,''))throw new Error('Invalid base64 payload.');return b;}
class McpEndpoint{
 constructor(service,resolveVaultId,version,extensions,getOpenApi){this.service=service;this.resolveVaultId=resolveVaultId;this.version=version;this.extensions=extensions;this.getOpenApi=getOpenApi;this.sessions=new Map();}
 cleanup(){const cutoff=Date.now()-24*3600*1000;for(const[id,s]of this.sessions)if(s.lastSeen<cutoff)this.sessions.delete(id);}
 resolveVault(req,args={}){return this.resolveVaultId(req,args?.vault);}
 listTools(req){const vaultId=this.resolveVault(req,{});const extra=this.extensions.listTools(vaultId).map(({_toolId,...t})=>t);const names=new Set(TOOLS.map((t)=>t.name));return[...TOOLS,...extra.filter((t)=>!names.has(t.name))];}
 async callTool(name,args,req){const a=args||{};const vaultId=this.resolveVault(req,a);
  switch(name){
   case'vault_list':return{files:await this.service.list(vaultId,a.path||'')};
   case'vault_read':{if((a.targetType==null)!=(a.target==null))throw new Error('targetType and target must be provided together');if(a.scope!==undefined&&a.targetType==null)throw new Error('scope requires targetType and target');if(a.targetType){if(a.targetType==='heading'&&typeof a.target==='string')throw new Error('A heading target must be an array of heading texts, not a bare string.');const r=await this.service.targetedRead(vaultId,a.path,a.targetType,a.target,a.scope||'content');return r.kind==='frontmatter'?r.value:r.content;}const raw=await this.service.readRaw(vaultId,a.path);if(raw.kind!=='file')throw new Error(`Path is not a file: ${a.path}`);strictUtf8(raw.buffer,a.path);return this.service.metadata(vaultId,a.path,{includeContent:true});}
   case'vault_write':await this.service.write(vaultId,a.path,a.content);return{message:'OK'};
   case'vault_read_binary':{const r=await this.service.readRaw(vaultId,a.path);if(r.kind!=='file')throw new Error('Path is not a file');if(r.buffer.length>MAX_BINARY)throw new Error(`File is ${r.buffer.length} bytes; vault_read_binary is limited to ${MAX_BINARY} bytes. Use REST GET for larger files.`);return{path:a.path,mimeType:lookup(a.path),size:r.buffer.length,encoding:'base64',content:r.buffer.toString('base64')};}
   case'vault_write_binary':{const b=strictBase64(a.content);if(b.length>MAX_BINARY)throw new Error(`Binary write is limited to ${MAX_BINARY} bytes. Use REST PUT for larger files.`);await this.service.write(vaultId,a.path,b);return{message:'OK',size:b.length};}
   case'vault_append':await this.service.append(vaultId,a.path,a.content);return{message:'OK'};
   case'vault_patch':{const{path,vault,...ins}=a;const r=await this.service.patch(vaultId,path,ins,{version:2});return r.warnings?.length?{message:'OK',warnings:r.warnings}:{message:'OK'};}
   case'vault_delete':await this.service.delete(vaultId,a.path,{permanent:!!a.permanent});return{message:'OK'};
   case'vault_move':{const p=await this.service.move(vaultId,a.path,a.destination,{allowOverwrite:!!a.allowOverwrite});return{message:'OK',oldPath:a.path,newPath:p};}
   case'vault_copy':{const p=await this.service.copy(vaultId,a.path,a.destination,{allowOverwrite:!!a.allowOverwrite});return{message:'OK',sourcePath:a.path,newPath:p};}
   case'vault_get_document_map':return this.service.documentMap(vaultId,a.path,2);
   case'active_file_get_path':return this.service.activePath(vaultId);
   case'search_query':return this.service.structuredSearch(vaultId,a.query);
   case'search_simple':return this.service.simpleSearch(vaultId,a.query,a.contextLength??100);
   case'tag_list':return{tags:await this.service.tags(vaultId)};
   case'command_list':return{commands:await this.service.commands(vaultId,'list')};
   case'command_execute':await this.service.commands(vaultId,'execute',{commandId:a.commandId});return{message:'OK'};
   case'open_file':await this.service.open(vaultId,a.path,!!a.newLeaf);return{message:'OK'};
   default:{const ext=await this.extensions.callTool(vaultId,name,a);if(ext!==null)return ext;throw new Error(`Unknown tool: ${name}`);}
  }}
 async rpc(body,req,res){if(!body||body.jsonrpc!=='2.0'||typeof body.method!=='string')return{jsonrpc:'2.0',id:body?.id??null,error:{code:-32600,message:'Invalid Request'}};const id=Object.prototype.hasOwnProperty.call(body,'id')?body.id:null;try{
   if(body.method==='initialize'){const requested=body.params?.protocolVersion;const protocolVersion=SUPPORTED_PROTOCOLS.includes(requested)?requested:'2025-11-25';const sessionId=crypto.randomUUID();this.sessions.set(sessionId,{lastSeen:Date.now(),protocolVersion});res.setHeader('Mcp-Session-Id',sessionId);return{jsonrpc:'2.0',id,result:{protocolVersion,capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false}},serverInfo:{name:'obsidian-local-rest-api',version:this.version},instructions:'This is the Ignis server-plugin port. Use X-Ignis-Vault or the optional vault tool argument when multiple vaults are enabled.'}};}
   if(body.method.startsWith('notifications/'))return null;if(body.method==='ping')return{jsonrpc:'2.0',id,result:{}};
   if(body.method==='tools/list')return{jsonrpc:'2.0',id,result:{tools:this.listTools(req)}};
   if(body.method==='tools/call'){try{return{jsonrpc:'2.0',id,result:textResult(await this.callTool(body.params?.name,body.params?.arguments||{},req))};}catch(e){return{jsonrpc:'2.0',id,result:{content:[{type:'text',text:e.message}],isError:true}};}}
   if(body.method==='resources/list')return{jsonrpc:'2.0',id,result:{resources:[{uri:'obsidian://local-rest-api/openapi.yaml',name:'openapi-spec',description:'Full OpenAPI specification for Obsidian Ignis REST API.',mimeType:'application/yaml'}]}};
   if(body.method==='resources/read'){if(body.params?.uri!=='obsidian://local-rest-api/openapi.yaml')throw new Error('Resource not found');return{jsonrpc:'2.0',id,result:{contents:[{uri:body.params.uri,mimeType:'application/yaml',text:this.getOpenApi()}]}};}
   if(body.method==='resources/templates/list')return{jsonrpc:'2.0',id,result:{resourceTemplates:[]}};if(body.method==='prompts/list')return{jsonrpc:'2.0',id,result:{prompts:[]}};
   return{jsonrpc:'2.0',id,error:{code:-32601,message:`Method not found: ${body.method}`}};
  }catch(e){return{jsonrpc:'2.0',id,error:{code:-32603,message:e.message}};}}
 middleware(){return async(req,res)=>{this.cleanup();res.setHeader('Access-Control-Expose-Headers','*');const protocol=req.get('MCP-Protocol-Version');if(protocol&&!SUPPORTED_PROTOCOLS.includes(protocol))return res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32600,message:`Unsupported MCP-Protocol-Version: ${protocol}`}});const sessionId=req.get('Mcp-Session-Id');if(sessionId&&this.sessions.has(sessionId))this.sessions.get(sessionId).lastSeen=Date.now();
   if(req.method==='DELETE'){if(sessionId)this.sessions.delete(sessionId);return res.status(204).end();}
   if(req.method==='GET'){res.status(200);res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.write(': stream ready\n\n');const timer=setInterval(()=>res.write(': keepalive\n\n'),25000);timer.unref?.();req.on('close',()=>clearInterval(timer));return;}
   if(req.method!=='POST')return res.status(405).end();let body=req.body;if(Buffer.isBuffer(body)){try{body=JSON.parse(body.toString('utf8'));}catch{return res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}}const batch=Array.isArray(body)?body:[body];const out=[];for(const item of batch){const r=await this.rpc(item,req,res);if(r)out.push(r);}if(!out.length)return res.status(202).end();return res.type('application/json').send(Array.isArray(body)?out:out[0]);};}
}
module.exports={McpEndpoint,TOOLS,SUPPORTED_PROTOCOLS,MAX_BINARY};
