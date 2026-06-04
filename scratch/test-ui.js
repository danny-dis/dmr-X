async function testUI() {
  try {
    const start = Date.now();
    const res = await fetch('http://localhost:4200/');
    const duration = Date.now() - start;
    console.log(`UI Endpoint: /`);
    console.log(`  Status: ${res.status} ${res.statusText}`);
    console.log(`  Duration: ${duration}ms`);
    const text = await res.text();
    console.log(`  Contains Vite client reference:`, text.includes('/@vite/client'));
    console.log(`  Contains React reference:`, text.includes('root') || text.includes('react'));
  } catch (err) {
    console.error(`UI server check failed:`, err.message);
  }
}
testUI();
