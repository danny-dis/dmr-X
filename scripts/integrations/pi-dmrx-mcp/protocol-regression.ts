import http from 'node:http';
import assert from 'node:assert/strict';
import { McpClient } from './mcp-client.ts';
const seen: Array<{method: string, protocol: string | undefined}> = [];
const version = '2025-03-26';
const server=http.createServer(async (req,res)=>{
 let body='';for await(const c of req)body+=c;
 const msg=JSON.parse(body);seen.push({method:msg.method,protocol:req.headers['mcp-protocol-version'] as string|undefined});
 res.setHeader('Content-Type','application/json');
 if(msg.method==='initialize'){
  res.setHeader('mcp-session-id','protocol-regression-session');
  return res.end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:version,capabilities:{tools:{}},serverInfo:{name:'regression',version:'1'}}}));
 }
 if(req.headers['mcp-protocol-version']!==version){
  res.statusCode=400;return res.end(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32600,message:'missing negotiated MCP protocol header'}}));
 }
 if(msg.method==='notifications/initialized'){res.statusCode=202;return res.end();}
 if(msg.method==='tools/list')return res.end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{tools:[{name:'proof',inputSchema:{type:'object'}}]}}));
 res.end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'PROTOCOL_PROOF'}]}}));
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
try{
 const client=new McpClient(`http://127.0.0.1:${(server.address() as any).port}`);
 await client.initialize();
 assert.equal((await client.listTools()).tools[0].name,'proof');
 assert.equal(McpClient.resultToText(await client.callTool('proof',{})),'PROTOCOL_PROOF');
 assert.ok(seen.filter(x=>x.method!=='initialize').every(x=>x.protocol===version));
 console.log(JSON.stringify({success:true,negotiatedVersion:version,requests:seen}));
}finally{server.close();}
