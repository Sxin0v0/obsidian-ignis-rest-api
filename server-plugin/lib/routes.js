const fs=require('fs');const path=require('path');
const {McpEndpoint}=require('./mcp');const {asBuffer,asText}=require('./service');const {sendError,apiError,statusError,ERROR_CODES}=require('./errors');
const CONTENT={json:'application/json',markdown:'text/markdown',html:'text/html',note:'application/vnd.olrapi.note+json',map:'application/vnd.olrapi.document-map+json',patch:'application/vnd.olrapi.patch-instruction+json',jsonlogic:'application/vnd.olrapi.jsonlogic+json'};
const BASE='/api/ext/local-rest-api';const CERT='obsidian-local-rest-api.crt';
const MAX_RAW_BODY_BYTES=1024*1024*1024;
function isJsonContentType(ct){return ct==='application/json'||ct.endsWith('+json');}
function rawBody(req,res,next){
  if(!['POST','PUT','PATCH'].includes(String(req.method||'').toUpperCase()))return next();
  if(Buffer.isBuffer(req.body)||typeof req.body==='string'||req.body instanceof Uint8Array)return next();
  const ct=requestContentType(req);
  // Ignis mounts express.json() before server-plugin routers. Preserve an already
  // parsed JSON body, but do not mistake Express's empty-object placeholder for
  // a parsed text/binary body. Non-JSON streams must still be read here.
  if(isJsonContentType(ct)&&req.body!==undefined)return next();
  const rawLength=req.get?.('Content-Length')??req.headers?.['content-length'];
  const declared=rawLength==null||rawLength===''?null:Number(rawLength);
  if(Number.isFinite(declared)&&declared>MAX_RAW_BODY_BYTES)return res.status(413).json({message:'Request body too large',errorCode:41300});
  if(req.readableEnded){
    if((declared===0||declared===null)&&(req.body===undefined||(req.body&&typeof req.body==='object'&&!Object.keys(req.body).length))){req.body=Buffer.alloc(0);return next();}
    return sendError(res,apiError(ERROR_CODES.InvalidContentForContentType,'The raw request body was consumed by upstream middleware before the Local REST API route could read it.'));
  }
  const chunks=[];let size=0;let done=false;
  const cleanup=()=>{req.off('data',onData);req.off('end',onEnd);req.off('error',onError);req.off('aborted',onAborted);};
  const finishError=(err)=>{if(done)return;done=true;cleanup();next(err);};
  const onData=(chunk)=>{if(done)return;const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>MAX_RAW_BODY_BYTES){done=true;cleanup();res.status(413).json({message:'Request body too large',errorCode:41300});req.destroy?.();return;}chunks.push(b);};
  const onEnd=()=>{if(done)return;done=true;cleanup();req.body=Buffer.concat(chunks,size);next();};
  const onError=(err)=>finishError(err);
  const onAborted=()=>finishError(statusError(400,'Request body was aborted before it could be read.'));
  req.on('data',onData);req.on('end',onEnd);req.on('error',onError);req.on('aborted',onAborted);
}
function getRawPath(req,prefix){const raw=String(req.url||'').split('?')[0];let rest=raw.startsWith(prefix)?raw.slice(prefix.length):'';rest=rest.replace(/^\/+|\/+$/g,'');if(!rest)return[];return rest.split('/').map((s)=>{try{return decodeURIComponent(s);}catch{throw statusError(400,`Invalid URL encoding in path segment: ${s}`);}});}
function encodePath(rel){return String(rel).split('/').map(encodeURIComponent).join('/');}
function parseBool(v){return String(v).toLowerCase()==='true';}
function parsePatchVersion(req,{defaultVersion=2}={}){const raw=req.get('Markdown-Patch-Version');if(raw==null||raw==='')return defaultVersion;if(raw!=='1'&&raw!=='2')throw apiError(ERROR_CODES.InvalidPatchVersionHeader);return Number(raw);}
function targetHeaders(req){const type=req.get('Target-Type'),target=req.get('Target');if(!type&&!target)return null;if(!type)throw apiError(ERROR_CODES.MissingTargetTypeHeader);if(!target)throw apiError(ERROR_CODES.MissingTargetHeader);if(!['heading','block','frontmatter'].includes(type))throw apiError(ERROR_CODES.InvalidTargetTypeHeader);return{targetType:type,target};}
function parseHeaderTargetV2(h){if(h.targetType==='heading'){let raw=h.target;try{raw=decodeURIComponent(raw);}catch{}let value;try{value=JSON.parse(raw);}catch{throw apiError(ERROR_CODES.InvalidTargetHeader,'For version 2 a heading Target header must be a percent-encoded JSON array.');}if(!(value===null||(Array.isArray(value)&&value.every((x)=>typeof x==='string'))))throw apiError(ERROR_CODES.InvalidTargetHeader);return{targetType:'heading',target:value};}let value=h.target;try{value=decodeURIComponent(value);}catch{}return{targetType:h.targetType,target:value};}
function parseWithin(req){const raw=req.get('Within');if(raw==null)return undefined;if(!/^-?\d+$/.test(raw))throw apiError(ERROR_CODES.InvalidWithinHeader);return Number(raw);}
function bodyIsJson(req){const ct=requestContentType(req);return ct==='application/json'||ct===CONTENT.patch||ct===CONTENT.jsonlogic||ct.endsWith('+json');}
function jsonBody(req){if(!bodyIsJson(req))return req.body;if(!Buffer.isBuffer(req.body))return req.body;try{return JSON.parse(req.body.toString('utf8'));}catch{throw apiError(ERROR_CODES.InvalidContentForContentType,'Request body is not valid JSON.');}}
function requestContentType(req){return String(req.get('Content-Type')||'').split(';')[0].trim().toLowerCase();}
function serializeBody(req){if(Buffer.isBuffer(req.body))return{encoding:'base64',data:req.body.toString('base64')};return{encoding:'json',data:req.body};}
function rootStatusPayload(plugin,{authenticated=false,enabledVaults,apiExtensions}={}){
  return{status:'OK',service:'Obsidian Ignis REST API',versions:{plugin:plugin.version,api:'5.1-compatible',mcp:'2026-07-28'},authenticated:!!authenticated,authRequired:true,basePath:BASE,...(authenticated?{enabledVaults:enabledVaults||[],apiExtensions:apiExtensions||[]}:{}) ,tls:{managedBy:'Ignis/reverse-proxy',pluginCertificate:false}};
}
function extensionResponse(res,result){if(!result)return false;for(const[k,v]of Object.entries(result.headers||{}))if(v!=null)res.setHeader(k,String(v));res.status(result.statusCode||200);if(result.bodyEncoding==='base64')return res.send(Buffer.from(result.body||'','base64'));if(result.body===undefined||result.body===null)return res.end();if(result.bodyType==='json'||typeof result.body==='object')return res.json(result.body);return res.send(String(result.body));}

