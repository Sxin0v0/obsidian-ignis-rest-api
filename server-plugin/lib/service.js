const path=require('path');
const { normalizeRelativePath,statPath,listDirectory,readFile,writeFile,appendFile,deleteFile,moveFile,copyFile,walkFiles,fileStat }=require('./vault');
const { readTarget,patchV2,legacyPatch,projectMap,legacyDocumentMap,parseFrontmatter }=require('./markdown-compat');
const { metadataForFile,simpleSearch,structuredSearch,tagCounts,buildFileIndex,buildBacklinks }=require('./search');
const { lookup,isTextMime }=require('./mime');
const { apiError,statusError,ERROR_CODES }=require('./errors');

function asBuffer(body){if(Buffer.isBuffer(body))return body;if(body===undefined||body===null)return Buffer.alloc(0);if(typeof body==='string')return Buffer.from(body);if(body instanceof Uint8Array)return Buffer.from(body);return Buffer.from(JSON.stringify(body));}
function asText(body){return asBuffer(body).toString('utf8');}
function strictUtf8(buffer,pathName){try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer);}catch{throw new Error(`Refusing to read ${pathName} as text because its bytes are not valid UTF-8. Use vault_read_binary or the REST API.`);}}

class VaultService{
  constructor(ctx,rpc,config){this.ctx=ctx;this.rpc=rpc;this.config=config;}
  getVault(vaultId){const root=this.ctx.config.getVaultPath(vaultId);if(!root)throw statusError(404,`Vault not found: ${vaultId}`);return root;}
  async pathState(vaultId,rel){return statPath(this.getVault(vaultId),rel);}
  async list(vaultId,rel=''){return listDirectory(this.getVault(vaultId),normalizeRelativePath(rel));}
  async readRaw(vaultId,rel){const root=this.getVault(vaultId);const safe=normalizeRelativePath(rel);const st=await statPath(root,safe);if(!st)throw statusError(404,`File not found: ${safe}`);if(st.isDirectory())return{kind:'directory',files:await listDirectory(root,safe)};return{kind:'file',path:safe,buffer:await readFile(root,safe),mimeType:lookup(safe),stat:{ctime:st.ctimeMs,mtime:st.mtimeMs,size:st.size}};}
  async readText(vaultId,rel){const r=await this.readRaw(vaultId,rel);if(r.kind!=='file')throw apiError(ERROR_CODES.RequestMethodValidOnlyForFiles);return strictUtf8(r.buffer,r.path);}
  async metadata(vaultId,rel,{includeContent=true}={}){const browser=await this.rpc.tryCall(vaultId,'metadata.file',{path:rel,includeContent},1000);if(browser)return browser;const root=this.getVault(vaultId),index=await buildFileIndex(root),backlinks=await buildBacklinks(root,index);return metadataForFile(root,normalizeRelativePath(rel),{includeContent,index,backlinkIndex:backlinks});}
  async documentMap(vaultId,rel,version=2){const text=await this.readText(vaultId,rel);return version===1?legacyDocumentMap(text):projectMap(text);}
  async targetedRead(vaultId,rel,targetType,target,scope='content',within){const text=await this.readText(vaultId,rel);return readTarget(text,{targetType,target,scope,within});}
  async renderMarkdown(vaultId,rel,markdown){const browser=await this.rpc.tryCall(vaultId,'render.markdown',{path:rel,markdown},1500);if(browser?.html!=null)return browser.html;return fallbackMarkdownHtml(markdown);}
  async write(vaultId,rel,body){await writeFile(this.getVault(vaultId),rel,asBuffer(body));return normalizeRelativePath(rel);}
  async append(vaultId,rel,body){if(typeof body!=='string'&&!Buffer.isBuffer(body))body=asText(body);await appendFile(this.getVault(vaultId),rel,body);return normalizeRelativePath(rel);}
  async patch(vaultId,rel,instruction,{version=2}={}){const root=this.getVault(vaultId),safe=normalizeRelativePath(rel);const current=strictUtf8(await readFile(root,safe),safe);const result=version===1?legacyPatch(current,instruction):patchV2(current,instruction);await writeFile(root,safe,result.document);return result;}
  async delete(vaultId,rel,{permanent=false}={}){const safe=normalizeRelativePath(rel);const browser=await this.rpc.tryCall(vaultId,'file.delete',{path:safe,permanent},1200);if(browser)return browser;return deleteFile(this.getVault(vaultId),safe,{permanent});}
  async move(vaultId,source,destination,{allowOverwrite=false}={}){const safe=normalizeRelativePath(source);const browser=await this.rpc.tryCall(vaultId,'file.move',{path:safe,destination,allowOverwrite},1800);if(browser?.newPath)return browser.newPath;return moveFile(this.getVault(vaultId),safe,destination,{allowOverwrite});}
  async copy(vaultId,source,destination,{allowOverwrite=false}={}){const safe=normalizeRelativePath(source);const browser=await this.rpc.tryCall(vaultId,'file.copy',{path:safe,destination,allowOverwrite},1500);if(browser?.newPath)return browser.newPath;return copyFile(this.getVault(vaultId),safe,destination,{allowOverwrite});}
  async simpleSearch(vaultId,query,contextLength=100){const browser=await this.rpc.tryCall(vaultId,'search.simple',{query,contextLength},1500);if(browser?.results)return browser.results;return simpleSearch(this.getVault(vaultId),query,contextLength);}
  async structuredSearch(vaultId,query){return structuredSearch(this.getVault(vaultId),query);}
  async tags(vaultId){const browser=await this.rpc.tryCall(vaultId,'metadata.tags',{},1200);if(browser?.tags)return browser.tags;return tagCounts(this.getVault(vaultId));}
  activePath(vaultId){return this.rpc.call(vaultId,'active.getPath');}
  commands(vaultId,operation,params={}){return this.rpc.call(vaultId,`commands.${operation}`,params);}
  open(vaultId,path,newLeaf=false){return this.rpc.call(vaultId,'open',{path,newLeaf});}
  async listMarkdown(vaultId,limit=10000){const out=[];for await(const rel of walkFiles(this.getVault(vaultId),'',{markdownOnly:true})){out.push(rel);if(out.length>=limit)break;}return out;}
}
function fallbackMarkdownHtml(markdown){return String(markdown).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/^######\s+(.+)$/gm,'<h6>$1</h6>').replace(/^#####\s+(.+)$/gm,'<h5>$1</h5>').replace(/^####\s+(.+)$/gm,'<h4>$1</h4>').replace(/^###\s+(.+)$/gm,'<h3>$1</h3>').replace(/^##\s+(.+)$/gm,'<h2>$1</h2>').replace(/^#\s+(.+)$/gm,'<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').split(/\n{2,}/).map((b)=>/^<h[1-6]>/.test(b)?b:`<p>${b.replace(/\n/g,'<br>')}</p>`).join('\n');}
module.exports={VaultService,asBuffer,asText,strictUtf8};
