import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { handleA2ARoutes } from '../../services/mcp-server/src/a2a/handler.js';
import { resetTaskManager } from '../../services/mcp-server/src/a2a/task-manager.js';

const servers: Server[]=[];
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}resetTaskManager();vi.unstubAllEnvs();});
async function listen(server:Server){servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}

it.runIf(Boolean(process.env.A2A_SDK_PYTHON))('interoperates with the official 1.1.1 SDK: discover, send and get a task',async()=>{
  vi.stubEnv('DMRX_MCP_API_KEY','sdk-interop-fixture');
  vi.stubEnv('DMRX_MCP_AGENT_API_KEY','sdk-upstream-fixture');
  const gateway=await listen(createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({content:'SDK_FIXTURE_REPLY'}));});}));
  vi.stubEnv('DMRX_GATEWAY_URL',gateway);
  let base='';
  base=await listen(createServer((req,res)=>{void handleA2ARoutes(req,res,{enabled:true,agentCard:{name:'DMR-X SDK fixture',url:base+'/a2a'}},[]).then(handled=>{if(!handled){res.writeHead(404);res.end();}}).catch(err=>{res.writeHead(500);res.end(String(err));});}));
  const env={...process.env};delete env.PYTHONPATH;
  const output=await new Promise<string>((resolve,reject)=>{
    const child=spawn(process.env.A2A_SDK_PYTHON!,[fileURLToPath(new URL('../fixtures/a2a-official-sdk-client.py',import.meta.url)),base],{env,stdio:['ignore','pipe','pipe']});let text='';
    child.stdout.on('data',b=>text+=String(b));child.stderr.on('data',b=>text+=String(b));child.on('error',reject);
    child.on('exit',code=>code===0?resolve(text):reject(new Error(`SDK exited ${code}: ${text}`)));
  });
  expect(output).toContain('OFFICIAL_SDK_BLOCKING_OK');
},25000);
