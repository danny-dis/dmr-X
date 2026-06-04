async function testProxy() {
  try {
    const start = Date.now();
    const res = await fetch('http://localhost:4200/health'); // Check if UI routes /health or if /v1/models is proxying
    console.log(`Checking /health on UI port: Status ${res.status}`);
    
    // Check if /v1/models is proxying. (Wait, is /v1/models open or does it require an API key? Let's check!)
    const modelsRes = await fetch('http://localhost:4200/v1/models');
    const duration = Date.now() - start;
    console.log(`UI Proxy Endpoint: /v1/models`);
    console.log(`  Status: ${modelsRes.status} ${modelsRes.statusText}`);
    console.log(`  Duration: ${duration}ms`);
    try {
      const body = await modelsRes.json();
      console.log(`  Body length:`, JSON.stringify(body).length);
      console.log(`  Body preview:`, JSON.stringify(body).substring(0, 100));
    } catch {
      const text = await modelsRes.text();
      console.log(`  Body (text):`, text.substring(0, 100));
    }
  } catch (err) {
    console.error(`UI Proxy check failed:`, err.message);
  }
}
testProxy();
