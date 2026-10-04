"""Official SDK interop against a caller-supplied local fixture server, no LLM."""
import asyncio,json,sys,uuid
import httpx
from a2a.client.card_resolver import parse_agent_card
from a2a.client.transports.jsonrpc import JsonRpcTransport
from a2a.types import Message,Part,SendMessageRequest,GetTaskRequest,Role,TaskState
ROLE_USER=Role.Value('ROLE_USER')
TASK_STATE_COMPLETED=TaskState.Value('TASK_STATE_COMPLETED')

async def main():
    base=sys.argv[1]
    async with httpx.AsyncClient(timeout=15,trust_env=False,headers={'Authorization':'Bearer sdk-interop-fixture','A2A-Version':'1.0'}) as http:
        card_json=(await http.get(base+'/.well-known/agent-card.json')).json()
        card=parse_agent_card(card_json)
        assert card.supported_interfaces[0].url==base+'/a2a',card
        transport=JsonRpcTransport(http,card,base+'/a2a')
        request=SendMessageRequest(message=Message(message_id=str(uuid.uuid4()),role=ROLE_USER,parts=[Part(text='Official SDK boundary test')]))
        response=await transport.send_message(request)
        assert response.WhichOneof('payload')=='task',response
        task=response.task
        assert task.status.state==TASK_STATE_COMPLETED,task
        assert task.artifacts[0].parts[0].text=='SDK_FIXTURE_REPLY',task
        restored=await transport.get_task(GetTaskRequest(id=task.id,history_length=2))
        assert restored.id==task.id and restored.status.state==TASK_STATE_COMPLETED,restored
        events=[]
        stream_request=SendMessageRequest(message=Message(message_id=str(uuid.uuid4()),role=ROLE_USER,parts=[Part(text='Official SDK stream test')]))
        async for event in transport.send_message_streaming(stream_request):
            events.append(event)
        payloads=[event.WhichOneof('payload') for event in events]
        assert 'task' in payloads and 'artifact_update' in payloads and 'status_update' in payloads,payloads
        assert any(event.status_update.status.state==TASK_STATE_COMPLETED for event in events if event.HasField('status_update'))
        assert any(event.artifact_update.artifact.parts[0].text=='SDK_FIXTURE_REPLY' for event in events if event.HasField('artifact_update'))
        print(json.dumps({'marker':'OFFICIAL_SDK_BLOCKING_OK','stream':'OFFICIAL_SDK_STREAM_OK','events':len(events),'taskId':task.id,'state':task.status.state,'artifact':task.artifacts[0].parts[0].text,'history':len(restored.history)}))

if __name__=='__main__':asyncio.run(main())
