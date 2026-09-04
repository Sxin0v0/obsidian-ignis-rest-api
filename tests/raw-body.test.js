const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { rawBody } = require('../server-plugin/lib/routes');

function request({method='PUT', contentType='text/markdown', body, payload=''}) {
  const bytes = Buffer.from(payload, 'utf8');
  const req = Readable.from(bytes.length ? [bytes] : []);
  req.method = method;
  req.body = body;
  req.headers = {'content-type': contentType, 'content-length': String(bytes.length)};
  req.get = (name) => req.headers[String(name).toLowerCase()];
  return req;
}
function response() {
  return {
    statusCode: 200,
    body: null,
    status(code){ this.statusCode=code; return this; },
    json(value){ this.body=value; return this; },
  };
}
function run(req,res=response()) {
  return new Promise((resolve,reject)=>rawBody(req,res,(err)=>err?reject(err):resolve(res)));
}

test('rawBody replaces Ignis/Express empty-object placeholder for text/markdown', async () => {
  const markdown = '# Hello\n\n中文正文\n';
  const req = request({body:{}, payload:markdown});
  await run(req);
  assert.ok(Buffer.isBuffer(req.body));
  assert.equal(req.body.toString('utf8'), markdown);
});

test('rawBody preserves an already parsed JSON body', async () => {
  const parsed = {jsonrpc:'2.0', id:1, method:'ping'};
  const req = request({method:'POST', contentType:'application/json', body:parsed, payload:'{"ignored":true}'});
  await run(req);
  assert.equal(req.body, parsed);
});

test('rawBody preserves arbitrary binary bytes', async () => {
  const bytes = Buffer.from([0,1,2,3,254,255]);
  const req = Readable.from([bytes]);
  req.method='PUT';
  req.body={};
  req.headers={'content-type':'application/octet-stream','content-length':String(bytes.length)};
  req.get=(name)=>req.headers[String(name).toLowerCase()];
  await run(req);
  assert.deepEqual(req.body, bytes);
});
