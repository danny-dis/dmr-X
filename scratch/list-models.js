async function listModels() {
  try {
    const res = await fetch('http://localhost:3000/v1/models');
    if (!res.ok) {
      console.error(`Failed to fetch models: ${res.status} ${res.statusText}`);
      return;
    }
    const data = await res.json();
    console.log(`Active models count: ${data.data.length}`);
    for (const model of data.data) {
      console.log(`- ID: ${model.id} (${model.owned_by})`);
    }
  } catch (err) {
    console.error('Failed to list models:', err.message);
  }
}
listModels();