async function resolveFileAndTarget(plugin,vaultId,segments,{allowMissingWhole=false}={}){
  const service=plugin.service;if(!segments.length)return{filePath:'',targetType:null,target:null,targetSegments:null,isDirectory:true};
  const whole=segments.join('/');const wholeStat=await service.pathState(vaultId,whole);if(wholeStat){if(wholeStat.isDirectory())return{filePath:whole,targetType:null,target:null,targetSegments:null,isDirectory:true};if(wholeStat.isFile())return{filePath:whole,targetType:null,target:null,targetSegments:null,isDirectory:false};}
  for(let i=segments.length-1;i>=1;i--){const candidate=segments.slice(0,i).join('/');const st=await service.pathState(vaultId,candidate);if(!st?.isFile())continue;const rest=segments.slice(i);const type=rest[0];if(!['heading','block','frontmatter'].includes(type)||rest.length<2)return null;const parts=rest.slice(1);return{filePath:candidate,targetType:type,target:type==='heading'?parts:parts.join('/'),targetSegments:parts,isDirectory:false};}
  if(allowMissingWhole)return{filePath:whole,targetType:null,target:null,targetSegments:null,isDirectory:false,missing:true};return null;
}

function mountRoutes(router,plugin){const{service,config,ctx,extensions}=plugin;
  plugin.resolveVaultId=(req,explicit)=>{const enabled=ctx.getEnabledVaults();const requested=explicit||req.get('X-Ignis-Vault')||req.query?.vault||config.defaultVault;if(requested){if(!enabled.includes(requested))throw statusError(404,`Vault '${requested}' is not enabled for this plugin.`);return requested;}if(enabled.length===1)return enabled[0];if(!enabled.length)throw statusError(503,'No vaults are enabled for Obsidian Ignis REST API.');throw statusError(400,'Multiple vaults are enabled; supply X-Ignis-Vault, ?vault=, or an MCP tool vault argument.');};
  router.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin',config.corsOrigin||'*');res.setHeader('Access-Control-Allow-Headers',`${config.authorizationHeaderName}, Authorization, Content-Type, X-Ignis-Vault, MCP-Protocol-Version, Mcp-Session-Id, Markdown-Patch-Version, Operation, Target-Type, Target, Target-Scope, Target-Delimiter, Trim-Target-Whitespace, Create-Target-If-Missing, Reject-If-Content-Preexists, Destination, Allow-Overwrite, Within, If-Match`);res.setHeader('Access-Control-Allow-Methods','GET, HEAD, PUT, PATCH, POST, DELETE, MOVE, COPY, OPTIONS');res.setHeader('Access-Control-Expose-Headers','*');if(req.method==='OPTIONS')return res.status(204).end();next();});

  const isAuthenticated=(req)=>{const value=req.get(config.authorizationHeaderName)||'';return value===`Bearer ${config.apiKey}`;};
  router.get('/',(req,res)=>{const authenticated=isAuthenticated(req);return res.json(rootStatusPayload(plugin,{authenticated,enabledVaults:authenticated?ctx.getEnabledVaults():undefined,apiExtensions:authenticated?extensions.summary():undefined}));});
  router.get('/openapi.yaml',(req,res)=>res.type('application/yaml').send(fs.readFileSync(path.join(__dirname,'..','docs','openapi.yaml'),'utf8')));
  router.get(`/${CERT}`,(req,res)=>res.status(410).json({message:'Ignis owns the HTTP/TLS listener, so this server-plugin does not generate a local CA certificate. Trust/configure the TLS certificate on your Ignis reverse proxy instead.',errorCode:41000}));

  router.use(async(req,res,next)=>{try{let vaultId;try{vaultId=plugin.resolveVaultId(req);}catch{return next();}const result=await extensions.handleRoute(vaultId,req.method,req.path,false,{method:req.method,path:req.path,url:req.originalUrl,headers:req.headers,query:req.query,body:serializeBody(req)});if(!result)return next();return extensionResponse(res,result);}catch(e){return sendError(res,e);}});
  router.use((req,res,next)=>{if(['/','/openapi.yaml',`/${CERT}`].includes(req.path))return next();if(isAuthenticated(req))return next();return sendError(res,apiError(ERROR_CODES.ApiKeyAuthorizationRequired));});

  plugin.mcp=new McpEndpoint(service,(req,explicit)=>plugin.resolveVaultId(req,explicit),plugin.version,extensions,()=>fs.readFileSync(path.join(__dirname,'..','docs','openapi.yaml'),'utf8'));
  router.use('/mcp',rawBody,plugin.mcp.middleware());
  router.get('/vaults',(req,res)=>res.json({vaults:ctx.getEnabledVaults(),defaultVault:config.defaultVault||null}));

  async function getResponse(vaultId,resolved,req,res){
    const accept=(req.get('Accept')||'').split(',')[0].trim();if(resolved.isDirectory){const files=await service.list(vaultId,resolved.filePath);return res.status(200).json({files});}
    if(resolved.targetType){const scope=req.get('Target-Scope')||'content';const target=await service.targetedRead(vaultId,resolved.filePath,resolved.targetType,resolved.target,scope);if(target.kind==='frontmatter')return res.status(200).json(target.value);return res.status(200).type(CONTENT.markdown).send(target.content);}
    if(accept===CONTENT.note)return res.status(200).json(await service.metadata(vaultId,resolved.filePath,{includeContent:true}));
    if(accept===CONTENT.map){const version=parsePatchVersion(req);return res.status(200).json(await service.documentMap(vaultId,resolved.filePath,version));}
    if(accept===CONTENT.html){const html=await service.renderHtml(vaultId,resolved.filePath);return res.status(200).type(CONTENT.html).send(html);}
    const raw=await service.readRaw(vaultId,resolved.filePath);res.setHeader('Content-Type',raw.mime);res.setHeader('Content-Length',raw.buffer.length);return res.status(200).send(raw.buffer);
  }

  async function targetedWrite(vaultId,resolved,req,res,operation,{createTargetIfMissing=false}={}){const version=parsePatchVersion(req);if(version===1)res.setHeader('Deprecation','true; sunset-version="6.0"');const body=bodyIsJson(req)?jsonBody(req):asText(req.body);let ins;if(version===1){ins={targetType:resolved.targetType,target:resolved.targetType==='heading'?resolved.target.join(req.get('Target-Delimiter')||'::'):resolved.target,operation,targetScope:req.get('Target-Scope')||'content',targetDelimiter:req.get('Target-Delimiter')||'::',trimTargetWhitespace:parseBool(req.get('Trim-Target-Whitespace')),createTargetIfMissing:createTargetIfMissing||parseBool(req.get('Create-Target-If-Missing')),rejectIfContentPreexists:parseBool(req.get('Reject-If-Content-Preexists'))};if(resolved.targetType==='frontmatter'&&bodyIsJson(req))ins.value=body;else ins.content=typeof body==='string'?body:JSON.stringify(body);}else{ins={targetType:resolved.targetType,target:resolved.target,operation,scope:req.get('Target-Scope')||'content',createTargetIfMissing:createTargetIfMissing||parseBool(req.get('Create-Target-If-Missing')),rejectIfContentPreexists:parseBool(req.get('Reject-If-Content-Preexists'))};const within=parseWithin(req);if(within!==undefined)ins.within=within;if(req.get('If-Match'))ins.ifMatch=req.get('If-Match');if(resolved.targetType==='frontmatter'){ins.value=bodyIsJson(req)?body:asText(req.body);}else ins.content=asText(req.body);}const result=await service.patch(vaultId,resolved.filePath,ins,{version});if(result.warnings?.length)res.setHeader('Markdown-Patch-Warnings',encodeURIComponent(JSON.stringify(result.warnings)));return res.status(200).type(CONTENT.markdown).send(result.document);}

  async function headerTargetedLegacy(vaultId,filePath,req,res,operation){const h=targetHeaders(req);if(!h)return false;if(parsePatchVersion(req)!==1)throw apiError(ERROR_CODES.HeaderTargetingRequiresVersion1);res.setHeader('Deprecation','true; sunset-version="6.0"');const body=bodyIsJson(req)?jsonBody(req):asText(req.body);const ins={targetType:h.targetType,target:h.target,operation,targetScope:req.get('Target-Scope')||'content',targetDelimiter:req.get('Target-Delimiter')||'::',trimTargetWhitespace:parseBool(req.get('Trim-Target-Whitespace')),createTargetIfMissing:parseBool(req.get('Create-Target-If-Missing')),rejectIfContentPreexists:parseBool(req.get('Reject-If-Content-Preexists'))};if(operation!=='delete'){if(h.targetType==='frontmatter'&&bodyIsJson(req))ins.value=body;else ins.content=typeof body==='string'?body:JSON.stringify(body);}const result=await service.patch(vaultId,filePath,ins,{version:1});return res.status(200).type(CONTENT.markdown).send(result.document);}

  async function patchHandler(vaultId,resolved,req,res){
    if(resolved.isDirectory)throw apiError(ERROR_CODES.RequestMethodValidOnlyForFiles);const h=targetHeaders(req);const rawVersion=req.get('Markdown-Patch-Version');if(h&&!rawVersion)throw apiError(ERROR_CODES.PatchHeaderTargetingRequiresExplicitVersion);const version=parsePatchVersion(req);
    if(version===1){if(resolved.targetType&&h)throw apiError(ERROR_CODES.ConflictingTargetSpecification);res.setHeader('Deprecation','true; sunset-version="6.0"');const target=resolved.targetType?{targetType:resolved.targetType,target:resolved.targetType==='heading'?resolved.target.join(req.get('Target-Delimiter')||'::'):resolved.target}:h;if(!target)throw apiError(ERROR_CODES.MissingTargetTypeHeader);const body=bodyIsJson(req)?jsonBody(req):asText(req.body);const ins={targetType:target.targetType,target:target.target,operation:req.get('Operation'),targetScope:req.get('Target-Scope')||'content',targetDelimiter:req.get('Target-Delimiter')||'::',trimTargetWhitespace:parseBool(req.get('Trim-Target-Whitespace')),createTargetIfMissing:parseBool(req.get('Create-Target-If-Missing')),rejectIfContentPreexists:parseBool(req.get('Reject-If-Content-Preexists'))};if(!ins.operation)throw apiError(ERROR_CODES.MissingOperation);if(ins.operation!=='delete'){if(target.targetType==='frontmatter'&&bodyIsJson(req))ins.value=body;else ins.content=typeof body==='string'?body:JSON.stringify(body);}const result=await service.patch(vaultId,resolved.filePath,ins,{version:1});return res.status(200).type(CONTENT.markdown).send(result.document);}
    if(req.get('Target-Delimiter')||req.get('Trim-Target-Whitespace'))throw apiError(ERROR_CODES.HeaderTargetingRequiresVersion1);
    const parsedBody=bodyIsJson(req)?jsonBody(req):req.body;const hasBodyInstruction=parsedBody&&typeof parsedBody==='object'&&!Buffer.isBuffer(parsedBody)&&('targetType'in parsedBody||requestContentType(req)===CONTENT.patch);
    if(hasBodyInstruction&&(resolved.targetType||h))throw apiError(ERROR_CODES.ConflictingTargetSpecification);
    let ins;
    if(hasBodyInstruction)ins={...parsedBody};
    else{
      const target=resolved.targetType?{targetType:resolved.targetType,target:resolved.target}:h?parseHeaderTargetV2(h):null;if(!target)throw apiError(ERROR_CODES.InvalidPatchInstruction,'PATCH v2 requires a JSON instruction body or a target supplied by path/headers.');const operation=req.get('Operation');if(!operation)throw apiError(ERROR_CODES.MissingOperation);ins={...target,operation,scope:req.get('Target-Scope')||'content'};const within=parseWithin(req);if(within!==undefined)ins.within=within;if(req.get('If-Match'))ins.ifMatch=req.get('If-Match');if(req.get('Create-Target-If-Missing')!=null)ins.createTargetIfMissing=parseBool(req.get('Create-Target-If-Missing'));if(req.get('Reject-If-Content-Preexists')!=null)ins.rejectIfContentPreexists=parseBool(req.get('Reject-If-Content-Preexists'));if(ins.scope==='parent'){const d=req.get('Destination');if(!d)throw apiError(ERROR_CODES.MissingDestinationHeader);try{ins.destination=JSON.parse(decodeURIComponent(d));}catch{throw apiError(ERROR_CODES.InvalidDestinationHeader);}}else if(operation!=='delete'){if(target.targetType==='frontmatter'){ins.value=bodyIsJson(req)?jsonBody(req):asText(req.body);}else if(bodyIsJson(req))ins.value=jsonBody(req);else ins.content=asText(req.body);}}
    const result=await service.patch(vaultId,resolved.filePath,ins,{version:2});if(result.warnings?.length)res.setHeader('Markdown-Patch-Warnings',encodeURIComponent(JSON.stringify(result.warnings)));return res.status(200).type(CONTENT.markdown).send(result.document);
  }

  async function fileMethod(req,res,{active=false}={}){try{const vaultId=plugin.resolveVaultId(req);let resolved;
    if(active){const activeInfo=await service.activePath(vaultId);const filePath=activeInfo.path;const suffix=getRawPath(req,'/active');if(!suffix.length)resolved={filePath,targetType:null,target:null,isDirectory:false};else{const type=suffix[0];if(!['heading','block','frontmatter'].includes(type)||suffix.length<2)throw statusError(404,'Invalid active-file target path.');resolved={filePath,targetType:type,target:type==='heading'?suffix.slice(1):suffix.slice(1).join('/'),isDirectory:false};}}
    else{const segments=getRawPath(req,'/vault');resolved=await resolveFileAndTarget(plugin,vaultId,segments,{allowMissingWhole:req.method==='PUT'||req.method==='POST'});if(!resolved)throw statusError(404,'Path or target not found.');}
    if(req.method==='GET'||req.method==='HEAD')return getResponse(vaultId,resolved,req,res);
    if(req.method==='PUT'){if(resolved.isDirectory)throw apiError(ERROR_CODES.RequestMethodValidOnlyForFiles);if(resolved.targetType)return targetedWrite(vaultId,resolved,req,res,'replace',{createTargetIfMissing:true});if(await headerTargetedLegacy(vaultId,resolved.filePath,req,res,'replace'))return;await service.write(vaultId,resolved.filePath,req.body);res.setHeader('Content-Location',`${BASE}/vault/${encodePath(resolved.filePath)}`);return res.status(204).end();}
    if(req.method==='POST'){if(resolved.isDirectory)throw apiError(ERROR_CODES.RequestMethodValidOnlyForFiles);if(resolved.targetType)return targetedWrite(vaultId,resolved,req,res,'append');if(await headerTargetedLegacy(vaultId,resolved.filePath,req,res,'append'))return;const ct=requestContentType(req);if(!ct.startsWith('text/'))throw apiError(ERROR_CODES.TextContentEncodingRequired);await service.append(vaultId,resolved.filePath,asText(req.body));return res.status(204).end();}
    if(req.method==='PATCH')return patchHandler(vaultId,resolved,req,res);
    if(req.method==='DELETE'){if(resolved.targetType)return res.status(405).json({message:'Deleting a targeted section via URL is not supported. Use PATCH with operation delete.',errorCode:40500});await service.delete(vaultId,resolved.filePath,{permanent:req.query.permanent==='true'});return res.status(204).end();}
    if(req.method==='MOVE'||req.method==='COPY'){if(active)throw statusError(405,'MOVE/COPY are available on /vault paths, not /active.');if(resolved.targetType||resolved.isDirectory)throw apiError(ERROR_CODES.RequestMethodValidOnlyForFiles);const dest=req.get('Destination');if(!dest)throw apiError(ERROR_CODES.MissingDestinationHeader);const actual=req.method==='MOVE'?await service.move(vaultId,resolved.filePath,dest,{allowOverwrite:parseBool(req.get('Allow-Overwrite'))}):await service.copy(vaultId,resolved.filePath,dest,{allowOverwrite:parseBool(req.get('Allow-Overwrite'))});res.setHeader('Content-Location',`${BASE}/vault/${encodePath(actual)}`);return res.status(204).end();}
    return res.status(405).end();}catch(e){return sendError(res,e);}}

  router.all(/^\/vault(?:\/.*)?$/,rawBody,(req,res)=>fileMethod(req,res));
  router.all(/^\/active(?:\/.*)?$/,rawBody,(req,res)=>fileMethod(req,res,{active:true}));

  router.get('/tags/',async(req,res)=>{try{return res.json({tags:await service.tags(plugin.resolveVaultId(req))});}catch(e){return sendError(res,e);}});
  router.get('/commands/',async(req,res)=>{try{return res.json({commands:await service.commands(plugin.resolveVaultId(req),'list')});}catch(e){return sendError(res,e);}});
  router.post('/commands/:commandId/',async(req,res)=>{try{await service.commands(plugin.resolveVaultId(req),'execute',{commandId:req.params.commandId});return res.status(204).end();}catch(e){if(/not found/i.test(e.message))e.statusCode=404;return sendError(res,e);}});
  router.post(/^\/search\/simple\/?$/,async(req,res)=>{try{const values=Array.isArray(req.query.query)?req.query.query:[req.query.query];if(values.length!==1||typeof values[0]!=='string')throw apiError(ERROR_CODES.InvalidSearch,"A single '?query=' parameter is required.");const context=req.query.contextLength==null?100:Number(req.query.contextLength);if(!Number.isFinite(context)||context<0)throw apiError(ERROR_CODES.InvalidSearch,'contextLength must be a non-negative number.');return res.json(await service.simpleSearch(plugin.resolveVaultId(req),values[0],context));}catch(e){return sendError(res,e);}});
  router.post(/^\/search\/?$/,rawBody,async(req,res)=>{try{if(requestContentType(req)!==CONTENT.jsonlogic&&!req.is('application/json'))throw apiError(ERROR_CODES.InvalidContentType,`Expected ${CONTENT.jsonlogic}.`);return res.json(await service.structuredSearch(plugin.resolveVaultId(req),jsonBody(req)));}catch(e){return sendError(res,e);}});
  router.post(/^\/open\/(.*)$/,async(req,res)=>{try{const vaultId=plugin.resolveVaultId(req);const seg=getRawPath(req,'/open');const filePath=seg.join('/');await service.open(vaultId,filePath,req.query.newLeaf==='true');return res.status(204).end();}catch(e){return sendError(res,e);}});

  router.use(async(req,res,next)=>{try{const vaultId=plugin.resolveVaultId(req);const result=await extensions.handleRoute(vaultId,req.method,req.path,true,{method:req.method,path:req.path,url:req.originalUrl,headers:req.headers,query:req.query,body:serializeBody(req)});if(!result)return next();return extensionResponse(res,result);}catch(e){return sendError(res,e);}});
  router.use((req,res)=>res.status(404).json({message:'Not Found',errorCode:40400}));
}
module.exports={mountRoutes,getRawPath,resolveFileAndTarget,parsePatchVersion,targetHeaders,rawBody,isJsonContentType,rootStatusPayload,MAX_RAW_BODY_BYTES,CONTENT,BASE};
