const test=require('node:test');
const assert=require('node:assert/strict');
const {McpEndpoint}=require('../server-plugin/lib/mcp');

function endpoint(){
  const service={
    list:async(_v,p)=>p?['a.md']:['a.md','folder/'],
    readRaw:async()=>({kind:'file',buffer:Buffer.from('hello'),mimeType:'text/plain'}),
    metadata:async(_v,p)=>({path:p,content:'hello',tags:[],frontmatter:{},stat:{ctime:1,mtime:2,size:5},links:[],backlinks:[],unresolvedLinks:[]}),
    targetedRead:async()=>({kind:'heading',content:'section'}),
    write:async()=>{},append:async()=>{},patch:async()=>({document:'ok',warnings:[]}),delete:async()=>{},
    move:async(_v,_p,d)=>d,copy:async(_v,_p,d)=>d,documentMap:async()=>({version:'abc123',headings:{},blocks:[],frontmatterFields:[]}),
    activePath:async()=>({path:'a.md'}),structuredSearch:async()=>[],simpleSearch:async()=>[],tags:async()=>[],commands:async(_v,op)=>op==='list'?[]:{},open:async()=>{},
  };
  const extensions={listTools:()=>[],callTool:async()=>null};
  return new McpEndpoint(service,()=> 'v1','1.0.0',extensions,()=> 'openapi: 3.1.0\n');
}
function res(){return{headers:{},setHeader(k,v){this.headers[k]=v;}};}

test('MCP initialize returns server identity, protocol, and session id',async()=>{
  const ep=endpoint(),r=res();
  const out=await ep.rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}},{},r);
  assert.equal(out.result.protocolVersion,'2025-11-25');
  assert.equal(out.result.serverInfo.name,'obsidian-local-rest-api');
  assert.ok(r.headers['Mcp-Session-Id']);
});

test('MCP tools/list and tools/call use upstream tool names',async()=>{
  const ep=endpoint(),r=res(),req={};
  const list=await ep.rpc({jsonrpc:'2.0',id:2,method:'tools/list'},req,r);
  assert.ok(list.result.tools.some(t=>t.name==='vault_list'));
  const call=await ep.rpc({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'vault_list',arguments:{}}},req,r);
  assert.equal(call.result.isError,undefined);
  assert.deepEqual(call.result.structuredContent,{files:['a.md','folder/']});
});

test('MCP exposes and reads OpenAPI resource',async()=>{
  const ep=endpoint(),r=res(),req={};
  const list=await ep.rpc({jsonrpc:'2.0',id:4,method:'resources/list'},req,r);
  assert.equal(list.result.resources[0].uri,'obsidian://local-rest-api/openapi.yaml');
  const read=await ep.rpc({jsonrpc:'2.0',id:5,method:'resources/read',params:{uri:'obsidian://local-rest-api/openapi.yaml'}},req,r);
  assert.match(read.result.contents[0].text,/openapi: 3\.1\.0/);
});
