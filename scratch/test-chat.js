async function testChat(stream) {
  const apiKey = 'dmrx_key_4cb4ec20e746fcffcb59b9bb8a0b6ea7';
  console.log(`\n--- Running Chat Completion (Stream: ${stream}) ---`);
  
  try {
    const res = await fetch('http://localhost:3000/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'openai-fast',
        messages: [{ role: 'user', content: 'Say "DMR-X integration works!" and nothing else.' }],
        stream: stream
      })
    });
    
    if (!res.ok) {
      console.error(`Request failed: ${res.status} ${res.statusText}`);
      const text = await res.text();
      console.error('Error body:', text);
      return;
    }
    
    if (stream) {
      // Handle server-sent events stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let textBuffer = '';
      
      console.log('Stream chunk output:');
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          textBuffer += chunk;
          // Parse lines
          const lines = textBuffer.split('\n');
          textBuffer = lines.pop(); // keep last incomplete line
          
          for (const line of lines) {
            if (line.trim().startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (dataStr === '[DONE]') {
                console.log('\n[Stream Finished]');
                break;
              }
              try {
                const parsed = JSON.parse(dataStr);
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  process.stdout.write(content);
                }
              } catch (e) {
                // Not JSON or incomplete
              }
            }
          }
        }
      }
    } else {
      const data = await res.json();
      console.log('Response status:', res.status);
      console.log('Response body:', JSON.stringify(data, null, 2));
      console.log('Response content:', data.choices?.[0]?.message?.content);
    }
  } catch (err) {
    console.error('Chat completions check failed:', err.message);
  }
}

async function run() {
  // Test non-streaming first
  await testChat(false);
  // Test streaming second
  await testChat(true);
}

run();
